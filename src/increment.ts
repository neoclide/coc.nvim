import {Neovim} from 'neovim'
import {CompleteOption} from './types'
import Input from './model/input'
import completes from './completes'
import {
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
  private input?: Input
  private changedI?: ChangedI
  private activted = false
  private lastInsert?: InsertedChar
  private _incrementopt?: string
  private timer?: NodeJS.Timer

  constructor(
    private nvim:Neovim,
    private highlightId:number) {
  }

  private clearTimer():void {
    let {timer} = this
    if (timer) {
      clearTimeout(timer)
      this.timer = null
    }
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
    this.clearTimer()
    let {linenr, colnr, input, col} = option
    this.changedI = {linenr, colnr, timestamp: Date.now()}
    let inputTarget = new Input(nvim, input, linenr, col, this.highlightId)
    this.activted = true
    this.input = inputTarget
    await inputTarget.highlight()
    let opt = this._incrementopt = this.getStartOption()
    await nvim.call('execute', [`noa set completeopt=${opt}`])
    logger.debug('increment started')
  }

  public async stop():Promise<void> {
    if (!this.activted) return
    this.activted = false
    this.clearTimer()
    if (this.input) await this.input.clear()
    this.input = this.changedI = null
    let completeOpt = workspace.getNvimSetting('completeOpt')
    completes.reset()
    this.timer = setTimeout(() => {
      this.nvim.call('execute', [`noa set completeopt=${completeOpt}`]) // tslint:disable-line
    }, 100)
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
    let {input} = this
    if (!input) return null
    return input.search
  }

  public get lastInsertChar():string | null {
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

  public async onCharInsert(ch:string):Promise<void> {
    this.lastInsert = {
      character: ch,
      timestamp: Date.now()
    }
    if (!this.activted) return
    let trigger = completes.option.triggerCharacter
    if (ch !== trigger
      && !completes.hasCharacter(ch)) {
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

  private async checkResumeCompletion():Promise<boolean> {
    let {activted, lastInsert, nvim} = this
    if (!activted) return false
    let {option} = completes
    let [_, linenr, colnr] = await nvim.call('getcurpos', [])
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
      let {search} = this
      if (!search || search.length == 1) return false
      await this.input.removeCharactor()
      return true
    }
    return false
  }

  public async shouldCompletionResume():Promise<boolean> {
    let shouldResume = await this.checkResumeCompletion()
    if (this.activted && !shouldResume) {
      logger.debug('increment failed')
      await this.nvim.call('coc#_hide')
      await this.stop()
    }
    return shouldResume
  }
}
