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

const MAX_DURATION = 50

export default class Increment {
  private nvim:Neovim
  public activted: boolean
  public input: Input | null | undefined
  public done: CompleteDone | null | undefined
  public lastInsert: InsertedChar | null | undefined
  public option: CompleteOption | null | undefined
  public changedI: ChangedI | null | undefined

  constructor(nvim:Neovim) {
    this.activted = false
    this.nvim = nvim
  }

  public isKeyword(str: string):boolean {
    let {document} = buffers
    return document ? document.isWord(str) : /^\w$/.test(str)
  }

  public async stop():Promise<void> {
    if (!this.activted) return
    this.activted = false
    if (this.input) await this.input.clear()
    this.done = this.input = this.option = this.changedI = null
    let completeOpt = getConfig('completeOpt')
    completes.reset()
    await this.nvim.call('execute', [`noa set completeopt=${completeOpt}`])
    logger.debug(`${completeOpt}`)
    logger.debug('increment stoped')
  }

  /**
   * start
   *
   * @public
   * @param {string} input - current user input
   * @param {string} word - the word before cursor
   * @returns {Promise<void>}
   */
  public async start(input: string, word: string):Promise<void> {
    let {nvim, activted, option} = this
    if (activted || !option) return
    let {linenr, col} = option
    // clear beginning input
    if (this.input) {
      await this.input.clear()
      this.input = null
    }

    let inputTarget = new Input(nvim, input, word, linenr, col)
    if (inputTarget.isValid) {
      this.activted = true
      this.input = inputTarget
      await inputTarget.highlight()
      let completeOpt = await nvim.getOption('completeopt')
      setConfig({completeOpt})
      await nvim.call('execute', [`noa set completeopt=menuone,noinsert`])
      logger.debug('increment started')
    }
  }

  public setOption(opt: CompleteOption):void {
    this.option = opt
  }

  private isCompleteItem(item: any):boolean {
    if (!item) return false
    let {user_data} = item
    if (!user_data) return false
    try {
      let res = JSON.parse(user_data)
      return res.cid != null
    } catch (e) {
      return false
    }
  }

  public async onCompleteDone():Promise<VimCompleteItem | null> {
    let {option, nvim} = this
    if (!option) return null
    let [_, lnum, colnr] = await nvim.call('getcurpos', [])
    let changedtick = await nvim.eval('b:changedtick')
    let item = await nvim.getVvar('completed_item')
    if (Object.keys(item).length && !this.isCompleteItem(item)) {
      await this.stop()
      return null
    }
    if (this.input && !this.activted) {
      this.input.clear()
      this.input = null
    }
    this.done = {
      word: item ? (item as VimCompleteItem).word || '' : '',
      timestamp: Date.now(),
      colnr: Number(colnr),
      linenr: Number(lnum),
      changedtick: Number(changedtick)
    }
    logger.debug(JSON.stringify(this.done))
  }

  public async onCharInsert():Promise<void> {
    let ch:string = (await this.nvim.getVvar('char') as string)
    this.lastInsert = {
      character: ch,
      timestamp: Date.now()
    }
    let {activted, input} = this
    if (!activted) return
    let isKeyword = this.isKeyword(ch)
    if (!isKeyword) return await this.stop()
    let visible = await this.nvim.call('pumvisible')
    if (visible != 1) return await this.stop()
    // vim would attamp to match the string
    // if vim find match, no TextChangeI would fire
    // we should disable this behavior by
    // hide the popup
    await this.nvim.call('coc#_hide')
  }

  public async onTextChangeI():Promise<boolean> {
    let {option, activted, done, lastInsert, nvim} = this
    if (!option) return false
    let [_, linenr, colnr] = await nvim.call('getcurpos', [])
    let bufnr = await nvim.call('bufnr', ['%'])
    if (bufnr.toString() != option.bufnr || linenr != option.linenr) {
      await this.stop()
      return false
    }
    let changedtick = await nvim.eval('b:changedtick')
    changedtick = Number(changedtick)
    let lastChanged = Object.assign({}, this.changedI)
    this.changedI = {
      linenr,
      colnr,
      changedtick
    }
    let ts = Date.now()
    if (!activted) {
      // check start
      let {input, col, linenr} = option
      if (done && ts - done.timestamp < MAX_DURATION) {
        let {word} = done
        if (changedtick - done.changedtick !== 1) return false
        // if (done.word && !this.isKeyword(done.word)) return false
        if (lastInsert && ts - lastInsert.timestamp < MAX_DURATION) {
          let ch = lastInsert.character
          await this.start(input + ch, word + ch)
          return true
        }
        if (done.colnr - colnr === 1
          && word
          && input.length > 0) {
          await this.start(input.slice(0, -1), done.word.slice(0, -1))
          return true
        }
      }
    }
    if (activted) {
      // check continue
      if (lastInsert
        && this.input
        && ts - lastInsert.timestamp < MAX_DURATION
        && colnr - lastChanged.colnr === 1) {
        await this.input.addCharactor(lastInsert.character)
        return true
      }
      if (lastChanged.colnr - colnr === 1
        && this.input
        && ts - done.timestamp < MAX_DURATION) {
        let invalid = await this.input.removeCharactor()
        if (!invalid) return true
      }
      await this.stop()
      return false
    }
    return false
  }
}
