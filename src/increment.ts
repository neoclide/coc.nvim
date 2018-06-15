import {Neovim} from 'neovim'
import {CompleteOption} from './types'
import completes from './completes'
import workspace from './workspace'
const logger = require('./util/logger')('increment')

export interface LastInsert {
  character: string
  timestamp: number
}

export interface LastChange {
  linenr: number
  colnr: number
  timestamp: number
}

export default class Increment {
  public lastInsert?: LastInsert
  public search: string
  // private lastChange: LastChange | null | undefined
  private activted = false
  private _incrementopt?: string
  private timer?: NodeJS.Timer

  constructor(private nvim:Neovim) {
  }

  private clearTimer():void {
    let {timer} = this
    if (timer) {
      clearTimeout(timer)
      this.timer = null
    }
  }

  public get latestInsert():LastInsert | null {
    let {lastInsert} = this
    if (!lastInsert || Date.now() - lastInsert.timestamp > 50) {
      return null
    }
    return lastInsert
  }

  public get latestInsertChar():string {
    let {latestInsert} = this
    if (!latestInsert) return ''
    return latestInsert.character
  }

  /**
   * start
   *
   * @public
   * @param {string} input - current user input
   * @param {string} word - the word before cursor
   * @returns {Promise<void>}
   */
  public start(option:CompleteOption):void {
    let {nvim, activted} = this
    if (activted) this.stop()
    this.clearTimer()
    this.search = option.input
    let opt = this._incrementopt = this.getStartOption()
    nvim.command(`noa set completeopt=${opt}`).catch(() => {}) // tslint:disable-line
    this.activted = true
    logger.debug('increment started')
  }

  public stop():void {
    if (!this.activted) return
    this.activted = false
    this.clearTimer()
    this.search = ''
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

  public onCharInsert(ch:string):void {
    this.lastInsert = {
      character: ch,
      timestamp: Date.now(),
    }
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

  public async getResumeInput():Promise<string> {
    let {activted, nvim} = this
    if (!activted) return null
    let {option} = completes
    let search = await nvim.call('coc#util#get_search', [option.col])
    if (search == this.search) return null
    if (!search || !completes.hasMatch(search)) {
      logger.debug('increment failed')
      await this.nvim.call('coc#_hide')
      this.stop()
      return null
    }
    this.search = search
    return search
  }
    // let res = await this.resumeCompletion(input)
    // if (!res) increment.stop()
}
