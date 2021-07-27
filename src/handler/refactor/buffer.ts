import { Buffer, Neovim } from '@chemzqm/neovim'
import fastDiff from 'fast-diff'
import path from 'path'
import { Disposable, Range, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import commands from '../../commands'
import Document from '../../model/document'
import Highlighter from '../../model/highligher'
import { BufferSyncItem, DidChangeTextDocumentParams } from '../../types'
import { disposeAll } from '../../util'
import { isParentFolder, readFileLines } from '../../util/fs'
import { Mutex } from '../../util/mutex'
import { equals } from '../../util/object'
import { byteLength } from '../../util/string'
import window from '../../window'
import workspace from '../../workspace'
const logger = require('../../util/logger')('handler-refactorBuffer')

export const SEPARATOR = '\u3000'

export interface LineChange {
  // zero indexed
  lnum: number
  delta: number
}

export interface FileChange {
  // line number of filepath
  lnum: number
  // start line 0 indexed
  start?: number
  // end line 0 indexed, excluded
  end?: number
  filepath: string
  lines: string[]
}

export interface FileRange {
  // start lnum in refactor buffer, 1 indexed
  lnum?: number
  // start line 0 indexed
  start: number
  // end line 0 indexed, excluded
  end: number
  // range relatived to new range
  highlights?: Range[]
  lines?: string[]
}

export interface FileItem {
  filepath: string
  ranges: FileRange[]
}

export interface RefactorConfig {
  openCommand: string
  beforeContext: number
  afterContext: number
  saveToFile: boolean
}

export interface RefactorBufferOpts {
  cwd: string
  winid: number
  fromWinid: number
}

export default class RefactorBuffer implements BufferSyncItem {
  private mutex = new Mutex()
  private _disposed = false
  private disposables: Disposable[] = []
  private _fileItems: FileItem[] = []
  private matchIds: Set<number> = new Set()
  private changing = false
  constructor(
    private bufnr: number,
    private srcId: number,
    private nvim: Neovim,
    public readonly config: RefactorConfig,
    private opts: RefactorBufferOpts
  ) {
    this.disposables.push(workspace.registerLocalKeymap('n', '<CR>', this.splitOpen.bind(this), true))
    workspace.onDidChangeTextDocument(this.onDocumentChange, this, this.disposables)
  }

  public get fileItems(): FileItem[] {
    return this._fileItems
  }

  public onChange(e: DidChangeTextDocumentParams): void {
    if (this.changing) return
    let doc = this.document
    let { nvim, _fileItems: fileItems } = this
    if (!fileItems.length) return
    let change = e.contentChanges[0]
    if (!('range' in change)) return
    let { original } = e
    if (change.range.end.line < 2) return
    doc.buffer.setOption('modified', true, true)
    let { range, text } = change
    let lines = text.split('\n')
    let lineChange = lines.length - (range.end.line - range.start.line) - 1
    if (lineChange == 0) return
    let lineChanges: LineChange[] = []
    if (text.includes('\u3000')) {
      let startLine = range.start.line
      let diffs = fastDiff(original, text)
      let offset = 0
      let orig = TextDocument.create('file:///1', '', 0, original)
      for (let i = 0; i < diffs.length; i++) {
        let diff = diffs[i]
        let pos = orig.positionAt(offset)
        if (diff[0] == fastDiff.EQUAL) {
          offset = offset + diff[1].length
        } else if (diff[0] == fastDiff.DELETE) {
          let end = orig.positionAt(offset + diff[1].length)
          if (diffs[i + 1] && diffs[i + 1][0] == fastDiff.INSERT) {
            let delta = diffs[i + 1][1].split('\n').length - (end.line - pos.line) - 1
            if (delta != 0) lineChanges.push({ delta, lnum: pos.line + startLine })
            i = i + 1
          } else {
            let delta = - (end.line - pos.line)
            if (delta != 0) lineChanges.push({ delta, lnum: pos.line + startLine })
          }
          offset = offset + diff[1].length
        } else if (diff[0] == fastDiff.INSERT) {
          let delta = diff[1].split('\n').length - 1
          if (delta != 0) lineChanges.push({ delta, lnum: pos.line + startLine })
        }
      }
    } else {
      lineChanges = [{ delta: lineChange, lnum: range.start.line }]
    }
    let changed = false
    // adjust LineNr highlights
    for (let item of fileItems) {
      for (let range of item.ranges) {
        let arr = lineChanges.filter(o => o.lnum < range.lnum - 1)
        if (arr.length) {
          let total = arr.reduce((p, c) => p + c.delta, 0)
          range.lnum = range.lnum + total
          changed = true
        }
      }
    }
    if (!changed) return
    nvim.pauseNotification()
    this.highlightLineNr()
    nvim.resumeNotification().then(res => {
      if (Array.isArray(res) && res[1] != null) {
        logger.error(`Error on highlightLineNr:`, res[1])
      }
    }).logError()
  }

  /**
   * Handle changes of other buffers.
   */
  private async onDocumentChange(e: DidChangeTextDocumentParams): Promise<void> {
    if (e.bufnr == this.bufnr || this.changing) return
    let { uri } = e.textDocument
    let { range, text } = e.contentChanges[0]
    let filepath = URI.parse(uri).fsPath
    let fileItem = this._fileItems.find(o => o.filepath == filepath)
    // not affected
    if (!fileItem) return
    let lineChange = text.split('\n').length - (range.end.line - range.start.line) - 1
    let edits: TextEdit[] = []
    // 4 cases: ignore, change lineNr, reload, remove
    for (let i = 0; i < fileItem.ranges.length; i++) {
      let r = fileItem.ranges[i]
      if (range.start.line >= r.end) {
        continue
      }
      if (range.end.line < r.start) {
        if (lineChange == 0) {
          continue
        } else {
          r.start = r.start + lineChange
          r.end = r.end + lineChange
        }
      } else {
        let doc = workspace.getDocument(uri)
        let newLines = doc.getLines(r.start, r.end)
        if (!newLines.length) {
          // remove this range
          fileItem.ranges.splice(i, 1)
          edits.push({
            range: this.getFileRangeRange(r, false),
            newText: ''
          })
        } else {
          r.end = r.start + newLines.length
          // reload lines, reset end
          edits.push({
            range: this.getFileRangeRange(r, true),
            newText: newLines.join('\n') + '\n'
          })
        }
      }
    }
    // clean fileItem with empty ranges
    this._fileItems = this._fileItems.filter(o => o.ranges && o.ranges.length > 0)
    if (edits.length) {
      this.changing = true
      await this.document.applyEdits(edits)
      this.changing = false
    }
    this.nvim.pauseNotification()
    this.highlightLineNr()
    this.buffer.setOption('modified', false, true)
    await this.nvim.resumeNotification()
  }

  /**
   * Current changed file ranges
   */
  public async getFileChanges(): Promise<FileChange[]> {
    if (this._disposed) return []
    let changes: FileChange[] = []
    let lines = await this.buffer.lines
    lines.push(SEPARATOR)
    // current lines
    let arr: string[] = []
    let fsPath: string
    let lnum: number
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]
      if (line.startsWith(SEPARATOR)) {
        if (fsPath) {
          changes.push({
            filepath: fsPath,
            lines: arr.slice(),
            lnum
          })
          fsPath = undefined
          arr = []
        }
        if (line.length > 1) {
          let ms = line.match(/^\u3000(.*)/)
          if (ms) {
            fsPath = this.getAbsolutePath(ms[1].replace(/\s+$/, ''))
            lnum = i + 1
            arr = []
          }
        }
      } else {
        arr.push(line)
      }
    }
    return changes
  }

  /**
   * Open line under cursor in split window
   */
  public async splitOpen(): Promise<void> {
    let { nvim } = this
    let win = nvim.createWindow(this.opts.fromWinid)
    let valid = await win.valid
    let lines = await nvim.eval('getline(1,line("."))') as string[]
    let len = lines.length
    for (let i = 0; i < len; i++) {
      let line = lines[len - i - 1]
      let ms = line.match(/^\u3000(.+)/)
      if (ms) {
        let filepath = ms[1].trim()
        let r = this.getLinesRange(len - i)
        if (!r) return
        let lnum = r[0] + i - 1
        let bufname = this.getAbsolutePath(filepath)
        nvim.pauseNotification()
        if (valid) {
          nvim.call('win_gotoid', [this.opts.fromWinid], true)
          this.nvim.call('coc#util#jump', ['edit', bufname, [lnum, 1]], true)
        } else {
          this.nvim.call('coc#util#jump', ['belowright vs', bufname, [lnum, 1]], true)
        }
        nvim.command('normal! zz', true)
        let [, err] = await nvim.resumeNotification()
        if (err) window.showMessage(`Error on open ${filepath}: ${err}`, 'error')
        if (!valid) {
          this.opts.fromWinid = await nvim.call('win_getid')
        }
        break
      }
    }
  }

  /**
   * Add FileItem to refactor buffer.
   */
  public async addFileItems(items: FileItem[]): Promise<void> {
    if (this._disposed) return
    let { cwd } = this.opts
    let { document } = this
    const release = await this.mutex.acquire()
    try {
      if (document.dirty) document.forceSync()
      for (let item of items) {
        let fileItem = this._fileItems.find(o => o.filepath == item.filepath)
        if (fileItem) {
          fileItem.ranges.push(...item.ranges)
        } else {
          this._fileItems.push(item)
        }
      }
      let count = document.lineCount
      let highligher = new Highlighter()
      let hlRanges: Range[] = []
      for (let item of items) {
        for (let range of item.ranges) {
          highligher.addLine(SEPARATOR)
          highligher.addLine(SEPARATOR)
          range.lnum = count + highligher.length
          highligher.addText(`${isParentFolder(cwd, item.filepath) ? path.relative(cwd, item.filepath) : item.filepath}`)
          // white spaces for conceal texts
          let n = String(range.start + 1).length + String(range.end).length + 4
          if (!this.srcId) highligher.addText(' '.repeat(n))
          let base = 0 - highligher.length - count
          if (range.highlights) {
            hlRanges.push(...range.highlights.map(r => adjustRange(r, base)))
          }
          let { lines } = range
          if (!lines) {
            lines = await this.getLines(item.filepath, range.start, range.end)
            range.lines = lines
          }
          highligher.addLines(lines)
        }
      }
      let { nvim, buffer } = this
      this.changing = true
      nvim.pauseNotification()
      highligher.render(buffer, count)
      this.highlightLineNr()
      buffer.setOption('modified', false, true)
      buffer.setOption('undolevels', 1000, true)
      if (count == 2 && hlRanges.length) {
        let pos = hlRanges[0].start
        nvim.call('coc#util#jumpTo', [pos.line, pos.character], true)
      }
      if (workspace.isVim) {
        nvim.command('redraw', true)
      }
      let [, err] = await nvim.resumeNotification()
      if (err) throw new Error(err[2])
      await document.patchChange()
      this.changing = false
      await commands.executeCommand('editor.action.addRanges', hlRanges)
    } catch (e) {
      this.changing = false
      logger.error(`Error on add file item:`, e)
    }
    release()
  }

  /**
   * Save changes to buffers/files, return false when no change made.
   */
  public async save(): Promise<boolean> {
    let { nvim } = this
    let doc = this.document
    let { buffer } = doc
    await doc.patchChange()
    let changes = await this.getFileChanges()
    if (!changes) return
    changes.sort((a, b) => a.lnum - b.lnum)
    // filter changes that not change
    let removeList: number[] = []
    let deltaMap: Map<string, number> = new Map()
    for (let i = 0; i < changes.length; i++) {
      let change = changes[i]
      let { filepath, lnum } = change
      let curr = deltaMap.get(filepath) || 0
      let item = this._fileItems.find(o => o.filepath == filepath)
      let range = item ? item.ranges.find(o => o.lnum == lnum) : null
      if (!range || equals(range.lines, change.lines)) {
        removeList.push(i)
        if (curr && range) {
          range.start = range.start + curr
          range.end = range.end + curr
        }
        continue
      }
      change.start = range.start
      change.end = range.end
      if (curr != 0) range.start = range.start + curr
      if (change.lines.length != range.lines.length) {
        let delta = change.lines.length - range.lines.length
        let total = delta + curr
        deltaMap.set(filepath, total)
        range.end = range.end + total
      } else {
        range.end = range.end + curr
      }
      range.lines = change.lines
    }
    if (removeList.length) changes = changes.filter((_, i) => !removeList.includes(i))
    if (changes.length == 0) {
      window.showMessage('No change.', 'more')
      await buffer.setOption('modified', false)
      return false
    }
    let changeMap: { [uri: string]: TextEdit[] } = {}
    for (let change of changes) {
      let uri = URI.file(change.filepath).toString()
      let edits = changeMap[uri] || []
      edits.push({
        range: Range.create(change.start, 0, change.end, 0),
        newText: change.lines.join('\n') + '\n'
      })
      changeMap[uri] = edits
    }
    this.changing = true
    await workspace.applyEdit({ changes: changeMap })
    this.changing = false
    nvim.pauseNotification()
    buffer.setOption('modified', false, true)
    if (this.config.saveToFile) {
      nvim.command('silent noa wa', true)
    }
    this.highlightLineNr()
    await nvim.resumeNotification()
    return true
  }

  public getFileRange(lnum: number): FileRange {
    for (let item of this._fileItems) {
      for (let r of item.ranges) {
        if (r.lnum == lnum) {
          return r
        }
      }
    }
  }

  private getLinesRange(lnum: number): [number, number] | null {
    for (let item of this._fileItems) {
      for (let range of item.ranges) {
        if (range.lnum == lnum) {
          return [range.start, range.end]
        }
      }
    }
  }

  private async getLines(fsPath: string, start: number, end: number): Promise<string[]> {
    let uri = URI.file(fsPath).toString()
    let doc = workspace.getDocument(uri)
    if (doc) return doc.getLines(start, end)
    return await readFileLines(fsPath, start, end - 1)
  }

  private getAbsolutePath(filepath: string): string {
    if (path.isAbsolute(filepath)) return filepath
    return path.join(this.opts.cwd, filepath)
  }

  /**
   * Edit range of FileRange
   */
  private getFileRangeRange(range: FileRange, lineOnly = true): Range {
    let { document } = this
    if (!document) return null
    let { lnum } = range
    let first = document.getline(lnum - 1)
    if (!first.startsWith('\u3000')) return null
    let start = lineOnly ? lnum : lnum - 1
    let end = document.lineCount
    for (let i = lnum; i < document.lineCount; i++) {
      let line = document.getline(i)
      if (line.startsWith('\u3000')) {
        end = lineOnly ? i : i + 1
        break
      }
    }
    return Range.create(start, 0, end, 0)
  }

  /**
   * Use conceal to add lineNr
   */
  private highlightLineNr(): void {
    let { _fileItems: fileItems, nvim, srcId, bufnr } = this
    let { winid, cwd } = this.opts
    let info = {}
    if (srcId) {
      nvim.call('nvim_buf_clear_namespace', [bufnr, srcId, 0, -1], true)
      for (let item of fileItems) {
        for (let range of item.ranges) {
          let text = `${range.start + 1}:${range.end}`
          info[range.lnum] = [range.start + 1, range.end]
          nvim.call('nvim_buf_set_virtual_text', [bufnr, srcId, range.lnum - 1, [[text, 'LineNr']], {}], true)
        }
      }
    } else {
      if (this.matchIds.size) {
        nvim.call('coc#highlight#clear_matches', [winid, Array.from(this.matchIds)], true)
        this.matchIds.clear()
      }
      let id = 2000
      for (let item of fileItems) {
        let filename = `${cwd ? path.relative(cwd, item.filepath) : item.filepath}`
        let col = byteLength(filename) + 1
        for (let range of item.ranges) {
          let text = `:${range.start + 1}:${range.end}`
          for (let i = 0; i < text.length; i++) {
            let ch = text[i]
            this.matchIds.add(id)
            info[range.lnum] = [range.start + 1, range.end]
            nvim.call('matchaddpos', ['Conceal', [[range.lnum, col + i]], 99, id, { conceal: ch, window: winid }], true)
            id++
          }
        }
      }
    }
    this.buffer.setVar('line_infos', info, true)
  }

  public get valid(): Promise<boolean> {
    return this.buffer.valid
  }

  public get buffer(): Buffer {
    return this.nvim.createBuffer(this.bufnr)
  }

  public get document(): Document | null {
    if (this._disposed) return null
    return workspace.getDocument(this.bufnr)
  }

  public dispose(): void {
    this._disposed = true
    disposeAll(this.disposables)
  }
}

function adjustRange(range: Range, offset: number): Range {
  let { start, end } = range
  return Range.create(start.line - offset, start.character, end.line - offset, end.character)
}

