import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import { CompleteOption, CompleteConfig } from '../types'
import workspace from '../workspace'
import Emitter = require('events')
const logger = require('../util/logger')('increment')

export default class Increment extends Emitter {
  private disposables: Disposable[] = []
  private activted = false
  private completeOpt = 'noselect,noinsert,menuone'

  constructor(private nvim: Neovim, private config: CompleteConfig) {
    super()
    this.setCompleteOpt()
    workspace.onDidChangeConfiguration(this.setCompleteOpt, this, this.disposables)
  }

  private setCompleteOpt(): void {
    let noselect = workspace.getConfiguration('coc.preferences').get<boolean>('noselect', true)
    if (!noselect) this.completeOpt = this.completeOpt.replace('noselect,', '')
  }

  public start(option: CompleteOption): void {
    let { nvim, activted } = this
    if (activted) return
    this.activted = true
    let enablePreview = false
    let doc = workspace.getDocument(option.bufnr)
    if (doc && doc.uri.endsWith('coc-settings.json')) {
      enablePreview = true
    } else if (workspace.completeOpt.indexOf('preview') !== -1) {
      enablePreview = true
    }
    let opt = enablePreview ? `${this.completeOpt},preview` : this.completeOpt
    if (this.config.numberSelect) {
      nvim.call('coc#_map', [], true)
    }
    nvim.command(`noa set completeopt=${opt}`, true)
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

  public get isActivted(): boolean {
    return this.activted
  }
}
