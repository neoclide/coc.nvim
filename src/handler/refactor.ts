import { Neovim, Buffer } from '@chemzqm/neovim'
import fs from 'fs'
import path from 'path'
import { Range, TextDocumentEdit, TextEdit, WorkspaceEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import languages from '../languages'
import commands from '../commands'
import Highlighter from '../model/highligher'
import { readFileLines } from '../util/fs'
import workspace from '../workspace'
const logger = require('../util/logger')('refactor')

const name = '__coc_refactor__'

export interface FileRange {
  // start line 0 indexed
  start: number
  // end line 0 indexed
  end: number
  // range relatived to new range
  highlights: Range[]
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
}

export default class Refactor {
  private id = 0
  private nvim: Neovim
  private bufnr: number
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

  public async start(): Promise<void> {
    let [bufnr, cursor, winid] = await this.nvim.eval('[bufnr("%"),coc#util#cursor(),win_getid()]') as [number, [number, number], number]
    let doc = workspace.getDocument(bufnr)
    if (!doc) return
    let position = { line: cursor[0], character: cursor[1] }
    let res = await languages.prepareRename(doc.textDocument, position)
    if (res === false) {
      workspace.showMessage('Invalid position for rename', 'error')
      return
    }
    let edit = await languages.provideRenameEdits(doc.textDocument, position, 'newname')
    if (!edit) {
      workspace.showMessage('Server return empty response', 'warning')
      return
    }
    let items = this.getFileItems(edit)
    let buf = await this.createRefactorBuffer(winid)
    await this.addFileItems(items, buf)
  }

  public async createRefactorBuffer(winid: number): Promise<Buffer> {
    let { nvim, bufnr } = this
    if (bufnr) await nvim.command(`silent! ${bufnr}bd!`)
    let { openCommand } = this.config
    let highligher = new Highlighter()
    highligher.addLine('Save current buffer to make changes', 'Comment')
    highligher.addLine('—')
    highligher.addLine('—')
    nvim.pauseNotification()
    nvim.command(`${openCommand} ${name}${this.id++}`, true)
    nvim.command(`setl buftype=acwrite nobuflisted bufhidden=hide nofen wrap conceallevel=3 concealcursor=n`, true)
    nvim.call('bufnr', ['%'], true)
    nvim.call('matchadd', ['Conceal', '^—'], true)
    nvim.call('coc#util#do_autocmd', ['CocRefactorOpen'], true)
    workspace.registerLocalKeymap('n', '<CR>', async () => {
      let currwin = await nvim.call('win_getid')
      let lines = await nvim.eval('getline(4,line("."))') as string[]
      let len = lines.length
      for (let i = 0; i < len; i++) {
        let line = lines[len - i - 1]
        let ms = line.match(/^—(.*?):(\d+):(\d+)/)
        if (ms) {
          let filepath = ms[1]
          let start = parseInt(ms[2], 10)
          let lnum = i == 0 ? start : start + i - 1
          let bufname = filepath.startsWith(workspace.cwd) ? path.relative(workspace.cwd, filepath) : filepath
          nvim.pauseNotification()
          nvim.call('win_gotoid', [winid], true)
          this.nvim.call('coc#util#jump', ['edit', bufname, [lnum, 1]], true)
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
    this.bufnr = res[2]
    nvim.pauseNotification()
    highligher.render(buffer)
    nvim.command('setl nomod', true)
    await nvim.resumeNotification()
    return buffer
  }

  public async addFileItems(items: FileItem[], buffer: Buffer): Promise<void> {
    let count = await buffer.length
    let highligher = new Highlighter()
    let hlRanges: Range[] = []
    for (let item of items) {
      for (let range of item.ranges) {
        // range.highlights
        highligher.addLine('—')
        highligher.addText(`${item.filepath}`, 'Label')
        highligher.addText(':')
        highligher.addText(String(range.start + 1), 'LineNr')
        highligher.addText(':')
        highligher.addText(String(range.end), 'LineNr')
        let base = 0 - highligher.length - count
        hlRanges.push(...range.highlights.map(r => adjustRange(r, base)))
        let { lines } = range
        if (!lines) lines = await this.getLines(item.filepath, range.start, range.end)
        highligher.addLines(lines)
        highligher.addLine('—')
      }
    }
    let { nvim } = this
    nvim.pauseNotification()
    highligher.render(buffer, count)
    nvim.command('setl nomod', true)
    if (count == 3) {
      nvim.call('coc#util#jumpTo', [hlRanges[0].start.line, hlRanges[0].start.character], true)
    }
    await nvim.resumeNotification()
    try {
      await this.ensureDocument(buffer.id)
    } catch (e) {
      logger.error(e)
      return
    }
    await commands.executeCommand('editor.action.addRanges', hlRanges)
  }

  private async ensureDocument(bufnr: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let n = 0
      let interval = setInterval(() => {
        let doc = workspace.getDocument(bufnr)
        if (doc) {
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
        if (start != null && s <= end) {
          end = Math.min(max, line + afterContext)
          highlights.push(adjustRange(edit.range, start))
        } else {
          if (start != null) ranges.push({ start, end, highlights })
          start = s
          end = Math.min(max, line + afterContext)
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
    if (doc) return doc.getLines(start, end + 1)
    return await readFileLines(fsPath, start, end)
  }

  public async saveRefactor(bufnr: number): Promise<void> {
    let { nvim } = this
    let buffer = nvim.createBuffer(bufnr)
    let lines = await buffer.lines
    let changes: { [uri: string]: TextEdit[] } = {}
    let arr: string[] = []
    let uri: string
    let start: number
    let end: number
    for (let line of lines.slice(3)) {
      if (line.startsWith('—') && line.length == 1 && uri) {
        let edits = changes[uri] || []
        let r = Range.create(start - 1, 0, end, 0)
        edits.push(TextEdit.replace(r, arr.join('\n') + '\n'))
        changes[uri] = edits
        arr = []
      } else if (line.startsWith('—')) {
        let ms = line.match(/^—(.*?):(\d+):(\d+)/)
        if (ms) {
          uri = URI.file(ms[1]).toString()
          start = parseInt(ms[2], 10)
          end = parseInt(ms[3], 10)
        } else {
          arr.push(line)
        }
      } else {
        arr.push(line)
      }
    }
    await workspace.applyEdit({ changes })
    await buffer.setOption('modified', false)
    nvim.command('wa', true)
  }
}

function adjustRange(range: Range, offset: number): Range {
  let { start, end } = range
  return Range.create(start.line - offset, start.character, end.line - offset, end.character)
}
