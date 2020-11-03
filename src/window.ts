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
  private menu: Menu
  private mutex = new Mutex()
  private statusLine: StatusLine

  private get nvim(): Neovim {
    return workspace.nvim
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

  /**
   * Show message in vim.
   */
  public showMessage(msg: string, identify: MsgTypes = 'more'): void {
    if (this.mutex.busy || !this.nvim) return
    let { messageLevel } = this
    let method = process.env.VIM_NODE_RPC == '1' ? 'callTimer' : 'call'
    let hl = 'Error'
    let level = MessageLevel.Error
    switch (identify) {
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
   */
  public async runTerminalCommand(cmd: string, cwd?: string, keepfocus = false): Promise<TerminalResult> {
    cwd = cwd || workspace.cwd
    return await this.nvim.callAsync('coc#util#run_terminal', { cmd, cwd, keepfocus: keepfocus ? 1 : 0 }) as TerminalResult
  }

  /**
   * Open terminal buffer with cmd & opts
   */
  public async openTerminal(cmd: string, opts: OpenTerminalOption = {}): Promise<number> {
    let bufnr = await this.nvim.call('coc#util#open_terminal', { cmd, ...opts })
    return bufnr as number
  }

  /**
   * Show quickpick for single item
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
   * Show menu picker at current cursor position.
   */
  public async menuPick(items: string[], title?: string): Promise<number> {
    if (workspace.env.dialog) {
      if (!this.menu) this.menu = new Menu(this.nvim, workspace.env)
      let menu = this.menu
      menu.show(items, title)
      let res = await new Promise<number>(resolve => {
        let disposables: Disposable[] = []
        menu.onDidCancel(() => {
          disposeAll(disposables)
          resolve(-1)
        }, null, disposables)
        menu.onDidChoose(idx => {
          disposeAll(disposables)
          resolve(idx)
        }, null, disposables)
      })
      return res
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
   * Prompt for confirm action.
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

  public async showDialog(config: DialogConfig): Promise<Dialog | null> {
    if (!workspace.env.dialog) {
      this.showMessage('Dialog requires vim >= 8.2.0750 or neovim >= 0.4.3', 'warning')
      return null
    }
    let dialog = new Dialog(this.nvim, config)
    await dialog.show(this.dialogPreference)
    return dialog
  }

  /**
   * Request input from user
   */
  public async requestInput(title: string, defaultValue?: string): Promise<string> {
    let { nvim } = this
    const preferences = workspace.getConfiguration('coc.preferences')
    if (workspace.isNvim && semver.gte(workspace.env.version, '0.4.3') && preferences.get<boolean>('promptInput', true)) {
      let arr = await nvim.call('coc#float#create_prompt_win', [title, defaultValue || ''])
      if (!arr || arr.length == 0) return null
      let [bufnr, winid] = arr
      let cleanUp = () => {
        nvim.pauseNotification()
        nvim.call('coc#float#close', [winid], true)
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        nvim.resumeNotification(false, true)
      }
      let res = await new Promise<string>(resolve => {
        let disposables: Disposable[] = []
        events.on('BufUnload', nr => {
          if (nr == bufnr) {
            disposeAll(disposables)
            cleanUp()
            resolve(null)
          }
        }, null, disposables)
        events.on('PromptInsert', value => {
          if (!value) {
            setTimeout(() => {
              this.showMessage('Empty word, canceled', 'warning')
            }, 30)
            resolve(null)
          } else {
            resolve(value)
          }
        }, null, disposables)
      })
      return res
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
   * Create StatusBarItem
   */
  public createStatusBarItem(priority = 0, opt: StatusItemOption = {}): StatusBarItem {
    if (!workspace.env) {
      let fn = () => { }
      return { text: '', show: fn, dispose: fn, hide: fn, priority: 0, isProgress: false }
    }
    if (!this.statusLine) {
      this.statusLine = new StatusLine(this.nvim)
    }
    return this.statusLine.createStatusBarItem(priority, opt.progress || false)
  }

  /**
   * Create a new output channel
   */
  public createOutputChannel(name: string): OutputChannel {
    return channels.create(name, this.nvim)
  }

  /**
   * Reveal buffer of output channel.
   */
  public showOutputChannel(name: string, preserveFocus?: boolean): void {
    channels.show(name, preserveFocus)
  }

  /**
   * Echo lines.
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
   * Get current cursor position (line, character).
   */
  public async getCursorPosition(): Promise<Position> {
    let [line, character] = await this.nvim.call('coc#util#cursor')
    return Position.create(line, character)
  }

  /**
   * Move cursor to position.
   */
  public async moveTo(position: Position): Promise<void> {
    await this.nvim.call('coc#util#jumpTo', [position.line, position.character])
    if (workspace.env.isVim) this.nvim.command('redraw', true)
  }

  /**
   * Get current cursor offset in document.
   */
  public async getOffset(): Promise<number> {
    return await this.nvim.call('coc#util#get_offset') as number
  }

  /**
   * Get screen position of current cursor, 0 based
   */
  public async getCursorScreenPosition(): Promise<ScreenPosition> {
    let [row, col] = await this.nvim.call('coc#float#win_position') as [number, number]
    return { row, col }
  }

  public async showPickerDialog(items: string[], title: string, token?: CancellationToken): Promise<string[] | undefined>
  public async showPickerDialog<T extends QuickPickItem>(items: T[], title: string, token?: CancellationToken): Promise<T[] | undefined>
  public async showPickerDialog<T extends QuickPickItem>(items: any[], title: string, token?: CancellationToken): Promise<string[] | T[] | undefined> {
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
    if (!picked) return undefined
    return items.filter((_, i) => picked.includes(i))
  }

  private get dialogPreference(): DialogPreferences {
    let config = workspace.getConfiguration('dialog')
    return {
      maxWidth: config.get('maxWidth', 80),
      maxHeight: config.get('maxHeight', 20)
    }
  }
}

export default new Window()
