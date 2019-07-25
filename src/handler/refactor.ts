import { Buffer, Neovim } from '@chemzqm/neovim'
import fastDiff from 'fast-diff'
import path from 'path'
import { Disposable, DidChangeTextDocumentParams } from 'vscode-languageserver-protocol'
import { Range, TextDocumentEdit, TextEdit, WorkspaceEdit, Location, TextDocument } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import commands from '../commands'
import events from '../events'
import Highlighter from '../model/highligher'
import { disposeAll } from '../util'
import { getFileLineCount, isParentFolder, readFileLines } from '../util/fs'
import { equals } from '../util/object'
import { byteLength } from '../util/string'
import workspace from '../workspace'
import Document from '../model/document'
const logger = require('../util/logger')('refactor')
// cases: buffer change event

const name = '__coc_refactor__'
const separator = '\u3000'

export interface LineChange {
  // zero indexed
  lnum: number
  delta: number
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

export interface FileItem {
  filepath: string
  ranges: FileRange[]
}

export interface RefactorConfig {
  openCommand: string
  beforeContext: number
  afterContext: number
}

export default class Refactor {
  private id = 0
  private nvim: Neovim
  private bufnr: number
  private winid: number
  private textDocument: TextDocument
  private matchIds: Set<number> = new Set()
  private disposables: Disposable[] = []
  private fileItems: FileItem[] = []
  private cwd: string
  private version: number
  private srcId: number
  private changing = false
  public config: RefactorConfig
  constructor() {
    this.nvim = workspace.nvim
    if (workspace.isNvim && this.nvim.hasFunction('nvim_buf_set_virtual_text')) {
      this.srcId = workspace.createNameSpace('coc-refactor')
    }
    let config = workspace.getConfiguration('refactor')
    this.config = {
      afterContext: config.get('afterContext', 3),
      beforeContext: config.get('beforeContext', 3),
      openCommand: config.get('openCommand', 'edit')
    }
    events.on('BufUnload', bufnr => {
      if (bufnr == this.bufnr) this.dispose()
    }, null, this.disposables)
  }

  /**
   * Start refactor from workspaceEdit
   */
  public async fromWorkspaceEdit(edit: WorkspaceEdit): Promise<void> {
    let items = await this.getItemsFromWorkspaceEdit(edit)
    let [winid, filetype] = await this.nvim.eval('[win_getid(),&filetype]') as [number, string]
    let buf = await this.createRefactorBuffer(winid, filetype)
    await this.addFileItems(items, buf)
  }

  /**
   * Create initialized refactor buffer
   */
  public async createRefactorBuffer(winid: number, filetype?: string): Promise<Buffer> {
    let { nvim } = this
    let cwd = await nvim.call('getcwd')
    let { openCommand } = this.config
    let highligher = new Highlighter()
    highligher.addLine('Save current buffer to make changes', 'Comment')
    highligher.addLine(separator)
    nvim.pauseNotification()
    nvim.command(`${openCommand} ${name}${this.id++}`, true)
    nvim.command(`silent! IndentLinesDisable`, true)
    nvim.command(`setl buftype=acwrite nobuflisted bufhidden=wipe nofen wrap conceallevel=2 concealcursor=n`, true)
    nvim.command(`setl undolevels=-1 nolist nospell noswapfile foldmethod=expr foldexpr=coc#util#refactor_foldlevel(v:lnum)`, true)
    nvim.command(`setl foldtext=coc#rpc#request('refactorFoldText',[v:foldstart])`, true)
    nvim.call('matchadd', ['Conceal', '^\\%u3000'], true)
    nvim.call('matchadd', ['Label', '^\\%u3000\\zs\\S\\+'], true)
    nvim.call('coc#util#do_autocmd', ['CocRefactorOpen'], true)
    workspace.registerLocalKeymap('n', '<CR>', async () => {
      let win = nvim.createWindow(winid)
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
          let lnum = r[0] + i
          let bufname = filepath.startsWith(workspace.cwd) ? path.relative(workspace.cwd, filepath) : filepath
          nvim.pauseNotification()
          if (valid) {
            nvim.call('win_gotoid', [winid], true)
            this.nvim.call('coc#util#jump', ['edit', bufname, [lnum, 1]], true)
          } else {
            this.nvim.call('coc#util#jump', ['belowright vs', bufname, [lnum, 1]], true)
          }
          nvim.command('normal! zz', true)
          let [, err] = await nvim.resumeNotification()
          if (err) workspace.showMessage(`Error on open ${filepath}: ${err}`, 'error')
          break
        }
      }
    }, true)
    let [, err] = await nvim.resumeNotification()
    if (err) {
      logger.error(err)
      workspace.showMessage(`Error on open refactor window: ${err}`, 'error')
      return
    }
    let [bufnr, win] = await nvim.eval('[bufnr("%"),win_getid()]') as [number, number]
    this.winid = win
    this.bufnr = bufnr
    let buffer = nvim.createBuffer(bufnr)
    this.cwd = cwd
    nvim.pauseNotification()
    if (filetype) nvim.command(`runtime! syntax/${filetype}.vim`, true)
    highligher.render(buffer)
    nvim.command('setl nomod', true)
    await nvim.resumeNotification()
    let doc = await workspace.document
    this.textDocument = doc.textDocument
    doc.onDocumentChange(this.onRefactorChange, this)
    workspace.onDidChangeTextDocument(this.onBufferChange, this, this.disposables)
    return buffer
  }

  /**
   * Add FileItem to refactor buffer.
   */
  public async addFileItems(items: FileItem[], buffer: Buffer): Promise<void> {
    this.fileItems.push(...items)
    let count = await buffer.length
    let highligher = new Highlighter()
    let hlRanges: Range[] = []
    for (let item of items) {
      for (let range of item.ranges) {
        range.lnum = count + highligher.length + 2
        highligher.addLine(separator)
        highligher.addLine(separator)
        highligher.addText(`${this.cwd && isParentFolder(this.cwd, item.filepath) ? path.relative(this.cwd, item.filepath) : item.filepath}`)
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
    let { nvim } = this
    this.version = this.document.version
    let buf = nvim.createBuffer(this.bufnr)
    nvim.pauseNotification()
    highligher.render(buffer, count)
    this.highlightLineNr()
    nvim.command('setl nomod', true)
    buf.setOption('undolevels', 1000, true)
    if (count == 2 && hlRanges.length) {
      let pos = hlRanges[0].start
      nvim.call('coc#util#jumpTo', [pos.line, pos.character], true)
    }
    let [, err] = await nvim.resumeNotification()
    if (err) logger.error(err)
    try {
      await this.ensureDocument(buffer.id)
    } catch (e) {
      logger.error(e)
      return
    }
    await commands.executeCommand('editor.action.addRanges', hlRanges)
  }

  /**
   * Use conceal to add lineNr
   */
  private highlightLineNr(): void {
    let { fileItems, nvim, winid, srcId, bufnr } = this
    if (srcId) {
      nvim.call('nvim_buf_clear_namespace', [bufnr, srcId, 0, -1], true)
      for (let item of fileItems) {
        for (let range of item.ranges) {
          let text = `${range.start + 1}:${range.end}`
          nvim.call('nvim_buf_set_virtual_text', [bufnr, srcId, range.lnum - 1, [[text, 'LineNr']], {}], true)
        }
      }
    } else {
      if (this.matchIds.size) {
        nvim.call('coc#util#clearmatches', [Array.from(this.matchIds)], true)
        this.matchIds.clear()
      }
      let id = 2000
      for (let item of fileItems) {
        let filename = `${this.cwd ? path.relative(this.cwd, item.filepath) : item.filepath}`
        let col = byteLength(filename) + 1
        for (let range of item.ranges) {
          let text = `:${range.start + 1}:${range.end}`
          for (let i = 0; i < text.length; i++) {
            let ch = text[i]
            this.matchIds.add(id)
            nvim.call('matchaddpos', ['Conceal', [[range.lnum, col + i]], 99, id, { conceal: ch, window: winid }], true)
            id++
          }
        }
      }
    }
  }

  /**
   * Current changed file ranges
   */
  public async getFileChanges(buffer: Buffer): Promise<FileChange[]> {
    let changes: FileChange[] = []
    let lines = await buffer.lines
    lines.push(separator)
    // current lines
    let arr: string[] = []
    let fsPath: string
    let lnum: number
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i]
      if (line.startsWith(separator)) {
        if (fsPath) {
          changes.push({
            filepath: fsPath,
            lines: arr,
            lnum
          })
          fsPath = undefined
          arr = []
        }
        if (line.length > 1) {
          let ms = line.match(/^\u3000(.*)/)
          if (ms) {
            let filepath = ms[1].replace(/\s+$/, '')
            fsPath = !path.isAbsolute(filepath) && this.cwd ? path.join(this.cwd, filepath) : filepath
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
   * Save changes to files, return false when no change made.
   */
  public async saveRefactor(bufnr: number): Promise<boolean> {
    let { nvim } = this
    let buffer = nvim.createBuffer(bufnr)
    let doc = this.document
    if (!doc) return
    if (workspace.isVim) {
      await (doc as any)._fetchContent()
    }
    doc.forceSync()
    let changes = await this.getFileChanges(buffer)
    changes.sort((a, b) => a.lnum - b.lnum)
    // filter changes that not change
    let removeList: number[] = []
    let deltaMap: Map<string, number> = new Map()
    for (let i = 0; i < changes.length; i++) {
      let change = changes[i]
      let { filepath, lnum } = change
      let curr = deltaMap.get(filepath) || 0
      let item = this.fileItems.find(o => o.filepath == filepath)
      let range = item ? item.ranges.find(o => o.lnum == lnum) : null
      if (!range || equals(range.lines, change.lines)) {
        removeList.push(i)
        if (curr) {
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
      workspace.showMessage('No change.', 'more')
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
    nvim.command('wa', true)
    this.highlightLineNr()
    await nvim.resumeNotification()
    return true
  }

  public getFileRange(lnum: number): FileRange {
    for (let item of this.fileItems) {
      for (let r of item.ranges) {
        if (r.lnum == lnum) {
          return r
        }
      }
    }
    return null
  }

  public has(filepath): boolean {
    return this.fileItems.find(o => o.filepath == filepath) != null
  }

  public getFoldText(lnum: number): string {
    let { document } = this
    if (!document) return ''
    let line = document.getline(lnum - 1)
    if (!line.startsWith('\u3000')) return ''
    let filepath = line.slice(1).trim()
    let ranges = this.fileItems.reduce((p, c) => {
      p.push(...c.ranges)
      return p
    }, [] as FileRange[])
    let range = ranges.find(r => r.lnum == lnum)
    return `${filepath}${range ? ` ${range.start}-${range.end}` : ''}`
  }

  private async onBufferChange(e: DidChangeTextDocumentParams): Promise<void> {
    if (this.changing) return
    let { uri } = e.textDocument
    let { range, text } = e.contentChanges[0]
    let filepath = URI.parse(uri).fsPath
    let fileItem = this.fileItems.find(o => o.filepath == filepath)
    if (!fileItem) return
    let lineChange = text.split('\n').length - (range.end.line - range.start.line) - 1
    let edits: TextEdit[] = []
    // ignore, change lineNr, reload, remove
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
      let buf = this.document.buffer
      let mod = await buf.getOption('modified')
      if (edits.length) {
        this.version = this.document.version
        await this.document.applyEdits(edits)
      }
      this.nvim.pauseNotification()
      this.highlightLineNr()
      if (!mod) buf.setOption('modified', false, true)
      await this.nvim.resumeNotification()
    }
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

  private async onRefactorChange(e): Promise<void> {
    let { nvim } = this
    let doc = this.document
    let orig = this.textDocument
    this.textDocument = doc.textDocument
    if (doc.version - this.version == 1) return
    doc.buffer.setOption('modified', true, true)
    let { fileItems } = this
    if (!fileItems.length) return
    let change = e.contentChanges[0]
    let { range, text } = change
    let lines = text.split('\n')
    let lineChange = lines.length - (range.end.line - range.start.line) - 1
    if (lineChange == 0) return
    let lineChanges: LineChange[] = []
    if (text.indexOf('\u3000') !== -1) {
      let o = orig.getText(range)
      let diffs = fastDiff(o, text)
      let offset = orig.offsetAt(range.start)
      for (let i = 0; i < diffs.length; i++) {
        let diff = diffs[i]
        let pos = orig.positionAt(offset)
        if (diff[0] == fastDiff.EQUAL) {
          offset = offset + diff[1].length
        } else if (diff[0] == fastDiff.DELETE) {
          let end = orig.positionAt(offset + diff[1].length)
          if (diffs[i + 1] && diffs[i + 1][0] == fastDiff.INSERT) {
            let delta = diffs[i + 1][1].split('\n').length - (end.line - pos.line) - 1
            if (delta != 0) lineChanges.push({ delta, lnum: pos.line })
            i = i + 1
          } else {
            let delta = - (end.line - pos.line)
            if (delta != 0) lineChanges.push({ delta, lnum: pos.line })
          }
          offset = offset + diff[1].length
        } else if (diff[0] == fastDiff.INSERT) {
          let delta = diff[1].split('\n').length - 1
          if (delta != 0) lineChanges.push({ delta, lnum: pos.line })
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
    if (!changed || this.srcId) return
    let winid = await nvim.call('win_getid')
    if (winid != this.winid) {
      await nvim.call('win_gotoid', [winid])
    }
    nvim.pauseNotification()
    this.highlightLineNr()
    await nvim.resumeNotification()
  }

  private async ensureDocument(bufnr: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let n = 0
      let interval = setInterval(async () => {
        let doc = workspace.getDocument(bufnr)
        if (doc) {
          await (doc as any)._fetchContent()
          clearInterval(interval)
          resolve()
        } else if (n == 10) {
          clearInterval(interval)
          reject(new Error('document create timeout after 1s'))
        }
        n++
      }, 100)
    })
  }

  private async getItemsFromWorkspaceEdit(edit: WorkspaceEdit): Promise<FileItem[]> {
    let res: FileItem[] = []
    let { beforeContext, afterContext } = this.config
    let { changes, documentChanges } = edit
    changes = changes || {}
    for (let change of documentChanges || []) {
      if (TextDocumentEdit.is(change)) {
        let { textDocument, edits } = change
        changes[textDocument.uri] = edits
      }
    }
    for (let key of Object.keys(changes)) {
      let max = await this.getLineCount(key)
      let edits = changes[key]
      let ranges: FileRange[] = []
      // start end highlights
      let start = null
      let end = null
      let highlights: Range[] = []
      edits.sort((a, b) => a.range.start.line - b.range.start.line)
      for (let edit of edits) {
        let { line } = edit.range.start
        let s = Math.max(0, line - beforeContext)
        if (start != null && s < end) {
          end = Math.min(max, line + afterContext + 1)
          highlights.push(adjustRange(edit.range, start))
        } else {
          if (start != null) ranges.push({ start, end, highlights })
          start = s
          end = Math.min(max, line + afterContext + 1)
          highlights = [adjustRange(edit.range, start)]
        }
      }
      if (start != null) ranges.push({ start, end, highlights })
      res.push({
        ranges,
        filepath: URI.parse(key).fsPath
      })
    }
    return res
  }

  private async getLineCount(uri: string): Promise<number> {
    let doc = workspace.getDocument(uri)
    if (doc) return doc.lineCount
    return await getFileLineCount(URI.parse(uri).fsPath)
  }

  private async getLines(fsPath: string, start: number, end: number): Promise<string[]> {
    let uri = URI.file(fsPath).toString()
    let doc = workspace.getDocument(uri)
    if (doc) return doc.getLines(start, end)
    return await readFileLines(fsPath, start, end - 1)
  }

  private getLinesRange(lnum: number): [number, number] | null {
    for (let item of this.fileItems) {
      for (let range of item.ranges) {
        if (range.lnum == lnum) {
          return [range.start, range.end]
        }
      }
    }
    return null
  }

  public get document(): Document | null {
    if (!this.bufnr) return null
    return workspace.getDocument(this.bufnr)
  }

  public async shown(): Promise<boolean> {
    if (!this.winid) return false
    let win = this.nvim.createWindow(this.winid)
    return await win.valid
  }

  public dispose(): void {
    let { bufnr } = this
    this.fileItems = []
    disposeAll(this.disposables)
    if (bufnr) this.nvim.command(`silent! bd! ${bufnr}`, true)
  }

  /**
   * Refactor from workspaceEdit.
   */
  public static async createFromWorkspaceEdit(edit: WorkspaceEdit): Promise<Refactor> {
    if (!edit || emptyWorkspaceEdit(edit)) return null
    let refactor = new Refactor()
    await refactor.fromWorkspaceEdit(edit)
    return refactor
  }

  /**
   * Refactor from locations.
   */
  public static async createFromLocations(locations: Location[]): Promise<Refactor> {
    if (!locations || locations.length == 0) return null
    let changes: { [uri: string]: TextEdit[] } = {}
    let edit: WorkspaceEdit = { changes }
    for (let location of locations) {
      let edits: TextEdit[] = changes[location.uri] || []
      edits.push({ range: location.range, newText: '' })
      changes[location.uri] = edits
    }
    let refactor = new Refactor()
    await refactor.fromWorkspaceEdit(edit)
    return refactor
  }
}

function adjustRange(range: Range, offset: number): Range {
  let { start, end } = range
  return Range.create(start.line - offset, start.character, end.line - offset, end.character)
}

function emptyWorkspaceEdit(edit: WorkspaceEdit): boolean {
  let { changes, documentChanges } = edit
  if (documentChanges && documentChanges.length) return false
  if (changes && Object.keys(changes).length) return false
  return true
}
