import {Neovim} from 'neovim'
import {
  echoMessage
} from '../util/index'
import {
  Placeholder,
} from './parser'
import {
  VimCompleteItem
} from '../types'
import Snippet, {Change} from './snippet'
import EventEmitter = require('events')
const logger = require('../util/logger')('snippet-manager')

function onError(err):void {
  logger.error(err.stack)
}

export class SnippetManager {
  private snippet: Snippet
  // zero indexed
  private startLnum: number
  private startCharacter: number
  private startPart: string
  private endPart: string
  private activted = false
  private bufnr:number
  private unlisten: Function
  private changedTick = 0
  private nvim: Neovim
  private currIndex = -1

  constructor() {
    this.onBufferLinesChange = this.onBufferLinesChange.bind(this)
  }

  public get isActivted():boolean {
    return this.activted
  }

  public init(nvim:Neovim, emitter:EventEmitter):void {
    this.nvim = nvim
    emitter.on('BufUnload', async bufnr => {
      if (bufnr == this.bufnr) {
        await this.detach()
      }
    })
    emitter.on('BufLeave', async  bufnr => {
      if (bufnr == this.bufnr) {
        await this.detach()
      }
    })
    emitter.on('InsertEnter', async () => {
      try {
        let lnum = await this.nvim.call('line', ['.'])
        if (lnum - 1 != this.startLnum) {
          await this.detach()
        }
      } catch (e) {
        onError(e)
      }
    })
    emitter.on('TextChangedP', async (item:VimCompleteItem) => {
      if (!this.activted || !item.word) return
      let lnum = await this.nvim.call('line', ['.'])
      if (lnum != this.startLnum) return
      let line = await this.nvim.call('getline', [''])
      let changedTick = await this.nvim.eval('b:changedtick') as number
      await this.onLineChange(changedTick, line)
    })
  }

  private async attach():Promise<void> {
    let buffer = await this.nvim.buffer
    this.bufnr = buffer.id
    this.unlisten = buffer.listen('lines', this.onBufferLinesChange)
    this.activted = true
  }

  public async detach(silent = false):Promise<void> {
    if (!this.activted) return
    logger.debug('detached')
    this.activted = false
    this.currIndex = -1
    try {
      if (!silent) {
        await echoMessage(this.nvim, 'snippet canceled')
      }
      this.unlisten()
      this.unlisten = null
      let bufnr = await this.nvim.call('bufnr', ['%'])
      if (bufnr == this.bufnr) {
        await this.nvim.call('coc#snippet#disable')
      }
    } catch (e) {
      onError(e)
    }
  }

  private onBufferLinesChange(
    buf:Buffer,
    tick:number,
    firstline:number,
    lastline:number,
    linedata:string[],
    more:boolean
  ):void {
    let {startLnum} = this
    // ignore changes after and triggered by manager
    if (!tick
      || tick - this.changedTick == 1
      || firstline > startLnum) return
    if (lastline <= startLnum) {
      let c = linedata.length - (lastline - firstline)
      this.startLnum = this.startLnum + c
      return
    }
    if (more
      || linedata.length != 1
      || firstline != startLnum
      || lastline - firstline != 1) {
      this.detach().catch(onError)
      return
    }
    this.onLineChange(tick, linedata[0]).catch(e => {
      logger.error(e.stack)
    })
  }

  public checkContent(content:string):boolean {
    let {startCharacter, startPart, endPart} = this
    if (content.slice(0, startCharacter) !== startPart
      ||(endPart.length && content.slice(- endPart.length) !== endPart)) {
      return false
    }
    return true
  }

  public async onLineChange(tick:number, content:string):Promise<void> {
    let {startCharacter, snippet, nvim, startPart, endPart} = this
    if (!this.checkContent(content)) {
      await this.detach()
      return
    }
    let text = endPart.length
              ? content.slice(startCharacter, - endPart.length)
              : content.slice(startCharacter)
    let change = snippet.getChange(text)
    if (!change) {
      await this.detach()
      return
    }
    let [placeholder, start] = snippet.findPlaceholder(change, change.offset)
    if (!placeholder || placeholder.index == 0) {
      await this.detach()
      return
    }
    let newText = snippet.getNewText(change, placeholder, start)
    snippet.replaceWith(placeholder, newText)
    let result = `${startPart}${snippet.toString()}${endPart}`
    if (result !== content) {
      let buffer = await nvim.buffer
      let currTick = await buffer.getVar('changedtick')
      if (currTick !== tick) return
      this.changedTick = tick
      await buffer.setLines(result, {
        start: this.startLnum,
        end: this.startLnum + 1,
        strictIndexing: true
      })
    }
  }

  public async insertSnippet(lnum:number, character:number, line:string, content:string):Promise<void> {
    if (this.activted) {
      await this.detach()
    }
    this.activted = true
    this.startLnum = lnum
    this.startCharacter = character
    this.startPart = line.slice(0, character)
    this.endPart = line.slice(character)
    let snippet = this.snippet = new Snippet(content)
    let newText = this.snippet.toString()
    let newLine = `${this.startPart}${newText}${this.endPart}`
    await this.nvim.call('setline', [lnum + 1, newLine])
    let placeholder = snippet.fiistPlaceholder
    if (placeholder) await this.jumpTo(placeholder, true)
    await this.nvim.call('coc#snippet#enable')
    await this.attach()
  }

  public async jumpTo(marker: Placeholder, silent = false):Promise<void> {
    let {snippet, nvim, startLnum, startCharacter} = this
    let offset = snippet.offset(marker)
    let col = startCharacter + offset + 1
    let len = marker.toString().length
    await nvim.call('coc#snippet#range_select', [startLnum + 1, col, len])
    this.currIndex = marker.index
    if (marker.index == 0) {
      await this.detach(silent)
    }
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
}

export default new SnippetManager()
