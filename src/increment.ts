import { Neovim } from '@chemzqm/neovim'
import workspace from './workspace'
import Emitter = require('events')
import events from './events'
import { Disposable } from 'vscode-languageserver-protocol'
const logger = require('./util/logger')('increment')

export default class Increment extends Emitter {
  private disposables: Disposable[] = []
  private activted = false
  private completeOpt = 'noselect,noinsert,menuone'

  constructor(private nvim: Neovim) {
    super()
    workspace.onDidWorkspaceInitialized(this.setCompleteOpt, this, this.disposables)
    workspace.onDidChangeConfiguration(this.setCompleteOpt, this, this.disposables)
    events.on('OptionSet', (name: string, _oldValue: any, newValue: any) => {
      if (name === 'completeopt') {
        workspace.env.completeOpt = newValue
        this.setCompleteOpt()
      }
    }, null, this.disposables)
  }

  private setCompleteOpt(): void {
    let { completeOpt } = workspace.env
    let noselect = workspace.getConfiguration('coc.preferences').get<boolean>('noselect', true)
    this.completeOpt = Increment.getStartOption(completeOpt, noselect)
  }

  /**
   * start
   *
   * @public
   * @param {string} input - current user input
   * @param {string} word - the word before cursor
   * @returns {Promise<void>}
   */
  public start(): void {
    let { nvim, activted } = this
    if (activted) return
    this.activted = true
    let opt = this.completeOpt
    nvim.command(`noa set completeopt=${opt}`, true)
    this.emit('start')
  }

  public stop(): void {
    let { nvim, activted } = this
    if (!activted) return
    this.activted = false
    let completeOpt = workspace.completeOpt
    nvim.command(`noa set completeopt=${completeOpt}`, true)
    this.emit('stop')
  }

  public get isActivted(): boolean {
    return this.activted
  }

  // keep other options
  public static getStartOption(completeOpt: string, noselect: boolean): string {
    // let opt = workspace.completeOpt
    // let useNoSelect = workspace.getConfiguration('coc.preferences').get<boolean>('noselect', true)
    let parts = completeOpt.split(',')
    // longest & menu can't work with increment search
    parts = parts.filter(s => s != 'menu' && s != 'longest')
    if (parts.indexOf('menuone') === -1) {
      parts.push('menuone')
    }
    if (parts.indexOf('noinsert') === -1) {
      parts.push('noinsert')
    }
    if (noselect && parts.indexOf('noselect') === -1) {
      parts.push('noselect')
    }
    return parts.join(',')
  }
}
