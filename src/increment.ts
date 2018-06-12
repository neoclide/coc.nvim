import {Neovim} from 'neovim'
import {CompleteOption, VimCompleteItem} from './types'
import {getConfig} from './config'
import Input from './model/input'
import completes from './completes'
import {isWord} from './util/string'
const logger = require('./util/logger')('increment')

export interface CompleteDone {
  word: string
  timestamp: number
  colnr: number
  linenr: number
}

export interface InsertedChar {
  character: string
  timestamp: number
}

export interface ChangedI {
  linenr: number
  colnr: number
  timestamp: number
}

const MAX_DURATION = 100

export default class Increment {
  private nvim:Neovim
  private input: Input | null | undefined
  private done: CompleteDone | null | undefined
  private changedI: ChangedI | null | undefined
  private activted: boolean
  private lastInsert: InsertedChar | null | undefined
  private _incrementopt: string|null

  constructor(nvim:Neovim) {
    this.activted = false
    this.nvim = nvim
  }

  public async stop():Promise<void> {
    if (!this.activted) return
    this.activted = false
    if (this.input) await this.input.clear()
    this.done = this.input = this.changedI = null
    let completeOpt = getConfig('completeOpt')
    completes.reset()
    await this.nvim.call('execute', [`noa set completeopt=${completeOpt}`])
    logger.debug('increment stopped')
  }

  public get hasNoselect():boolean {
    if (this.activted) {
      return this._incrementopt.indexOf('noselect') !== -1
    }
    return getConfig('completeOpt').indexOf('noselect') !== -1
  }

  public get isActivted():boolean {
    return this.activted
  }

  public get search():string|null {
    return this.input ? this.input.search : null
  }

  public get latestIntertChar():string | null {
    let {lastInsert} = this
    if (!lastInsert || Date.now() - lastInsert.timestamp > MAX_DURATION) {
      return null
    }
    return lastInsert.character
  }

  public get latestDone():CompleteDone|null {
    let {done} = this
    if (!done || Date.now() - done.timestamp > MAX_DURATION) return null
    return done
  }

  public get latestTextChangedI():ChangedI|null{
    let {changedI} = this
    if (!changedI || Date.now() - changedI.timestamp > MAX_DURATION) return null
    return changedI
  }

  /**
   * start
   *
   * @public
   * @param {string} input - current user input
   * @param {string} word - the word before cursor
   * @returns {Promise<void>}
   */
  public async start(option:CompleteOption):Promise<void> {
    let {nvim, activted} = this
    if (activted) return
    let {linenr, colnr, input, col} = option
    this.changedI = {linenr, colnr, timestamp: Date.now()}
    let inputTarget = new Input(nvim, input, linenr, col)
    this.activted = true
    this.input = inputTarget
    await inputTarget.highlight()
    let opt = this._incrementopt = this.getStartOption()
    await nvim.call('execute', [`noa set completeopt=${opt}`])
    logger.debug('increment started')
  }

  public async onCompleteDone(item: VimCompleteItem | null):Promise<void> {
    if (!this.activted) return
    let {nvim} = this
    let [_, lnum, colnr] = await nvim.call('getcurpos', [])
    if (item) {
      logger.debug('complete done with item, increment stopped')
      await this.stop()
    }
    this.done = {
      word: item ? item.word || '' : '',
      timestamp: Date.now(),
      colnr,
      linenr: lnum,
    }
  }

  public async onCharInsert(ch:string):Promise<void> {
    this.lastInsert = {
      character: ch,
      timestamp: Date.now()
    }
    if (!this.activted) return
    if (!completes.hasCharacter(ch)) {
      logger.debug(`character ${ch} not found`)
      await this.stop()
      return
    }
    // vim would attamp to match the string
    // if vim find match, no TextChangeI would fire
    // we have to disable this behavior by
    // send <C-e> to hide the popup
    await this.nvim.call('coc#_hide')
  }

  // keep other options
  private getStartOption():string {
    let opt = getConfig('completeOpt')
    let useNoSelect = getConfig('noSelect')
    let parts = opt.split(',')
    // longest & menu can't work with increment search
    parts.filter(s => s != 'menu' && s != 'longest')
    if (parts.indexOf('menuone') === -1) {
      parts.push('menuone')
    }
    if (parts.indexOf('noinsert') === -1) {
      parts.push('noinsert')
    }
    if (useNoSelect && parts.indexOf('noselect') === -1) {
      parts.push('noselect')
    }
    return parts.join(',')
  }

  public async onTextChangedI():Promise<boolean> {
    let {activted, lastInsert, nvim} = this
    if (!activted) return false
    let {option} = completes
    if (!option) return false
    let [_, linenr, colnr] = await nvim.call('getcurpos', [])
    let {triggerCharacter} = option
    if (linenr != option.linenr) return false
    logger.debug('text changedI')
    let lastChanged = Object.assign({}, this.changedI)
    this.changedI = { linenr, colnr, timestamp: Date.now() }
    if (lastInsert && colnr - lastChanged.colnr === 1) {
      await this.input.addCharactor(lastInsert.character)
      return true
    }
    if (lastChanged.colnr - colnr === 1) {
      let invalid = await this.input.removeCharactor()
      let shouldStop = triggerCharacter && isWord(triggerCharacter) && this.search.length == 0
      if (!invalid && !shouldStop) return true
    }
    logger.debug('increment failed')
    await this.stop()
    return false
  }
}
