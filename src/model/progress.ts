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
      content: '\n',
      close: option.cancellable == true,
      title: option.title
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
      super.show(Object.assign({ minWidth: preferences.minProgressWidth || 30, progress: 1 }, preferences)).then(shown => {
        if (!shown) reject(new Error('Failed to create float window'))
      }).catch(reject)
      task({
        report: p => {
          if (!this.bufnr) return
          let text = ''
          if (p.message) text += p.message.replace(/\r?\n/g, ' ')
          if (p.increment) {
            total += p.increment
            text = text + (text.length ? ` ${total}%` : `${total}%`)
          }
          this.nvim.call('setbufline', [this.bufnr, 2, text], true)
        }
      }, tokenSource.token).then(res => {
        if (this._disposed) return
        setTimeout(() => {
          this.dispose()
        }, 100)
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

  public dispose(): void {
    super.dispose()
    this.tokenSource = undefined
  }
}
