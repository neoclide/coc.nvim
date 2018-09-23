import { Neovim } from '@chemzqm/neovim'
import { DidChangeTextDocumentParams, TextEdit, Disposable } from 'vscode-languageserver-protocol'
import Document from '../model/document'
import { getChangeItem } from '../util/diff'
import workspace from '../workspace'
import { Placeholder } from './parser'
import Snippet from './snippet'
import { wait, isLineEdit, disposeAll } from '../util'
import events from '../events'
const logger = require('../util/logger')('snippet-manager')

function onError(err): void {
  logger.error(err.stack)
}

export class SnippetManager {
  private snippet: Snippet
  private activted = false
  // zero indexed
  private startLnum: number
  private uri: string
  private nvim: Neovim
  private currIndex = -1
  private changedtick: number
  private disposables: Disposable[] = []

  constructor() {
    Object.defineProperty(this, 'nvim', {
      get: () => {
        return workspace.nvim
      }
    })
    workspace.onDidChangeTextDocument(this.onDocumentChange, this, this.disposables)
    workspace.onDidCloseTextDocument(textDocument => {
      if (textDocument.uri == this.uri) {
        this.detach()
      }
    }, null, this.disposables)
    events.on('InsertLeave', async () => {
      let {mode} = await this.nvim.mode
      if (mode == 'n') {
        this.detach()
      }
    }, null, this.disposables)
  }

  public get isActivted(): boolean {
    return this.activted
  }

  public async attach(): Promise<void> {
    let { snippet, document } = this
    if (!snippet || !document) return
    let linenr = await workspace.nvim.call('line', ['.']) as number
    this.startLnum = linenr - 1
    let placeholder = snippet.firstPlaceholder
    if (placeholder) await this.jumpTo(placeholder)
    if (snippet.hasPlaceholder) {
      await this.nvim.call('coc#snippet#enable')
    }
    this.activted = true
  }

  public detach(): void {
    if (!this.activted) return
    this.activted = false
    this.uri = ''
    if (!this.snippet.hasPlaceholder) return
    this.snippet = null
    this.nvim.call('coc#snippet#disable', [], true)
  }

  public get document(): Document {
    return workspace.getDocument(this.uri)
  }

  private async onLineChange(content: string): Promise<void> {
    let { snippet, document } = this
    if (!document) return
    let text = snippet.toString()
    if (text == content) return
    let change = getChangeItem(text, content)
    if (!change) return
    let [placeholder, start] = snippet.findPlaceholder(change, change.offset)
    if (!placeholder) {
      this.detach()
      return
    }
    let newText = snippet.getNewText(change, placeholder, start)
    snippet.replaceWith(placeholder, newText)
    let { buffer } = document
    let line = snippet.toString()
    this.changedtick = document.changedtick
    if (line == content) return
    await buffer.setLines(line, {
      start: this.startLnum,
      strictIndexing: true
    })
  }

  public async insertSnippet(document: Document, line: number, newLine: string, prepend: string, append: string): Promise<void> {
    if (this.activted) this.detach()
    try {
      let { buffer } = document
      this.uri = document.uri
      this.snippet = new Snippet(newLine, prepend, append)
      let str = this.snippet.toString()
      this.changedtick = document.changedtick
      await buffer.setLines(str, {
        start: line,
        strictIndexing: true
      })
    } catch (e) {
      logger.error(e.message)
    }
  }

  public async jumpTo(marker: Placeholder): Promise<void> {
    // need this since TextChangedP doesn't fire contentChange
    await this.ensureCurrentLine()
    let { snippet, nvim, startLnum } = this
    let offset = snippet.offset(marker)
    let col = offset + 1
    let len = marker.toString().length
    let choice = marker.choice
    if (choice) {
      let values = choice.options.map(o => o.value)
      nvim.call('coc#snippet#show_choices', [startLnum + 1, col, len, values], true)
    } else {
      nvim.call('coc#snippet#range_select', [startLnum + 1, col, len], true)
    }
    this.currIndex = marker.index
  }

  public async jumpNext(): Promise<void> {
    let { currIndex, snippet } = this
    let { maxIndex } = snippet
    let idx: number
    if (currIndex == maxIndex) {
      idx = 0
    } else {
      idx = currIndex + 1
    }
    let { placeholders } = snippet.textmateSnippet
    let placeholder = placeholders.find(p => p.index == idx)
    this.currIndex = idx
    if (placeholder) await this.jumpTo(placeholder)
  }

  public async jumpPrev(): Promise<void> {
    let { currIndex, snippet } = this
    let { maxIndex } = snippet
    let idx: number
    if (currIndex == 0) {
      idx = maxIndex
    } else {
      idx = currIndex - 1
    }
    let { placeholders } = snippet.textmateSnippet
    let placeholder = placeholders.find(p => p.index == idx)
    this.currIndex = idx
    if (placeholder) await this.jumpTo(placeholder)
  }

  /**
   * Check the real current line
   *
   * @private
   */
  private async ensureCurrentLine(): Promise<void> {
    let { document, startLnum } = this
    if (!document) return
    // need this to make sure we have current line
    await wait(20)
    await this.onLineChange(document.getline(startLnum))
  }

  private onDocumentChange(e: DidChangeTextDocumentParams): void {
    let { startLnum, document, uri, activted } = this
    let { textDocument, contentChanges } = e
    if (!activted || !document || uri !== textDocument.uri) return
    // fired by snippet manager
    if (document.changedtick - this.changedtick == 1) return
    let valid = true
    let edit: TextEdit = {
      range: contentChanges[0].range,
      newText: contentChanges[0].text
    }
    if (edit.range == null || !isLineEdit(edit, startLnum)) {
      valid = false
    }
    if (!valid) {
      this.detach()
      return
    }
    let newLine = document.getline(startLnum)
    this.onLineChange(newLine).catch(onError)
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

export default new SnippetManager()
