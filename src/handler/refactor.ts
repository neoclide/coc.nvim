import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import { Range, TextDocumentEdit, WorkspaceEdit, TextEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { readFileLines } from '../util/fs'
import Highlighter, { HighlightItem } from '../model/highligher'
import languages from '../languages'
import workspace from '../workspace'
import { byteIndex } from '../util/string'
const logger = require('../util/logger')('refactor')

const name = '__coc_refactor__'

export interface FileRange {
  // start line 0 indexed
  start: number
  // end line 0 indexed
  end: number
  // range relatived to new range
  highlights: Range[]
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
  private config: RefactorConfig
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
    let [bufnr, cursor] = await this.nvim.eval('[bufnr("%"),coc#util#cursor()]') as [number, [number, number]]
    let doc = workspace.getDocument(bufnr)
    if (!doc) return
    let position = { line: cursor[0], character: cursor[1] }
    let res = await languages.prepareRename(doc.textDocument, position)
    if (res === false) {
      workspace.showMessage('Invalid position for rename', 'error')
      return
    }
    let curname: string
    if (res == null) {
      let range = doc.getWordRangeAtPosition(position)
      if (range) curname = doc.textDocument.getText(range)
    } else {
      if (Range.is(res)) {
        let line = doc.getline(res.start.line)
        curname = line.slice(res.start.character, res.end.character)
      } else {
        curname = res.placeholder
      }
    }
    if (!curname) {
      workspace.showMessage('Invalid position', 'warning')
      return
    }
    let edit = await languages.provideRenameEdits(doc.textDocument, position, 'newname')
    if (!edit) {
      workspace.showMessage('Server return empty response', 'warning')
      return
    }
    let items = this.getFileItems(edit)
    await this.createRefactorWindow(items, curname)
  }

  public async createRefactorWindow(items: FileItem[], curname: string): Promise<void> {
    let { nvim } = this
    let highligher = new Highlighter()
    highligher.addLine('Save current buffer to make changes', 'Comment')
    highligher.addLine('—')
    for (let item of items) {
      for (let range of item.ranges) {
        highligher.addLine('—')
        highligher.addText(`${item.filepath}`, 'Label')
        highligher.addText(':')
        highligher.addText(String(range.start + 1), 'LineNr')
        highligher.addText(':')
        highligher.addText(String(range.end + 1), 'LineNr')
        let start = highligher.length
        let lines = await this.getLines(item.filepath, range.start, range.end)
        highligher.addLines(lines)
        highligher.addLine('—')
      }
    }
    let { openCommand } = this.config
    nvim.pauseNotification()
    nvim.command(`${openCommand} ${name}${this.id++}`, true)
    nvim.command(`setl buftype=acwrite nobuflisted bufhidden=hide nofen wrap conceallevel=3 concealcursor=n`, true)
    nvim.call('bufnr', ['%'], true)
    nvim.call('matchadd', ['Conceal', '^—'], true)
    nvim.call('coc#util#do_autocmd', ['CocRefactorOpen'], true)
    let [res, err] = await nvim.resumeNotification()
    if (err) {
      logger.error(err)
      workspace.showMessage(`Error on open refactor window: ${err}`, 'error')
      return
    }
    let buffer = nvim.createBuffer(res[2])
    nvim.pauseNotification()
    highligher.render(buffer)
    nvim.command('exe 1', true)
    nvim.command('setl nomod', true)
    nvim.command(`execute 'normal! /\\<'.escape('${curname.replace(/'/g, "''")}', '\\\\/.*$^~[]')."\\\\>\\<cr>"`, true)
    await nvim.resumeNotification()
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
    for (let line of lines.slice(2)) {
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
    nvim.command('setl nomod', true)
    nvim.command('noa wa', true)
  }
}

function adjustRange(range: Range, offset: number): Range {
  let { start, end } = range
  return Range.create(start.line - offset, start.character, end.line - offset, end.character)
}
