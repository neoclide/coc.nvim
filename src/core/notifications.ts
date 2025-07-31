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
import { callAsync } from './funcs'
import { echoMessages, MsgTypes } from './ui'
import { Dialogs } from './dialogs'

export type MessageKind = 'Error' | 'Warning' | 'Info'

interface NotificationItem {
  time: string
  message: string
  kind: MessageKind
}

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
  private _history: NotificationItem[] = []

  constructor(private dialogs: Dialogs) {
  }

  private getCurrentTimestamp(): string {
    const now = new Date()
    const year = now.getFullYear()
    const month = (now.getMonth() + 1).toString().padStart(2, '0')
    const day = now.getDate().toString().padStart(2, '0')
    const hours = now.getHours().toString().padStart(2, '0')
    const minutes = now.getMinutes().toString().padStart(2, '0')
    const seconds = now.getSeconds().toString().padStart(2, '0')
    const ms = now.getMilliseconds().toString().padStart(3, '0')

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}`
  }

  public async _showMessage<T extends MessageItem | string>(kind: MessageKind, message: string, items: T[]): Promise<T | undefined> {
    this._history.push({ time: this.getCurrentTimestamp(), kind, message })

    let notificationKind = this.messageDialogKind === 'notification' || this.enableMessageDialog === true
    if (notificationKind !== true) {
      let msgType: MsgTypes = kind == 'Info' ? 'more' : kind == 'Error' ? 'error' : 'warning'
      if (msgType === 'error' || items.length === 0) {
        this.echoMessages(message, msgType)
        return undefined
      } else {
        switch (this.messageDialogKind) {
          case 'confirm':
            return await this.showConfirm(message, items, kind)
          case 'menu':
            return await this.showMenuPicker(`Choose an action`, message, `Coc${kind}Float`, items)
          default:
            throw new Error(`Unexpected messageDialogKind: ${this.messageDialogKind}`)
        }
      }
    }
    let texts = items.map(o => typeof o === 'string' ? o : o.title)
    let idx = await this.createNotification(kind.toLowerCase() as NotificationKind, message, texts)
    return items[idx]
  }

  public get history(): NotificationItem[] {
    return this._history
  }

  public clearHistory(): void {
    this._history = []
  }

  public createNotification(kind: NotificationKind, message: string, items: string[]): Promise<number> {
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
      notification.show(this.getNotificationPreference()).catch(reject)
      if (items.length == 0) {
        resolve(-1)
      }
    })
  }

  public async showConfirm<T extends MessageItem | string>(message: string, items: T[], kind: MessageKind): Promise<T> {
    let titles = toTitles(items)
    let choices = titles.map((s, i) => `${i + 1}${s}`)
    let res = await callAsync(this.nvim, 'confirm', [message, choices.join('\n'), 1, kind]) as number
    return items[res - 1]
  }

  public async showMenuPicker<T extends MessageItem | string>(title: string, content: string, hlGroup: string, items: T[]): Promise<T> {
    let texts = items.map(o => typeof o === 'string' ? o : o.title)
    let res = await this.dialogs.showMenuPicker(texts, {
      position: 'center',
      content,
      title: title.replace(/\r?\n/, ' '),
      borderhighlight: hlGroup
    })
    return items[res]
  }

  public async showNotification(config: NotificationConfig, stack: string): Promise<void> {
    let notification = new Notification(this.nvim, config)
    await notification.show(this.getNotificationPreference(stack))
  }

  public echoMessages(msg: string, messageType: MsgTypes): void {
    let level = this.configuration.get<string>('coc.preferences.messageLevel', 'more')
    echoMessages(this.nvim, msg, messageType, level)
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
    await progress.show(Object.assign(this.getNotificationPreference(options.source, true), { minWidth }))
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

  private get messageDialogKind(): string {
    return this.configuration.get<string>('coc.preferences.messageDialogKind', 'confirm')
  }

  private getNotificationPreference(source?: string, isProgress = false): NotificationPreferences {
    if (!source) source = parseExtensionName(Error().stack)
    let config = this.configuration.get<NotificationConfiguration>('notification')
    let disabled = false
    if (isProgress) {
      let disabledList = defaultValue(config.disabledProgressSources, []) as string[]
      disabled = Array.isArray(disabledList) && (disabledList.includes('*') || disabledList.includes(source))
    }
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
