'use strict'
import { Neovim } from '@chemzqm/neovim'
import Notification, { NotificationPreferences } from './notification'
import { CancellationToken, CancellationTokenSource } from 'vscode-languageserver-protocol'
import events from '../events'

export interface ProgressOptions<R> {
  title?: string
  cancellable?: boolean
  task: (progress: Progress<{ message?: string; increment?: number }>, token: CancellationToken) => Thenable<R>
}

/**
 * Defines a generalized way of reporting progress updates.
 */
export interface Progress<T> {

  /**
   * Report a progress update.
   *
   * @param value A progress item, like a message and/or an
   * report on how much work finished
   */
  report(value: T): void
}

export default class ProgressNotification<R> extends Notification {
  private tokenSource: CancellationTokenSource
  constructor(nvim: Neovim, private option: ProgressOptions<R>) {
    super(nvim, {
      kind: 'progress',
      title: option.title,
      buttons: [{ index: 1, text: 'Cancel' }]
    }, false)
    events.on('BufWinLeave', bufnr => {
      if (bufnr == this.bufnr) {
        if (this.tokenSource) {
          this.tokenSource.cancel()
        }
        this.dispose()
      }
    }, null, this.disposables)
  }

  public async show(preferences: Partial<NotificationPreferences>): Promise<R> {
    let { task } = this.option
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    this.disposables.push(tokenSource)
    let total = 0
    let res = await new Promise<R>((resolve, reject) => {
      tokenSource.token.onCancellationRequested(() => {
        resolve(undefined)
      })
      super.show(preferences).then(shown => {
        if (!shown) reject(new Error('Failed to create float window'))
      }).catch(reject)
      task({
        report: p => {
          if (!this.winid) return
          let { nvim } = this
          nvim.pauseNotification()
          if (p.increment) {
            total += p.increment
            nvim.call('coc#window#set_var', [this.winid, 'percent', `${total}%`], true)
          }
          if (p.message) nvim.call('coc#window#set_var', [this.winid, 'message', p.message.replace(/\r?\n/g, ' ')], true)
          nvim.resumeNotification(false, true)
        }
      }, tokenSource.token).then(res => {
        this.tokenSource = undefined
        if (this._disposed) return
        setImmediate(() => {
          this.dispose()
        })
        resolve(res)
      }, err => {
        if (this._disposed) return
        this.dispose()
        if (err instanceof Error) {
          reject(err)
        } else {
          resolve(undefined)
        }
      })
    })
    return res
  }
}
