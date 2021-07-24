import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { CancellationToken, Disposable, Position } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import channels from './channels'
import events from './events'
import Dialog, { DialogConfig, DialogPreferences } from './model/dialog'
import Menu from './model/menu'
import Notification, { NotificationConfig, NotificationPreferences } from './model/notification'
import Picker, { QuickPickItem } from './model/picker'
import ProgressNotification, { Progress } from './model/progress'
import StatusLine, { StatusBarItem } from './model/status'
import { TreeView, TreeViewOptions } from './tree'
import { MessageLevel, OutputChannel } from './types'
import { CONFIG_FILE_NAME, disposeAll } from './util'
import { Mutex } from './util/mutex'
import { isWindows } from './util/platform'
import workspace from './workspace'
const logger = require('./util/logger')('window')

export type MsgTypes = 'error' | 'warning' | 'more'

export interface StatusItemOption {
  progress?: boolean
}

export interface ScreenPosition {
  row: number
  col: number
}

export interface OpenTerminalOption {
  /**
   * Cwd of terminal, default to result of |getcwd()|
   */
  cwd?: string
  /**
   * Close terminal on job finish, default to true.
   */
  autoclose?: boolean
  /**
   * Keep foucus current window, default to false,
   */
  keepfocus?: boolean
}

export interface TerminalResult {
  bufnr: number
  success: boolean
  content?: string
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
}

/**
 * Represents an action that is shown with an information, warning, or
 * error message.
 *
 * @see [showInformationMessage](#window.showInformationMessage)
 * @see [showWarningMessage](#window.showWarningMessage)
 * @see [showErrorMessage](#window.showErrorMessage)
 */
export interface MessageItem {

  /**
   * A short title like 'Retry', 'Open Log' etc.
   */
  title: string

  /**
   * A hint for modal dialogs that the item should be triggered
   * when the user cancels the dialog (e.g. by pressing the ESC
   * key).
   *
   * Note: this option is ignored for non-modal messages.
   * Note: not used by coc.nvim for now.
   */
  isCloseAffordance?: boolean
}

class Window {
  private mutex = new Mutex()
  private statusLine: StatusLine | undefined

  public get nvim(): Neovim {
    return workspace.nvim
  }

  public dispose(): void {
    this.statusLine?.dispose()
  }

  /**
   * Reveal message with message type.
   *
   * @param msg Message text to show.
   * @param messageType Type of message, could be `error` `warning` and `more`, default to `more`
   */
  public showMessage(msg: string, messageType: MsgTypes = 'more'): void {
    if (this.mutex.busy || !this.nvim) return
    let { messageLevel } = this
    let method = process.env.VIM_NODE_RPC == '1' ? 'callTimer' : 'call'
    if (global.hasOwnProperty('__TEST__')) logger.info(msg)
    let hl = 'Error'
    let level = MessageLevel.Error
    switch (messageType) {
      case 'more':
        level = MessageLevel.More
        hl = 'MoreMsg'
        break
      case 'warning':
        level = MessageLevel.Warning
        hl = 'WarningMsg'
        break
    }
    if (level >= messageLevel) {
      this.nvim[method]('coc#util#echo_messages', [hl, ('[coc.nvim] ' + msg).split('\n')], true)
    }
  }

  /**
   * Run command in vim terminal for result
   *
   * @param cmd Command to run.
   * @param cwd Cwd of terminal, default to result of |getcwd()|.
   */
  public async runTerminalCommand(cmd: string, cwd?: string, keepfocus = false): Promise<TerminalResult> {
    cwd = cwd || workspace.cwd
    return await this.nvim.callAsync('coc#util#run_terminal', { cmd, cwd, keepfocus: keepfocus ? 1 : 0 }) as TerminalResult
  }

  /**
   * Open terminal window.
   *
   * @param cmd Command to run.
   * @param opts Terminal option.
   * @returns buffer number of terminal.
   */
  public async openTerminal(cmd: string, opts: OpenTerminalOption = {}): Promise<number> {
    let bufnr = await this.nvim.call('coc#util#open_terminal', { cmd, ...opts })
    return bufnr as number
  }

  /**
   * Show quickpick for single item, use `window.menuPick` for menu at current current position.
   *
   * @param items Label list.
   * @param placeholder Prompt text, default to 'choose by number'.
   * @returns Index of selected item, or -1 when canceled.
   */
  public async showQuickpick(items: string[], placeholder = 'Choose by number'): Promise<number> {
    let release = await this.mutex.acquire()
    try {
      let title = placeholder + ':'
      items = items.map((s, idx) => `${idx + 1}. ${s}`)
      let res = await this.nvim.callAsync('coc#util#quickpick', [title, items.map(s => s.trim())])
      release()
      let n = parseInt(res, 10)
      if (isNaN(n) || n <= 0 || n > items.length) return -1
      return n - 1
    } catch (e) {
      release()
      return -1
    }
  }

  /**
   * Show menu picker at current cursor position, |inputlist()| is used as fallback.
   * Use `workspace.env.dialog` to check if the picker window/popup could work.
   *
   * @param items Array of texts.
   * @param title Optional title of float/popup window.
   * @param token A token that can be used to signal cancellation.
   * @returns Selected index (0 based), -1 when canceled.
   */
  public async showMenuPicker(items: string[], title?: string, token?: CancellationToken): Promise<number> {
    if (workspace.env.dialog) {
      let release = await this.mutex.acquire()
      if (token && token.isCancellationRequested) {
        release()
        return undefined
      }
      try {
        let menu = new Menu(this.nvim, { items: items.map(s => s.trim()), title }, token)
        let promise = new Promise<number>(resolve => {
          menu.onDidClose(selected => {
            resolve(selected)
          })
        })
        await menu.show(this.dialogPreference)
        let res = await promise
        release()
        return res
      } catch (e) {
        logger.error(`Error on showMenuPicker:`, e)
        release()
      }
    }
    return await this.showQuickpick(items)
  }

  /**
   * Open local config file
   */
  public async openLocalConfig(): Promise<void> {
    let { root } = workspace
    if (root == os.homedir()) {
      this.showMessage(`Can't create local config in home directory`, 'warning')
      return
    }
    let dir = path.join(root, '.vim')
    if (!fs.existsSync(dir)) {
      let res = await this.showPrompt(`Would you like to create folder'${root}/.vim'?`)
      if (!res) return
      fs.mkdirSync(dir)
    }
    await workspace.jumpTo(URI.file(path.join(dir, CONFIG_FILE_NAME)).toString())
  }

  /**
   * Prompt user for confirm, a float/popup window would be used when possible,
   * use vim's |confirm()| function as callback.
   *
   * @param title The prompt text.
   * @returns Result of confirm.
   */
  public async showPrompt(title: string): Promise<boolean> {
    let release = await this.mutex.acquire()
    try {
      let res = await this.nvim.callAsync('coc#float#prompt_confirm', [title])
      release()
      return res == 1
    } catch (e) {
      release()
      return false
    }
  }

  /**
   * Show dialog window at the center of screen.
   * Note that the dialog would always be closed after button click.
   * Use `workspace.env.dialog` to check if dialog could work.
   *
   * @param config Dialog configuration.
   * @returns Dialog or null when dialog can't work.
   */
  public async showDialog(config: DialogConfig): Promise<Dialog | null> {
    if (!this.checkDialog()) return null
    let dialog = new Dialog(this.nvim, config)
    await dialog.show(this.dialogPreference)
    return dialog
  }

  /**
   * Request input from user
   *
   * @param title Title text of prompt window.
   * @param defaultValue Default value of input, empty text by default.
   */
  public async requestInput(title: string, defaultValue?: string): Promise<string> {
    let { nvim } = this
    const preferences = workspace.getConfiguration('coc.preferences')
    if (workspace.env.dialog && preferences.get<boolean>('promptInput', true) && !isWindows) {
      let release = await this.mutex.acquire()
      let preferences = this.dialogPreference
      try {
        let opts: any = {}
        if (preferences.floatHighlight) opts.highlight = preferences.floatHighlight
        if (preferences.floatBorderHighlight) opts.borderhighlight = preferences.floatBorderHighlight
        let arr = await nvim.call('coc#float#create_prompt_win', [title, defaultValue || '', opts]) as [number, number]
        let [bufnr, winid] = arr
        let res = await new Promise<string>(resolve => {
          let disposables: Disposable[] = []
          events.on('BufWinLeave', nr => {
            if (nr == bufnr) {
              disposeAll(disposables)
              resolve(null)
            }
          }, null, disposables)
          events.on('PromptInsert', async value => {
            disposeAll(disposables)
            await nvim.call('coc#float#close', [winid])
            if (!value) {
              this.showMessage('Empty word, canceled', 'warning')
              resolve(null)
            } else {
              resolve(value)
            }
          }, null, disposables)
        })
        release()
        return res
      } catch (e) {
        logger.error('Error on requestInput:', e)
        release()
      }
    } else {
      let res = await workspace.callAsync<string>('input', [title + ': ', defaultValue || ''])
      nvim.command('normal! :<C-u>', true)
      if (!res) {
        this.showMessage('Empty word, canceled', 'warning')
        return null
      }
      return res
    }
  }

  /**
   * Create statusbar item that would be included in `g:coc_status`.
   *
   * @param priority Higher priority item would be shown right.
   * @param option
   * @return A new status bar item.
   */
  public createStatusBarItem(priority = 0, option: StatusItemOption = {}): StatusBarItem {
    if (!workspace.env) {
      let fn = () => {}
      return { text: '', show: fn, dispose: fn, hide: fn, priority: 0, isProgress: false }
    }
    if (!this.statusLine) {
      this.statusLine = new StatusLine(this.nvim)
    }
    return this.statusLine.createStatusBarItem(priority, option.progress || false)
  }

  /**
   * Create a new output channel
   *
   * @param name Unique name of output channel.
   * @returns A new output channel.
   */
  public createOutputChannel(name: string): OutputChannel {
    return channels.create(name, this.nvim)
  }

  /**
   * Reveal buffer of output channel.
   *
   * @param name Name of output channel.
   * @param preserveFocus Preserve window focus when true.
   */
  public showOutputChannel(name: string, preserveFocus?: boolean): void {
    channels.show(name, preserveFocus)
  }

  /**
   * Echo lines at the bottom of vim.
   *
   * @param lines Line list.
   * @param truncate Truncate the lines to avoid 'press enter to continue' when true
   */
  public async echoLines(lines: string[], truncate = false): Promise<void> {
    let { nvim } = this
    let cmdHeight = workspace.env.cmdheight
    if (lines.length > cmdHeight && truncate) {
      lines = lines.slice(0, cmdHeight)
    }
    let maxLen = workspace.env.columns - 12
    lines = lines.map(line => {
      line = line.replace(/\n/g, ' ')
      if (truncate) line = line.slice(0, maxLen)
      return line
    })
    if (truncate && lines.length == cmdHeight) {
      let last = lines[lines.length - 1]
      lines[cmdHeight - 1] = `${last.length == maxLen ? last.slice(0, -4) : last} ...`
    }
    await nvim.call('coc#util#echo_lines', [lines])
  }

  /**
   * Get current cursor position (line, character both 0 based).
   *
   * @returns Cursor position.
   */
  public async getCursorPosition(): Promise<Position> {
    // vim can't count utf16
    let [line, content] = await this.nvim.eval(`[line('.')-1, strpart(getline('.'), 0, col('.') - 1)]`) as [number, string]
    return Position.create(line, content.length)
  }

  /**
   * Move cursor to position.
   *
   * @param position LSP position.
   */
  public async moveTo(position: Position): Promise<void> {
    await this.nvim.call('coc#util#jumpTo', [position.line, position.character])
    if (workspace.env.isVim) this.nvim.command('redraw', true)
  }

  /**
   * Get current cursor character offset in document,
   * length of line break would always be 1.
   *
   * @returns Character offset.
   */
  public async getOffset(): Promise<number> {
    return await this.nvim.call('coc#util#get_offset') as number
  }

  /**
   * Get screen position of current cursor(relative to editor),
   * both `row` and `col` are 0 based.
   *
   * @returns Cursor screen position.
   */
  public async getCursorScreenPosition(): Promise<ScreenPosition> {
    let [row, col] = await this.nvim.call('coc#util#cursor_pos') as [number, number]
    return { row, col }
  }

  /**
   * Show multiple picker at center of screen.
   * Use `workspace.env.dialog` to check if dialog could work.
   *
   * @param items Array of QuickPickItem or string.
   * @param title Title of picker dialog.
   * @param token A token that can be used to signal cancellation.
   * @return A promise that resolves to the selected items or `undefined`.
   */
  public async showPickerDialog(items: string[], title: string, token?: CancellationToken): Promise<string[] | undefined>
  public async showPickerDialog<T extends QuickPickItem>(items: T[], title: string, token?: CancellationToken): Promise<T[] | undefined>
  public async showPickerDialog(items: any, title: string, token?: CancellationToken): Promise<any | undefined> {
    if (!this.checkDialog()) return undefined
    let release = await this.mutex.acquire()
    if (token && token.isCancellationRequested) {
      release()
      return undefined
    }
    try {
      let useString = typeof items[0] === 'string'
      let picker = new Picker(this.nvim, {
        title,
        items: useString ? items.map(s => {
          return { label: s }
        }) : items,
      }, token)
      let promise = new Promise<number[]>(resolve => {
        picker.onDidClose(selected => {
          resolve(selected)
        })
      })
      await picker.show(this.dialogPreference)
      let picked = await promise
      let res = picked == undefined ? undefined : items.filter((_, i) => picked.includes(i))
      release()
      return res
    } catch (e) {
      logger.error(`Error on showPickerDialog:`, e)
      release()
    }
  }

  /**
   * Show an information message to users. Optionally provide an array of items which will be presented as
   * clickable buttons.
   *
   * @param message The message to show.
   * @param items A set of items that will be rendered as actions in the message.
   * @return Promise that resolves to the selected item or `undefined` when being dismissed.
   */
  public async showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>
  public async showInformationMessage<T extends MessageItem>(message: string, ...items: T[]): Promise<T | undefined>
  public async showInformationMessage<T extends MessageItem | string>(message: string, ...items: T[]): Promise<T | undefined> {
    if (!this.enableMessageDialog) return await this.showConfirm(message, items, 'Info') as any
    let texts = typeof items[0] === 'string' ? items : (items as any[]).map(s => s.title)
    let idx = await this.createNotification('CocInfoFloat', message, texts)
    return idx == -1 ? undefined : items[idx]
  }

  /**
   * Show an warning message to users. Optionally provide an array of items which will be presented as
   * clickable buttons.
   *
   * @param message The message to show.
   * @param items A set of items that will be rendered as actions in the message.
   * @return Promise that resolves to the selected item or `undefined` when being dismissed.
   */
  public async showWarningMessage(message: string, ...items: string[]): Promise<string | undefined>
  public async showWarningMessage<T extends MessageItem>(message: string, ...items: T[]): Promise<T | undefined>
  public async showWarningMessage<T extends MessageItem | string>(message: string, ...items: T[]): Promise<T | undefined> {
    if (!this.enableMessageDialog) return await this.showConfirm(message, items, 'Warning') as any
    let texts = typeof items[0] === 'string' ? items : (items as any[]).map(s => s.title)
    let idx = await this.createNotification('CocWarningFloat', message, texts)
    return idx == -1 ? undefined : items[idx]
  }

  /**
   * Show an error message to users. Optionally provide an array of items which will be presented as
   * clickable buttons.
   *
   * @param message The message to show.
   * @param items A set of items that will be rendered as actions in the message.
   * @return Promise that resolves to the selected item or `undefined` when being dismissed.
   */
  public async showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>
  public async showErrorMessage<T extends MessageItem>(message: string, ...items: T[]): Promise<T | undefined>
  public async showErrorMessage<T extends MessageItem | string>(message: string, ...items: T[]): Promise<T | undefined> {
    if (!this.enableMessageDialog) return await this.showConfirm(message, items, 'Error') as any
    let texts = typeof items[0] === 'string' ? items : (items as any[]).map(s => s.title)
    let idx = await this.createNotification('CocErrorFloat', message, texts)
    return idx == -1 ? undefined : items[idx]
  }

  public async showNotification(config: NotificationConfig): Promise<boolean> {
    if (!this.checkDialog()) return false
    let notification = new Notification(this.nvim, config)
    return await notification.show(this.notificationPreference)
  }

  // fallback for vim without dialog
  private async showConfirm<T extends MessageItem | string>(message: string, items: T[], kind: 'Info' | 'Warning' | 'Error'): Promise<T> {
    if (!items || items.length == 0) {
      let msgType: MsgTypes = kind == 'Info' ? 'more' : kind == 'Error' ? 'error' : 'warning'
      this.showMessage(message, msgType)
      return undefined
    }
    let titles: string[] = typeof items[0] === 'string' ? items.slice() as string[] : items.map(o => (o as MessageItem).title)
    let choices = titles.map((s, i) => `${i + 1}${s}`)
    let res = await this.nvim.callAsync('coc#util#with_callback', ['confirm', [message, choices.join('\n'), 0, kind]])
    return items[res - 1]
  }

  /**
   * Show progress in the editor. Progress is shown while running the given callback
   * and while the promise it returned isn't resolved nor rejected.
   *
   * @param task A callback returning a promise. Progress state can be reported with
   * the provided [progress](#Progress)-object.
   *
   * To report discrete progress, use `increment` to indicate how much work has been completed. Each call with
   * a `increment` value will be summed up and reflected as overall progress until 100% is reached (a value of
   * e.g. `10` accounts for `10%` of work done).
   *
   * To monitor if the operation has been cancelled by the user, use the provided [`CancellationToken`](#CancellationToken).
   *
   * @return The thenable the task-callback returned.
   */
  public async withProgress<R>(options: ProgressOptions, task: (progress: Progress<{ message?: string; increment?: number }>, token: CancellationToken) => Thenable<R>): Promise<R> {
    if (!this.checkDialog()) return undefined
    let progress = new ProgressNotification(this.nvim, {
      task,
      title: options.title,
      cancellable: options.cancellable
    })
    return await progress.show(this.notificationPreference)
  }

  /**
   * Create a {@link TreeView} instance.
   *
   * @param viewId Id of the view, used as title of TreeView when title not exists.
   * @param options Options for creating the {@link TreeView}
   * @returns a {@link TreeView}.
   */
  public createTreeView<T>(viewId: string, options: TreeViewOptions<T>): TreeView<T> {
    const BasicTreeView = require('./tree/TreeView').default
    return new BasicTreeView(viewId, options)
  }

  private createNotification(borderhighlight: string, message: string, items: string[]): Promise<number> {
    return new Promise(resolve => {
      let config: NotificationConfig = {
        content: message,
        borderhighlight,
        close: true,
        buttons: items.map((s, index) => {
          return { text: s, index }
        }),
        callback: idx => {
          resolve(idx)
        }
      }
      let notification = new Notification(this.nvim, config)
      notification.show(this.notificationPreference).then(shown => {
        if (!shown) {
          logger.error('Unable to open notification window')
          resolve(-1)
        }
        if (!items.length) resolve(-1)
      }, e => {
        logger.error('Unable to open notification window', e)
        resolve(-1)
      })
    })
  }

  private get dialogPreference(): DialogPreferences {
    let config = workspace.getConfiguration('dialog')
    return {
      maxWidth: config.get<number>('maxWidth'),
      maxHeight: config.get<number>('maxHeight'),
      floatHighlight: config.get<string>('floatHighlight'),
      floatBorderHighlight: config.get<string>('floatBorderHighlight'),
      pickerButtons: config.get<boolean>('pickerButtons'),
      pickerButtonShortcut: config.get<boolean>('pickerButtonShortcut'),
      confirmKey: config.get<string>('confirmKey'),
    }
  }

  private get notificationPreference(): NotificationPreferences {
    let config = workspace.getConfiguration('notification')
    return {
      top: config.get<number>('marginTop'),
      right: config.get<number>('marginRight'),
      maxWidth: config.get<number>('maxWidth'),
      maxHeight: config.get<number>('maxHeight'),
      highlight: config.get<string>('highlightGroup'),
      minProgressWidth: config.get<number>('minProgressWidth'),
    }
  }

  private checkDialog(): boolean {
    if (workspace.env.dialog) return true
    this.showMessage('Dialog requires vim >= 8.2.0750 or neovim >= 0.4.0, please upgrade your vim', 'warning')
    return false
  }

  private get enableMessageDialog(): boolean {
    if (!workspace.env.dialog) return false
    let config = workspace.getConfiguration('coc.preferences')
    return config.get<boolean>('enableMessageDialog', false)
  }

  private get messageLevel(): MessageLevel {
    let config = workspace.getConfiguration('coc.preferences')
    let level = config.get<string>('messageLevel', 'more')
    switch (level) {
      case 'error':
        return MessageLevel.Error
      case 'warning':
        return MessageLevel.Warning
      default:
        return MessageLevel.More
    }
  }
}

export default new Window()
