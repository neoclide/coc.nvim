import {Neovim, Buffer} from 'neovim'
import {
  DidChangeTextDocumentParams,
  Position,
} from 'vscode-languageserver-protocol'
import {
  Placeholder,
} from './parser'
import {
  getUri,
} from '../util'
import {
  getChangeItem,
} from '../util/diff'
import Snippet from './snippet'
import workspace from '../workspace'
import EventEmitter = require('events')
const logger = require('../util/logger')('snippet-manager')

function onError(err):void {
  logger.error(err.stack)
}

export class SnippetManager {
  private snippet: Snippet
  private buffer: Buffer | null = null
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

  public init(nvim:Neovim, emitter:EventEmitter):void {
    this.nvim = nvim
    workspace.onDidChangeTextDocument(this.onDocumentChange, this)
  }

  public async attach():Promise<void> {
    let {snippet} = this
    if (!snippet) return
    let linenr = await workspace.nvim.call('line', ['.']) as number
    this.startLnum = linenr - 1
    // let buffer = this.buffer = await this.nvim.buffer
    let placeholder = snippet.fiistPlaceholder
    if (placeholder) {
      await this.jumpTo(placeholder, true)
    }
    await this.nvim.call('coc#snippet#enable')
    this.activted = true
  }

  public async detach():Promise<void> {
    if (!this.activted) return
    logger.debug('== snippet canceled ==')
    let {id} = this.buffer
    this.activted = false
    this.buffer = null
    this.uri = ''
    this.currIndex = -1
    try {
      let bufnr = await this.nvim.call('bufnr', ['%'])
      if (bufnr == id) {
        await this.nvim.call('coc#snippet#disable')
      }
    } catch (e) {
      onError(e)
    }
  }

  private async onLineChange(tick:number, content:string):Promise<void> {
    this.changedtick = tick
    let {snippet, buffer} = this
    let text = snippet.toString()
    if (text == content) return
    let change = getChangeItem(text, content)
    if (!change) return
    let [placeholder, start] = snippet.findPlaceholder(change, change.offset)
    if (!placeholder || placeholder.index == 0) {
      await this.detach()
      return
    }
    let newText = snippet.getNewText(change, placeholder, start)
    snippet.replaceWith(placeholder, newText)
    let result = snippet.toString()
    let currTick = await buffer.changedtick
    if (currTick !== tick) return
    await buffer.setLines(result, {
      start: this.startLnum,
      end: this.startLnum + 1,
      strictIndexing: true
    })
  }

  public async insertSnippet(lnum:number, newLine:string):Promise<void> {
    if (this.activted) {
      await this.detach()
    }
    let buffer = this.buffer = await this.nvim.buffer
    let name = await buffer.name
    this.uri = getUri(name, buffer.id)
    this.snippet = new Snippet(newLine)
    let str = this.snippet.toString()
    await this.nvim.call('setline', [lnum + 1, str])
  }

  public async jumpTo(marker: Placeholder, silent = false):Promise<void> {
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
    let bufnr = this.buffer.id
    let line = this.startLnum
    let currline = this.snippet.toString()
    let document = workspace.getDocument(bufnr)
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
    let {id} = this.buffer
    let document = workspace.getDocument(id)
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
