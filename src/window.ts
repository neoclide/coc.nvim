import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import semver from 'semver'
import { CancellationToken, Disposable, Position } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import events from './events'
import Dialog from './model/dialog'
import Menu from './model/menu'
import channels from './channels'
import StatusLine from './model/status'
import Picker from './model/picker'
import { DialogConfig, MessageLevel, MsgTypes, OpenTerminalOption, OutputChannel, StatusBarItem, StatusItemOption, TerminalResult } from './types'
import { CONFIG_FILE_NAME, disposeAll } from './util'
import { Mutex } from './util/mutex'
import workspace from './workspace'
import { DialogPreferences, ScreenPosition, QuickPickItem } from './types'
const logger = require('./util/logger')('window')

class Window {
  private mutex = new Mutex()
  private statusLine: StatusLine

  private get nvim(): Neovim {
    return workspace.nvim
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
      let res = await this.nvim.callAsync('coc#util#quickpick', [title, items])
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
        let menu = new Menu(this.nvim, { items, title }, token)
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
    if (workspace.isNvim && semver.gte(workspace.env.version, '0.4.0') && preferences.get<boolean>('promptInput', true)) {
      let release = await this.mutex.acquire()
      try {
        let arr = await nvim.call('coc#float#create_prompt_win', [title, defaultValue || '']) as [number, number]
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
    }
    let res = await workspace.callAsync<string>('input', [title + ': ', defaultValue || ''])
    nvim.command('normal! :<C-u>', true)
    if (!res) {
      this.showMessage('Empty word, canceled', 'warning')
      return null
    }
    return res
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
      let fn = () => { }
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
    let [line, character] = await this.nvim.call('coc#util#cursor')
    return Position.create(line, character)
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
   * @returns Charactor offset.
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
    let [row, col] = await this.nvim.call('coc#float#win_position') as [number, number]
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

  private get dialogPreference(): DialogPreferences {
    let config = workspace.getConfiguration('dialog')
    return {
      maxWidth: config.get<number>('maxWidth'),
      maxHeight: config.get<number>('maxHeight'),
      floatHighlight: config.get<string>('floatHighlight'),
      floatBorderHighlight: config.get<string>('floatBorderHighlight'),
      pickerButtons: config.get<boolean>('pickerButtons'),
      pickerButtonShortcut: config.get<boolean>('pickerButtonShortcut'),
    }
  }

  private checkDialog(): boolean {
    if (workspace.env.dialog) return true
    this.showMessage('Dialog requires vim >= 8.2.0750 or neovim >= 0.4.0', 'warning')
    return false
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
