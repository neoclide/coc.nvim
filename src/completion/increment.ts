import { Neovim } from '@chemzqm/neovim'
import { CompleteConfig } from '../types'
import workspace from '../workspace'
import Emitter = require('events')
const logger = require('../util/logger')('increment')

export default class Increment extends Emitter {
  private activted = false

  constructor(private nvim: Neovim, private config: CompleteConfig) {
    super()
  }

  private get completeOpt(): string {
    let { noselect } = this.config
    let preview = workspace.completeOpt.indexOf('preview') !== -1
    return `${noselect ? 'noselect,' : ''}noinsert,menuone${preview ? ',preview' : ''}`
  }

  public get isActivted(): boolean {
    return this.activted
  }

  public start(): void {
    let { nvim, activted } = this
    if (activted) return
    this.activted = true
    if (this.config.numberSelect) {
      nvim.call('coc#_map', [], true)
    }
    nvim.command(`noa set completeopt=${this.completeOpt}`, true)
    this.emit('start')
  }

  public stop(): void {
    let { nvim, activted } = this
    if (!activted) return
    this.activted = false
    nvim.pauseNotification()
    if (this.config.numberSelect) {
      nvim.call('coc#_unmap', [], true)
    }
    nvim.call('coc#_hide', [])
    nvim.command(`noa set completeopt=${workspace.completeOpt}`, true)
    nvim.resumeNotification()
    this.emit('stop')
  }
}
