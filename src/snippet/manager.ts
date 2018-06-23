import {Neovim, Buffer} from 'neovim'
import {
  DidChangeTextDocumentParams,
  Position,
} from 'vscode-languageserver-protocol'
import {
  Placeholder,
} from './parser'
import {
  getChangeItem,
} from '../util/diff'
import Snippet from './snippet'
import workspace from '../workspace'
import Document from '../model/document'
const logger = require('../util/logger')('snippet-manager')

function onError(err):void {
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

  public get isActivted():boolean {
    return this.activted
  }

  public init(nvim:Neovim):void {
    this.nvim = nvim
    workspace.onDidChangeTextDocument(this.onDocumentChange, this)
    workspace.onDidCloseTextDocument(textDocument => {
      if (textDocument.uri == this.uri) {
        this.detach().catch(onError)
      }
    })
  }

  public async attach():Promise<void> {
    let {snippet} = this
    if (!snippet) return
    let linenr = await workspace.nvim.call('line', ['.']) as number
    this.startLnum = linenr - 1
    let placeholder = snippet.firstPlaceholder
    if (placeholder) {
      await this.jumpTo(placeholder)
    }
    if (snippet.hasPlaceholder) {
      await this.nvim.call('coc#snippet#enable')
    }
    this.activted = true
  }

  public async detach():Promise<void> {
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

  private async onLineChange(tick:number, content:string):Promise<void> {
    this.changedtick = tick
    let {snippet} = this
    let text = snippet.toString()
    if (text == content) return
    let change = getChangeItem(text, content)
    let document = workspace.getDocument(this.uri)
    if (!change || !document) return
    let [placeholder, start] = snippet.findPlaceholder(change, change.offset)
    if (!placeholder || placeholder.index == 0) {
      await this.detach()
      return
    }
    let newText = snippet.getNewText(change, placeholder, start)
    snippet.replaceWith(placeholder, newText)
    let result = snippet.toString()
    let currTick = document.version
    if (currTick !== tick) return
    let {buffer} = document
    await buffer.setLines(result, {
      start: this.startLnum,
      strictIndexing: true
    })
  }

  public async insertSnippet(document: Document,line:number, newLine:string):Promise<void> {
    if (this.activted) {
      await this.detach()
    }
    try {
      let {buffer} = document
      this.uri = document.uri
      this.snippet = new Snippet(newLine)
      let str = this.snippet.toString()
      await buffer.setLines(str, {
        start: line,
        strictIndexing: true
      })
    } catch (e) {
      logger.error(e.message)
    }
  }

  public async jumpTo(marker: Placeholder):Promise<void> {
    // await this.ensureCurrentLine()
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

  public async jumpNext():Promise<void> {
    let {currIndex, snippet} = this
    let {maxIndex} = snippet
    let idx:number
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

  public async jumpPrev():Promise<void> {
    let {currIndex, snippet} = this
    let {maxIndex} = snippet
    let idx:number
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

  /**
   * Check the real current line
   *
   * @private
   */
  private async ensureCurrentLine():Promise<void> {
    let line = this.startLnum
    let currline = this.snippet.toString()
    let document = workspace.getDocument(this.uri)
    if (!document) return
    let content = document.getline(line)
    if (content == currline) return
    await this.onLineChange(document.version, content)
  }

  private onDocumentChange(e: DidChangeTextDocumentParams): void {
    if (!this.activted) return
    let {uri, version} = e.textDocument
    if (uri !== this.uri) return
    if (this.changedtick && this.changedtick >= version) return
    let {startLnum} = this
    let changes = e.contentChanges
    for (const { range, text } of changes) {
      // check if change valid
      if (!range
        || range.start.line !== startLnum
        || !this.validEndline(range.end, text)) {
        this.detach().catch(onError)
        return
      }
    }
    let document = workspace.getDocument(this.uri)
    if (!document) return
    let newLine = document.getline(startLnum)
    this.onLineChange(document.version, newLine).catch(onError)
  }

  private validEndline(end:Position, text):boolean {
    let {startLnum} = this
    let {line, character} = end
    if (line == startLnum) return true
    if (line == startLnum + 1 && character == 0 && text.slice(-1) == '\n') {
      return true
    }
    return false
  }
}

export default new SnippetManager()
