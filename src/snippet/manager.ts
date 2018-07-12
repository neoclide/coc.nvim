import {Neovim} from 'neovim'
import {DidChangeTextDocumentParams, TextEdit} from 'vscode-languageserver-protocol'
import Document from '../model/document'
import {getChangeItem} from '../util/diff'
import workspace from '../workspace'
import {Placeholder} from './parser'
import Snippet from './snippet'
import {wait, isLineEdit} from '../util'
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

  public get isActivted(): boolean {
    return this.activted
  }

  public init(nvim: Neovim): void {
    this.nvim = nvim
    workspace.onDidChangeTextDocument(this.onDocumentChange, this)
    workspace.onDidCloseTextDocument(textDocument => {
      if (textDocument.uri == this.uri) {
        this.detach().catch(onError)
      }
    })
  }

  public async attach(): Promise<void> {
    let {snippet, document} = this
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

  public async detach(): Promise<void> {
    if (!this.activted) return
    this.activted = false
    this.uri = ''
    if (!this.snippet.hasPlaceholder) return
    this.snippet = null
    try {
      await this.nvim.call('coc#snippet#disable')
    } catch (e) {
      onError(e)
    }
  }

  public get document(): Document {
    return workspace.getDocument(this.uri)
  }

  private async onLineChange(content: string): Promise<void> {
    let {snippet, document} = this
    if (!document) return
    let text = snippet.toString()
    let change = getChangeItem(text, content)
    if (!change) return
    let [placeholder, start] = snippet.findPlaceholder(change, change.offset)
    if (!placeholder || placeholder.index == 0) {
      await this.detach()
      return
    }
    let newText = snippet.getNewText(change, placeholder, start)
    snippet.replaceWith(placeholder, newText)
    let {buffer} = document
    let line = snippet.toString()
    this.changedtick = document.changedtick
    if (line == content) return
    await buffer.setLines(line, {
      start: this.startLnum,
      strictIndexing: true
    })
  }

  public async insertSnippet(document: Document, line: number, newLine: string, prepend:string, append:string): Promise<void> {
    if (this.activted) await this.detach()
    try {
      let {buffer} = document
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
    let {snippet, nvim, startLnum} = this
    let offset = snippet.offset(marker)
    let col = offset + 1
    let len = marker.toString().length
    let choice = marker.choice
    if (choice) {
      let values = choice.options.map(o => o.value)
      await nvim.call('coc#snippet#show_choices', [startLnum + 1, col, len, values])
    } else {
      await nvim.call('coc#snippet#range_select', [startLnum + 1, col, len])
    }
    this.currIndex = marker.index
  }

  public async jumpNext(): Promise<void> {
    let {currIndex, snippet} = this
    let {maxIndex} = snippet
    let valid = await this.checkPosition()
    if (!valid) return
    let idx: number
    if (currIndex == maxIndex) {
      idx = 0
    } else {
      idx = currIndex + 1
    }
    let {placeholders} = snippet.textmateSnippet
    let placeholder = placeholders.find(p => p.index == idx)
    this.currIndex = idx
    if (placeholder) await this.jumpTo(placeholder)
  }

  public async jumpPrev(): Promise<void> {
    let {currIndex, snippet} = this
    let {maxIndex} = snippet
    let valid = await this.checkPosition()
    if (!valid) return
    let idx: number
    if (currIndex == 0) {
      idx = maxIndex
    } else {
      idx = currIndex - 1
    }
    let {placeholders} = snippet.textmateSnippet
    let placeholder = placeholders.find(p => p.index == idx)
    this.currIndex = idx
    if (placeholder) await this.jumpTo(placeholder)
  }

  public async checkPosition(): Promise<boolean> {
    let lnum = await this.nvim.call('line', ['.'])
    if (lnum - 1 != this.startLnum) {
      await this.detach()
      return false
    }
    return true
  }

  /**
   * Check the real current line
   *
   * @private
   */
  private async ensureCurrentLine(): Promise<void> {
    let {document, startLnum} = this
    if (!document) return
    // need this to make sure we have current line
    await wait(20)
    let line = this.snippet.toString()
    let currline = document.getline(startLnum)
    if (line == currline) return
    await this.onLineChange(currline)
  }

  private onDocumentChange(e: DidChangeTextDocumentParams): void {
    let {startLnum, document, uri, activted} = this
    let {textDocument, contentChanges} = e
    if (!activted || !document || uri !== textDocument.uri) return
    // fired by snippet manager
    if (document.changedtick - this.changedtick == 1) return
    let valid = true
    if (contentChanges.length > 1) {
      valid = false
    } else {
      let edit:TextEdit = {
        range: contentChanges[0].range,
        newText: contentChanges[0].text
      }
      if (edit.range == null || !isLineEdit(edit, startLnum)) {
        valid = false
      }
    }
    if (!valid) {
      this.detach().catch(onError)
      return
    }
    let newLine = document.getline(startLnum)
    this.onLineChange(newLine).catch(onError)
  }
}

export default new SnippetManager()
