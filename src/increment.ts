import {Neovim} from 'neovim'
import {CompleteOption, VimCompleteItem} from './types'
import {getConfig} from './config'
import Input from './model/input'
import completes from './completes'
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

const MAX_DURATION = 200

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

  public async stop():Promise<void> {
    if (!this.activted) return
    this.activted = false
    if (this.input) await this.input.clear()
    this.done = this.input = this.option = this.changedI = null
    let completeOpt = getConfig('completeOpt')
    completes.reset()
    await this.nvim.call('execute', [`noa set completeopt=${completeOpt}`])
    logger.debug('increment stopped')
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
    this.option = option
    let {linenr, colnr, input, col} = option
    this.changedI = {linenr, colnr, timestamp: Date.now()}
    let inputTarget = new Input(nvim, input, linenr, col)
    this.activted = true
    this.input = inputTarget
    await inputTarget.highlight()
    let opt = this.getStartOption()
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
    if (!this.activted) return
    this.lastInsert = {
      character: ch,
      timestamp: Date.now()
    }
    if (!completes.hasCharacter(ch)) {
      logger.debug(`character ${ch} not found`)
      await this.stop()
      return
    }
    // vim would attamp to match the string
    // if vim find match, no TextChangeI would fire
    // we have to disable this behavior by
    // send <C-e> to hide the popup
    let visible = await this.nvim.call('pumvisible')
    if (visible) await this.nvim.call('coc#_hide')
  }

  // keep other options
  private getStartOption():string {
    let opt = getConfig('completeOpt')
    let useNoSelect = getConfig('noSelect')
    let parts = opt.split(',')
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
    let {option, activted, lastInsert, nvim} = this
    if (!activted) return false
    let [_, linenr, colnr] = await nvim.call('getcurpos', [])
    if (linenr != option.linenr) {
      await this.stop()
      return false
    }
    logger.debug('text changedI')
    let lastChanged = Object.assign({}, this.changedI)
    this.changedI = { linenr, colnr, timestamp: Date.now() }
    // check continue
    if (lastInsert && colnr - lastChanged.colnr === 1) {
      await this.input.addCharactor(lastInsert.character)
      return true
    }
    if (lastChanged.colnr - colnr === 1) {
      let invalid = await this.input.removeCharactor()
      if (!invalid) return true
    }
    logger.debug('increment failed')
    await this.stop()
    return false
  }
}
