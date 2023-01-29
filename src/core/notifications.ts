'use strict'
import { Neovim } from '@chemzqm/neovim'
import { WorkspaceConfiguration } from '../configuration/types'
import Notification, { MessageItem, NotificationConfig, NotificationKind, NotificationPreferences, toButtons, toTitles } from '../model/notification'
import ProgressNotification, { formatMessage, Progress } from '../model/progress'
import StatusLine from '../model/status'
import { defaultValue } from '../util'
import { parseExtensionName } from '../util/extensionRegistry'
import { toNumber } from '../util/numbers'
import { CancellationToken } from '../util/protocol'
import { toText } from '../util/string'
import { Dialogs } from './dialogs'
import { echoMessages, MsgTypes } from './ui'

export type MessageKind = 'Error' | 'Warning' | 'Info'

interface NotificationConfiguration {
  statusLineProgress: boolean
  border: boolean
  disabledProgressSources: string[]
  focusable: boolean
  highlightGroup: string
  marginRight: number
  maxHeight: number
  maxWidth: number
  minProgressWidth: number
  timeout: number
  winblend: number
}

/**
 * Value-object describing where and how progress should show.
 */
export interface ProgressOptions {

  /**
   * A human-readable string which will be used to describe the
   * operation.
   */
  title?: string

  /**
   * Controls if a cancel button should show to allow the user to
   * cancel the long running operation.
   */
  cancellable?: boolean
  /**
   * Extension or language-client id
   */
  source?: string
}

export class Notifications {
  public nvim: Neovim
  public configuration: WorkspaceConfiguration
  public statusLine: StatusLine
  constructor(private dialogs: Dialogs) {
  }

  public async _showMessage<T extends MessageItem | string>(kind: MessageKind, message: string, items: T[], stack: string): Promise<T | undefined> {
    if (!this.enableMessageDialog) return await this.showConfirm(message, items, kind)
    if (items.length > 0) {
      let source = parseExtensionName(stack)
      return await this.showMessagePicker(`Choose action ${source ? `(${source})` : ''}`, message, `Coc${kind}Float`, items)
    }
    await this.createNotification(kind.toLowerCase() as NotificationKind, message, [], stack)
    return undefined
  }

  public createNotification(kind: NotificationKind, message: string, items: string[], stack: string): Promise<number> {
    return new Promise((resolve, reject) => {
      let config: NotificationConfig = {
        kind,
        content: message,
        buttons: toButtons(items),
        callback: idx => {
          resolve(idx)
        }
      }
      let notification = new Notification(this.nvim, config)
      notification.show(this.getNotificationPreference(stack)).catch(reject)
    })
  }

  private async showMessagePicker<T extends MessageItem | string>(title: string, content: string, hlGroup: string, items: T[]): Promise<T | undefined> {
    let texts = items.map(o => typeof o === 'string' ? o : o.title)
    let res = await this.dialogs.showMenuPicker(texts, {
      position: 'center',
      content,
      title: title.replace(/\r?\n/, ' '),
      borderhighlight: hlGroup
    })
    return items[res]
  }

  // fallback for vim without dialog
  private async showConfirm<T extends MessageItem | string>(message: string, items: T[], kind: MessageKind): Promise<T> {
    if (!items || items.length == 0) {
      let msgType: MsgTypes = kind == 'Info' ? 'more' : kind == 'Error' ? 'error' : 'warning'
      this.echoMessages(message, msgType)
      return undefined
    }
    let titles = toTitles(items)
    let choices = titles.map((s, i) => `${i + 1}${s}`)
    let res = await this.nvim.callAsync('coc#util#with_callback', ['confirm', [message, choices.join('\n'), 0, kind]]) as number
    return items[res - 1]
  }

  public echoMessages(msg: string, messageType: MsgTypes): void {
    let level = this.configuration.get<string>('coc.preferences.messageLevel', 'more')
    echoMessages(this.nvim, msg, messageType, level)
  }

  public async showNotification(config: NotificationConfig, stack: string): Promise<void> {
    let notification = new Notification(this.nvim, config)
    await notification.show(this.getNotificationPreference(stack))
  }

  public async withProgress<R>(options: ProgressOptions, task: (progress: Progress, token: CancellationToken) => Thenable<R>): Promise<R> {
    let config = this.configuration.get<NotificationConfiguration>('notification')
    if (!options.cancellable && config.statusLineProgress) {
      return await this.createStatusLineProgress(options, task)
    }
    let progress = new ProgressNotification(this.nvim, {
      task,
      title: options.title,
      cancellable: options.cancellable
    })
    let minWidth = toNumber(config.minProgressWidth, 40)
    let promise = new Promise<R>(resolve => {
      progress.onDidFinish(resolve)
    })
    let stack = Error().stack
    await progress.show(Object.assign(this.getNotificationPreference(stack, options.source), { minWidth }))
    return await promise
  }

  private async createStatusLineProgress<R>(options: ProgressOptions, task: (progress: Progress, token: CancellationToken) => Thenable<R>): Promise<R> {
    let { title } = options
    let statusItem = this.statusLine.createStatusBarItem(0, true)
    statusItem.text = toText(title)
    statusItem.show()
    let total = 0
    let result = await task({
      report: p => {
        if (p.increment) {
          total += p.increment
        }
        statusItem.text = formatMessage(title, p.message, total).replace(/\r?\n/g, ' ')
      }
    }, CancellationToken.None)
    statusItem.dispose()
    return result
  }

  private get enableMessageDialog(): boolean {
    return this.configuration.get<boolean>('coc.preferences.enableMessageDialog', false)
  }

  private getNotificationPreference(stack: string, source?: string): NotificationPreferences {
    if (!source) source = parseExtensionName(stack)
    let config = this.configuration.get<NotificationConfiguration>('notification')
    let disabledList = defaultValue(config.disabledProgressSources, []) as string[]
    let disabled = Array.isArray(disabledList) && (disabledList.includes('*') || disabledList.includes(source))
    return {
      border: config.border,
      focusable: config.focusable,
      marginRight: toNumber(config.marginRight, 10),
      timeout: toNumber(config.timeout, 10000),
      maxWidth: toNumber(config.maxWidth, 60),
      maxHeight: toNumber(config.maxHeight, 10),
      highlight: config.highlightGroup,
      winblend: toNumber(config.winblend, 30),
      disabled,
      source,
    }
  }
}
