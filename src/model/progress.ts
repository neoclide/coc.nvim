'use strict'
import { Neovim } from '@chemzqm/neovim'
import events from '../events'
import { createLogger } from '../logger'
import { CancellationToken, CancellationTokenSource, Emitter, Event } from '../util/protocol'
import Notification, { NotificationPreferences } from './notification'
const logger = createLogger('model-progress')

export interface Progress {
  report(value: { message?: string; increment?: number }): void
}

export interface ProgressOptions<R> {
  title?: string
  cancellable?: boolean
  task: (progress: Progress, token: CancellationToken) => Thenable<R>
}

export function formatMessage(title: string | undefined, message: string | undefined, total: number) {
  let parts = []
  if (title) parts.push(title)
  if (message) parts.push(message)
  if (total) parts.push(total + '%')
  return parts.join(' ')
}

export default class ProgressNotification<R> extends Notification {
  private tokenSource: CancellationTokenSource
  private readonly _onDidFinish = new Emitter<R>()
  public readonly onDidFinish: Event<R> = this._onDidFinish.event
  constructor(nvim: Neovim, private option: ProgressOptions<R>) {
    const buttons = [{ index: 0, text: 'Cancel' }]
    super(nvim, {
      kind: 'progress',
      title: option.title,
      buttons: option.cancellable ? buttons : undefined
    }, false)
    this.disposables.push(this._onDidFinish)
    events.on('BufWinLeave', this.cancelProgress, null, this.disposables)
    if (option.cancellable) {
      events.on('FloatBtnClick', (bufnr, buttonIndex) => {
        if (buttonIndex == buttons.findIndex(button => button.text == 'Cancel')) {
          this.cancelProgress(bufnr)
        }
      }, null, this.disposables)
    }
  }

  private cancelProgress = (bufnr: any) => {
    if (bufnr == this.bufnr && this.tokenSource) {
      this.tokenSource.cancel()
    }
  }

  public async show(preferences: Partial<NotificationPreferences>): Promise<void> {
    let { task } = this.option
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    this.disposables.push(tokenSource)
    let total = 0
    if (this.config.buttons || !preferences.disabled) {
      await super.show(preferences)
    } else {
      logger.warn(`progress window disabled by "notification.disabledProgressSources"`)
    }
    task({
      report: p => {
        if (!this.winid) return
        let { nvim } = this
        if (p.increment) {
          total += p.increment
          nvim.call('coc#window#set_var', [this.winid, 'percent', `${total}%`], true)
        }
        if (p.message) nvim.call('coc#window#set_var', [this.winid, 'message', p.message.replace(/\r?\n/g, ' ')], true)
      }
    }, tokenSource.token).then(res => {
      if (this._disposed) return
      this._onDidFinish.fire(res)
      this.dispose()
    }, err => {
      if (this._disposed) return
      if (err) this.nvim.echoError(err)
      this._onDidFinish.fire(undefined)
      this.dispose()
    })
  }
}
