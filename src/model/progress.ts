import { Neovim } from '@chemzqm/neovim'
import Notification from './notification'
import { NotificationPreferences, Progress } from '../types'
import { CancellationToken, CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
const logger = require('../util/logger')('model-progress')

export interface ProgressOptions<R> {
  title?: string
  cancellable?: boolean
  task: (progress: Progress<{ message?: string; increment?: number }>, token: CancellationToken) => Thenable<R>
}

export default class ProgressNotification<R> extends Notification {
  private tokenSource: CancellationTokenSource
  protected disposables: Disposable[] = []
  constructor(nvim: Neovim, private option: ProgressOptions<R>) {
    super(nvim, {
      content: '\n',
      close: option.cancellable == true,
      title: option.title
    })
  }

  public async show(preferences: Partial<NotificationPreferences>): Promise<R> {
    let shown = await super.show(Object.assign({ minWidth: preferences.minProgressWidth || 30, progress: 1 }, preferences))
    if (!shown) return undefined
    let { task } = this.option
    let ts = Date.now()
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let total = 0
    let res = await new Promise<R>(resolve => {
      tokenSource.token.onCancellationRequested(() => {
        this.dispose()
        resolve(undefined)
      })
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
        tokenSource.dispose()
        this.tokenSource = null
        let dt = Date.now() - ts
        if (dt < 300) {
          setTimeout(() => {
            this.dispose()
          }, 300 - dt)
        } else {
          this.dispose()
        }
        resolve(res)
      }, err => {
        logger.error(err)
        tokenSource.dispose()
        this.tokenSource = null
        this.dispose()
        resolve(undefined)
      })
    })
    return res
  }

  public dispose(): void {
    let { tokenSource } = this
    if (tokenSource) {
      this.tokenSource = undefined
      tokenSource.cancel()
      tokenSource.dispose()
    }
    super.dispose()
  }
}
