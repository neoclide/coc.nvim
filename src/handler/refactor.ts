import { Buffer, Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import path from 'path'
import { Range, TextDocumentEdit, TextEdit, WorkspaceEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import commands from '../commands'
import languages from '../languages'
import Highlighter from '../model/highligher'
import { readFileLines } from '../util/fs'
import { equals } from '../util/object'
import workspace from '../workspace'
const logger = require('../util/logger')('refactor')

const name = '__coc_refactor__'
const separator = '\u3000'

export interface FileRange {
  // start line 0 indexed
  start: number
  // end line 0 indexed, excluded
  end: number
  // range relatived to new range
  highlights?: Range[]
  lines?: string[]
}

export interface FileChange {
  filepath: string
  // start line 0 indexed
  start: number
  // end line 0 indexed, excluded
  end: number
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
  private varibles: Map<number, { [index: string]: any }> = new Map()
  public config: RefactorConfig
  constructor() {
    this.nvim = workspace.nvim
    let config = workspace.getConfiguration('refactor')
    this.config = {
      afterContext: config.get('afterContext', 3),
      beforeContext: config.get('beforeContext', 3),
      openCommand: config.get('openCommand', 'edit')
    }
  }

  /**
   * Start rename refactor of current symbol.
   */
  public async rename(): Promise<void> {
    let [bufnr, cursor, winid, filetype] = await this.nvim.eval('[bufnr("%"),coc#util#cursor(),win_getid(),&filetype]') as [number, [number, number], number, string]
    let doc = workspace.getDocument(bufnr)
    if (!doc) return
    let position = { line: cursor[0], character: cursor[1] }
    let res = await languages.prepareRename(doc.textDocument, position)
    if (res === false) {
      workspace.showMessage('Invalid position for rename', 'error')
      return
    }
    let edit = await languages.provideRenameEdits(doc.textDocument, position, 'newname')
    if (!edit || emptyWorkspaceEdit(edit)) {
      workspace.showMessage('Empty workspaceEdit from server', 'warning')
      return
    }
    let items = this.getFileItems(edit)
    let buf = await this.createRefactorBuffer(winid, filetype)
    await this.addFileItems(items, buf)
  }

  /**
   * Create initialized refactor buffer
   */
  public async createRefactorBuffer(winid: number, filetype?: string): Promise<Buffer> {
    let { nvim, bufnr } = this
    if (bufnr) await nvim.command(`silent! ${bufnr}bd!`)
    let cwd = await nvim.call('getcwd')
    let { openCommand } = this.config
    let highligher = new Highlighter()
    highligher.addLine('Save current buffer to make changes', 'Comment')
    highligher.addLine(separator)
    nvim.pauseNotification()
    nvim.command(`${openCommand} ${name}${this.id++}`, true)
    nvim.command(`setl buftype=acwrite nobuflisted bufhidden=hide nofen wrap conceallevel=3 concealcursor=n`, true)
    nvim.call('bufnr', ['%'], true)
    nvim.call('matchadd', ['Conceal', '^\\%u3000'], true)
    nvim.call('coc#util#do_autocmd', ['CocRefactorOpen'], true)
    workspace.registerLocalKeymap('n', '<CR>', async () => {
      let win = nvim.createWindow(winid)
      let currwin = await nvim.call('win_getid')
      let valid = await win.valid
      let lines = await nvim.eval('getline(4,line("."))') as string[]
      let len = lines.length
      for (let i = 0; i < len; i++) {
        let line = lines[len - i - 1]
        let ms = line.match(/^\u3000(.*?):(\d+):(\d+)/)
        if (ms) {
          let filepath = ms[1]
          let start = parseInt(ms[2], 10)
          let lnum = i == 0 ? start : start + i - 1
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
    let [res, err] = await nvim.resumeNotification()
    if (err) {
      logger.error(err)
      workspace.showMessage(`Error on open refactor window: ${err}`, 'error')
      return
    }
    let buffer = nvim.createBuffer(res[2])
    this.saveVariable(buffer.id, 'cwd', cwd)
    this.bufnr = res[2]
    nvim.pauseNotification()
    if (filetype) nvim.command(`runtime! syntax/${filetype}.vim`, true)
    highligher.render(buffer)
    nvim.command('setl nomod', true)
    await nvim.resumeNotification()
    return buffer
  }

  /**
   * Add FileItem to refactor buffer.
   */
  public async addFileItems(items: FileItem[], buffer: Buffer): Promise<void> {
    let count = await buffer.length
    let cwd = this.getVariable(buffer.id, 'cwd')
    let highligher = new Highlighter()
    let hlRanges: Range[] = []
    for (let item of items) {
      for (let range of item.ranges) {
        highligher.addLine(separator)
        highligher.addLine(separator)
        highligher.addText(`${cwd ? path.relative(cwd, item.filepath) : item.filepath}`, 'Label')
        highligher.addText(':')
        highligher.addText(String(range.start + 1), 'LineNr')
        highligher.addText(':')
        highligher.addText(String(range.end), 'LineNr')
        let base = 0 - highligher.length - count
        if (range.highlights) {
          hlRanges.push(...range.highlights.map(r => adjustRange(r, base)))
        }
        let { lines } = range
        if (!lines) lines = await this.getLines(item.filepath, range.start, range.end)
        highligher.addLines(lines)
      }
    }
    let { nvim } = this
    nvim.pauseNotification()
    highligher.render(buffer, count)
    nvim.command('setl nomod', true)
    if (count == 2 && hlRanges.length) {
      nvim.call('coc#util#jumpTo', [hlRanges[0].start.line, hlRanges[0].start.character], true)
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
   * Current changed file ranges
   */
  public async getFileChanges(buffer: Buffer): Promise<FileChange[]> {
    let { nvim } = this
    let bufnr = buffer.id
    let changes: FileChange[] = []
    let cwd = this.getVariable(bufnr, 'cwd')
    let lines = await buffer.lines
    lines.push(separator)
    // current lines
    let arr: string[] = []
    let fsPath: string
    let start: number
    let end: number
    for (let line of lines) {
      if (line.startsWith(separator)) {
        if (fsPath) {
          changes.push({
            filepath: fsPath,
            lines: arr,
            start: start - 1,
            end
          })
          fsPath = undefined
          arr = []
        }
        if (line.length > 1) {
          let ms = line.match(/^\u3000(.*?):(\d+):(\d+)/)
          if (ms) {
            fsPath = !path.isAbsolute(ms[1]) && cwd ? path.join(cwd, ms[1]) : ms[1]
            start = parseInt(ms[2], 10)
            end = parseInt(ms[3], 10)
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
    let changes = await this.getFileChanges(buffer)
    // filter changes that not change
    let removeList: number[] = []
    await Promise.all(changes.map((change, idx) => {
      return this.hasChange(change).then(changed => {
        if (!changed) removeList.push(idx)
      }, e => {
        logger.error(e)
      })
    }))
    changes = changes.filter((_, i) => !removeList.includes(i))
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
    await buffer.setOption('modified', false)
    await workspace.applyEdit({ changes: changeMap })
    await nvim.command('wa')
    return true
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

  private getFileItems(edit: WorkspaceEdit): FileItem[] {
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
      let max = this.getLineCount(key)
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

  private getLineCount(uri: string): number {
    let doc = workspace.getDocument(uri)
    if (doc) return doc.lineCount
    let content = fs.readFileSync(URI.parse(uri).fsPath, 'utf8')
    return content.split(/\r?\n/).length
  }

  private async getLines(fsPath: string, start: number, end: number): Promise<string[]> {
    let uri = URI.file(fsPath).toString()
    let doc = workspace.getDocument(uri)
    if (doc) return doc.getLines(start, end)
    return await readFileLines(fsPath, start, end - 1)
  }

  private async hasChange(fileChange: FileChange): Promise<boolean> {
    let { filepath, start, end, lines } = fileChange
    let curr = await this.getLines(filepath, start, end)
    if (curr.length == lines.length && equals(curr, lines)) {
      return false
    }
    return true
  }

  private saveVariable(bufnr: number, key: string, value: any): void {
    let obj = this.varibles.get(bufnr) || {}
    obj[key] = value
    this.varibles.set(bufnr, obj)
  }

  private getVariable(bufnr: number, key: string): any {
    let obj = this.varibles.get(bufnr) || {}
    return obj[key]
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
