import {Neovim} from 'neovim'
import completes from './completes'
import {CompleteOption} from './types'
import workspace from './workspace'
import Emitter = require('events')
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

export default class Increment extends Emitter {
  public lastInsert?: LastInsert
  public search: string
  // private lastChange: LastChange | null | undefined
  private activted = false
  private _incrementopt?: string
  private timer?: NodeJS.Timer

  constructor(private nvim: Neovim) {
    super()
  }

  private clearTimer(): void {
    let {timer} = this
    if (timer) {
      clearTimeout(timer)
      this.timer = null
    }
  }

  public get latestInsert(): LastInsert | null {
    let {lastInsert} = this
    if (!lastInsert || Date.now() - lastInsert.timestamp > 50) {
      return null
    }
    return lastInsert
  }

  public get latestInsertChar(): string {
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
  public start(option: CompleteOption): void {
    let {nvim, activted} = this
    if (activted) this.stop()
    this.activted = true
    this.emit('start', Object.assign({}, option))
    this.clearTimer()
    this.search = option.input
    let opt = this._incrementopt = Increment.getStartOption()
    nvim.command(`noa set completeopt=${opt}`).catch(() => {}) // tslint:disable-line
  }

  public stop(): void {
    if (!this.activted) return
    this.activted = false
    this.emit('stop')
    this.clearTimer()
    this.search = ''
    let completeOpt = workspace.getVimSetting('completeOpt')
    this.nvim.call('execute', [`noa set completeopt=${completeOpt}`]) // tslint:disable-line
  }

  public get isActivted(): boolean {
    return this.activted
  }

  public onCharInsert(ch: string): void {
    this.lastInsert = {
      character: ch,
      timestamp: Date.now(),
    }
  }

  public async getResumeInput(): Promise<string> {
    let {activted, nvim} = this
    if (!activted) return null
    let {option} = completes
    let search = await nvim.call('coc#util#get_search', [option.col])
    this.search = search
    if (completes.completing) return null
    if (!search || !completes.hasMatch(search)) {
      await this.nvim.call('coc#_hide')
      this.stop()
      return null
    }
    return search
  }

  // keep other options
  public static getStartOption(): string {
    let opt = workspace.getVimSetting('completeOpt')
    let useNoSelect = workspace.getConfiguration('coc.preferences').get('noselect', 'true')
    let parts = opt.split(',')
    // longest & menu can't work with increment search
    parts = parts.filter(s => s != 'menu' && s != 'longest')
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

}