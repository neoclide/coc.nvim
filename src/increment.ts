import {Neovim} from 'neovim'
import {CompleteOption, VimCompleteItem} from './types'
import {setConfig, getConfig} from './config'
import Input from './input'
import buffers from './buffers'
import completes from './completes'
const logger = require('./util/logger')('increment')

export interface CompleteDone {
  word: string
  timestamp: number
  colnr: number
  linenr: number
  changedtick: number
}

export interface InsertedChar {
  character: string
  timestamp: number
}

export interface ChangedI {
  linenr: number
  colnr: number
  changedtick: number
}

export class Increment {
  public activted: boolean
  public input: Input | null | undefined
  public done: CompleteDone | null | undefined
  public lastInsert: InsertedChar | null | undefined
  public option: CompleteOption | null | undefined
  public changedI: ChangedI | null | undefined

  constructor() {
    this.activted = false
  }

  public isKeyword(str: string):boolean {
    let {document} = buffers
    return document ? document.isWord(str) : /^\w$/.test(str)
  }

  public async stop(nvim:Neovim):Promise<void> {
    if (!this.activted) return
    logger.debug('increment stop')
    this.activted = false
    if (this.input) await this.input.clear()
    this.done = this.input = this.option = this.changedI = null
    let completeOpt = getConfig('completeOpt')
    completes.reset()
    await nvim.call('execute', [`noa set completeopt=${completeOpt}`])
  }

  public async start(nvim:Neovim):Promise<void> {
    this.activted = true
    let completeOpt = await nvim.getOption('completeopt')
    setConfig({completeOpt})
    await nvim.call('execute', [`noa set completeopt=menuone,noinsert`])
  }

  public setOption(opt: CompleteOption):void {
    this.option = opt
  }

  private isCompleteItem(item: VimCompleteItem):boolean {
    let {user_data} = item
    if (!user_data) return false
    try {
      let res = JSON.parse(user_data)
      return res.cid != null
    } catch (e) {
      return false
    }
  }

  public async onComplete(nvim:Neovim):Promise<void> {
    let {option} = this
    if (!option) return
    let [_, lnum, colnr] = await nvim.call('getcurpos', [])
    let changedtick = await nvim.eval('b:changedtick')
    let item = await nvim.getVvar('completed_item')
    // if (!item || !item.word) return
    if (Object.keys(item).length && !this.isCompleteItem(item)) {
      await this.stop(nvim)
      return
    }
    this.done = {
      word: item.word ||'',
      timestamp: Date.now(),
      colnr: Number(colnr),
      linenr: Number(lnum),
      changedtick: Number(changedtick)
    }
    logger.debug(JSON.stringify(this.done))
  }

  public async onCharInsert(nvim:Neovim):Promise<void> {
    let ch = await nvim.getVvar('char')
    this.lastInsert = {
      character: ch,
      timestamp: Date.now()
    }
    let {activted, input} = this
    if (activted && !this.isKeyword(ch)) {
      await this.stop(nvim)
    }
  }

  public async onTextChangeI(nvim:Neovim):Promise<boolean> {
    let {option, activted, done, lastInsert} = this
    if (!option) return false
    let [_, linenr, colnr] = await nvim.call('getcurpos', [])
    let bufnr = await nvim.call('bufnr', ['%'])
    if (bufnr.toString() != option.bufnr || linenr != option.linenr) {
      await this.stop(nvim)
      return false
    }
    let changedtick = await nvim.eval('b:changedtick')
    changedtick = Number(changedtick)
    logger.debug(changedtick)
    let lastChanged = Object.assign({}, this.changedI)
    this.changedI = {
      linenr,
      colnr,
      changedtick
    }
    let ts = Date.now()
    if (!activted) {
      let {input, col, linenr} = option
      if (done && ts - done.timestamp < 50) {
        if (changedtick - done.changedtick !== 1) return false
        if (done.word && !this.isKeyword(done.word)) return false
        if (lastInsert && ts - lastInsert.timestamp < 50) {
          // user add one charactor on complete
          this.input = new Input(nvim, linenr, input, done.word, col)
          await this.input.addCharactor(lastInsert.character)
          await this.start(nvim)
          return true
        }
        if (done.colnr - colnr === 1) {
          // user remove one charactor on complete
          this.input = new Input(nvim, linenr, input, done.word, col)
          let invalid = await this.input.removeCharactor()
          if (!invalid) {
            await this.start(nvim)
            return true
          }
        }
      }
    } else {
      if (lastInsert && ts - lastInsert.timestamp < 50
        && colnr - lastChanged.colnr === 1) {
        await this.input.addCharactor(lastInsert.character)
        return true
      }
      if (lastChanged.colnr - colnr === 1) {
        let invalid = await this.input.removeCharactor()
        if (invalid) {
          await this.stop(nvim)
          return false
        }
        return true
      }
      await this.stop(nvim)
      return false
    }
    return false
  }
}

export default new Increment()
