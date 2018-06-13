import {Neovim} from 'neovim'
import {CompleteOption} from './types'
import Input from './model/input'
import completes from './completes'
import {
  isWord,
  byteSlice,
} from './util/string'
import workspace from './workspace'
const logger = require('./util/logger')('increment')

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
    this.input = this.changedI = null
    let completeOpt = workspace.getNvimSetting('completeOpt')
    completes.reset()
    await this.nvim.call('execute', [`noa set completeopt=${completeOpt}`])
    logger.debug('increment stopped')
  }

  public get hasNoselect():boolean {
    let completeOpt = workspace.getNvimSetting('completeOpt')
    if (this.activted) {
      return this._incrementopt.indexOf('noselect') !== -1
    }
    return completeOpt.indexOf('noselect') !== -1
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
    let opt = workspace.getNvimSetting('completeOpt')
    let useNoSelect = workspace.getConfiguration('coc.preferences').get('noselect', 'true')
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
    let [_, linenr, colnr] = await nvim.call('getcurpos', [])
    let {triggerCharacter} = option
    if (linenr != option.linenr) return false
    let lastChanged = Object.assign({}, this.changedI)
    this.changedI = { linenr, colnr, timestamp: Date.now() }
    if (lastInsert && colnr > lastChanged.colnr) {
      let line = await nvim.call('getline', ['.'])
      let search = byteSlice(line, option.col, colnr - 1)
      await this.input.changeSearch(search)
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
