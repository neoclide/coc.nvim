'use strict'
import { Neovim } from '@chemzqm/neovim'
import type { Position, Range } from 'vscode-languageserver-types'
import type { WorkspaceConfiguration } from './configuration/types'
import channels from './core/channels'
import { Dialogs, InputOptions, Item, MenuOption, QuickPickConfig, QuickPickOptions } from './core/dialogs'
import type { TextEditor } from './core/editors'
import { HighlightDiff, Highlights } from './core/highlights'
import { Notifications, ProgressOptions } from './core/notifications'
import Terminals, { OpenTerminalOption, TerminalResult } from './core/terminals'
import * as ui from './core/ui'
import type Cursors from './cursors/index'
import type { Dialog, DialogConfig } from './model/dialog'
import type { FloatWinConfig } from './model/floatFactory'
import InputBox, { InputPreference } from './model/input'
import type { MenuItem } from './model/menu'
import type { MessageItem, NotificationConfig } from './model/notification'
import type { Progress } from './model/progress'
import type QuickPick from './model/quickpick'
import type { StatusBarItem } from './model/status'
import type { TerminalModel, TerminalOptions } from './model/terminal'
import type { TreeView, TreeViewOptions } from './tree'
import type { Env, FloatConfig, FloatFactory, HighlightItem, OutputChannel, QuickPickItem } from './types'
import { toObject } from './util/object'
import { CancellationToken, Event } from './util/protocol'
import type { Workspace } from './workspace'

export interface StatusItemOption {
  progress?: boolean
}

export class Window {
  private nvim: Neovim
  public highlights: Highlights = new Highlights()
  private terminalManager: Terminals = new Terminals()
  private notifications: Notifications
  private dialogs = new Dialogs()
  public readonly cursors: Cursors
  private workspace: Workspace
  constructor() {
    this.notifications = new Notifications(this.dialogs)
    Object.defineProperty(this.highlights, 'nvim', {
      get: () => this.nvim
    })
    Object.defineProperty(this.dialogs, 'nvim', {
      get: () => this.nvim
    })
    Object.defineProperty(this.dialogs, 'configuration', {
      get: () => this.workspace.initialConfiguration
    })
    Object.defineProperty(this.notifications, 'nvim', {
      get: () => this.nvim
    })
    Object.defineProperty(this.notifications, 'configuration', {
      get: () => this.workspace.initialConfiguration
    })
    Object.defineProperty(this.notifications, 'statusLine', {
      get: () => this.workspace.statusLine
    })
  }

  public init(env: Env): void {
    this.highlights.checkMarkers = this.workspace.has('nvim-0.5.1') || env.isVim
  }

  public get activeTextEditor(): TextEditor | undefined {
    return this.workspace.editors.activeTextEditor
  }

  public get visibleTextEditors(): TextEditor[] {
    return this.workspace.editors.visibleTextEditors
  }

  public get onDidTabClose(): Event<number> {
    return this.workspace.editors.onDidTabClose
  }

  public get onDidChangeActiveTextEditor(): Event<TextEditor | undefined> {
    return this.workspace.editors.onDidChangeActiveTextEditor
  }

  public get onDidChangeVisibleTextEditors(): Event<ReadonlyArray<TextEditor>> {
    return this.workspace.editors.onDidChangeVisibleTextEditors
  }

  public get terminals(): ReadonlyArray<TerminalModel> {
    return this.terminalManager.terminals
  }

  public get onDidOpenTerminal(): Event<TerminalModel> {
    return this.terminalManager.onDidOpenTerminal
  }

  public get onDidCloseTerminal(): Event<TerminalModel> {
    return this.terminalManager.onDidCloseTerminal
  }

  public async createTerminal(opts: TerminalOptions): Promise<TerminalModel> {
    return await this.terminalManager.createTerminal(this.nvim, opts)
  }

  /**
   * Run command in vim terminal for result
   *
   * @param cmd Command to run.
   * @param cwd Cwd of terminal, default to result of |getcwd()|.
   */
  public async runTerminalCommand(cmd: string, cwd?: string, keepfocus = false): Promise<TerminalResult> {
    return await this.terminalManager.runTerminalCommand(this.nvim, cmd, cwd, keepfocus)
  }

  /**
   * Open terminal window.
   *
   * @param cmd Command to run.
   * @param opts Terminal option.
   * @returns number buffer number of terminal
   */
  public async openTerminal(cmd: string, opts?: OpenTerminalOption): Promise<number> {
    return await this.terminalManager.openTerminal(this.nvim, cmd, opts)
  }

  /**
   * Reveal message with message type.
   *
   * @param msg Message text to show.
   * @param messageType Type of message, could be `error` `warning` and `more`, default to `more`
   */
  public showMessage(msg: string, messageType: ui.MsgTypes = 'more'): void {
    this.notifications.echoMessages(msg, messageType)
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
    let command = this.configuration.get<string>('workspace.openOutputCommand', 'vs')
    channels.show(name, command, preserveFocus)
  }

  /**
   * Echo lines at the bottom of vim.
   *
   * @param lines Line list.
   * @param truncate Truncate the lines to avoid 'press enter to continue' when true
   */
  public async echoLines(lines: string[], truncate = false): Promise<void> {
    await ui.echoLines(this.nvim, this.workspace.env, lines, truncate)
  }

  /**
   * Get current cursor position (line, character both 0 based).
   *
   * @returns Cursor position.
   */
  public getCursorPosition(): Promise<Position> {
    return ui.getCursorPosition(this.nvim)
  }

  /**
   * Move cursor to position.
   *
   * @param position LSP position.
   */
  public async moveTo(position: Position): Promise<void> {
    await ui.moveTo(this.nvim, position, this.workspace.env.isVim)
  }

  /**
   * Get selected range for current document
   */
  public getSelectedRange(mode: string): Promise<Range | null> {
    return ui.getSelection(this.nvim, mode)
  }

  /**
   * Visual select range of current document
   */
  public async selectRange(range: Range): Promise<void> {
    await ui.selectRange(this.nvim, range, this.nvim.isVim)
  }

  /**
   * Get current cursor character offset in document,
   * length of line break would always be 1.
   *
   * @returns Character offset.
   */
  public getOffset(): Promise<number> {
    return ui.getOffset(this.nvim)
  }

  /**
   * Get screen position of current cursor(relative to editor),
   * both `row` and `col` are 0 based.
   *
   * @returns Cursor screen position.
   */
  public getCursorScreenPosition(): Promise<ui.ScreenPosition> {
    return ui.getCursorScreenPosition(this.nvim)
  }

  /**
   * Create a {@link TreeView} instance.
   *
   * @param viewId Id of the view, used as title of TreeView when title doesn't exist.
   * @param options Options for creating the {@link TreeView}
   * @returns a {@link TreeView}.
   */
  public createTreeView<T>(viewId: string, options: TreeViewOptions<T>): TreeView<T> {
    const BasicTreeView = require('./tree/TreeView').default
    return new BasicTreeView(viewId, options)
  }

  /**
   * Create statusbar item that would be included in `g:coc_status`.
   *
   * @param priority Higher priority item would be shown right.
   * @param option
   * @return A new status bar item.
   */
  public createStatusBarItem(priority = 0, option: StatusItemOption = {}): StatusBarItem {
    return this.workspace.statusLine.createStatusBarItem(priority, option.progress)
  }

  /**
   * Get diff from highlight items and current highlights on vim.
   * Return null when buffer not loaded
   *
   * @param bufnr Buffer number
   * @param ns Highlight namespace
   * @param items Highlight items
   * @param region 0 based start and end line count (end exclusive)
   * @param token CancellationToken
   * @returns {Promise<HighlightDiff | null>}
   */
  public async diffHighlights(bufnr: number, ns: string, items: HighlightItem[], region?: [number, number] | undefined, token?: CancellationToken): Promise<HighlightDiff | null> {
    return this.highlights.diffHighlights(bufnr, ns, items, region, token)
  }

  /**
   * Create a FloatFactory, user's configurations are respected.
   *
   * @param {FloatWinConfig} conf - Float window configuration
   * @returns {FloatFactory}
   */
  public createFloatFactory(conf: FloatWinConfig): FloatFactory {
    let configuration = this.workspace.initialConfiguration
    let defaults = toObject(configuration.get('floatFactory.floatConfig')) as FloatConfig
    let markdownPreference = this.workspace.configurations.markdownPreference
    return ui.createFloatFactory(this.workspace.nvim, Object.assign({ ...markdownPreference, maxWidth: 80 }, conf), defaults)
  }

  /**
   * Show quickpick for single item, use `window.menuPick` for menu at current current position.
   *
   * @deprecated Use 'window.showMenuPicker()' or `window.showQuickPick` instead.
   * @param items Label list.
   * @param placeholder Prompt text, default to 'choose by number'.
   * @returns Index of selected item, or -1 when canceled.
   */
  public async showQuickpick(items: string[], placeholder = 'Choose by number'): Promise<number> {
    return await this.showMenuPicker(items, { title: placeholder, position: 'center' })
  }

  /**
   * Shows a selection list.
   */
  public async showQuickPick(itemsOrItemsPromise: Item[] | Promise<Item[]>, options?: QuickPickOptions, token: CancellationToken = CancellationToken.None): Promise<Item | Item[] | undefined> {
    return await this.dialogs.showQuickPick(itemsOrItemsPromise, options, token)
  }

  /**
   * Creates a {@link QuickPick} to let the user pick an item or items from a
   * list of items of type T.
   *
   * Note that in many cases the more convenient {@link window.showQuickPick}
   * is easier to use. {@link window.createQuickPick} should be used
   * when {@link window.showQuickPick} does not offer the required flexibility.
   *
   * @return A new {@link QuickPick}.
   */
  public async createQuickPick<T extends QuickPickItem>(config: QuickPickConfig<T> = {}): Promise<QuickPick<T>> {
    return await this.dialogs.createQuickPick(config)
  }

  /**
   * Show menu picker at current cursor position, |inputlist()| is used as fallback.
   *
   * @param items Array of texts.
   * @param option Options for menu.
   * @param token A token that can be used to signal cancellation.
   * @returns Selected index (0 based), -1 when canceled.
   */
  public async showMenuPicker(items: string[] | MenuItem[], option?: MenuOption, token?: CancellationToken): Promise<number> {
    return await this.dialogs.showMenuPicker(items, option, token)
  }

  /**
   * Prompt user for confirm, a float/popup window would be used when possible,
   * use vim's |confirm()| function as callback.
   *
   * @param title The prompt text.
   * @returns Result of confirm.
   */
  public async showPrompt(title: string): Promise<boolean> {
    return await this.dialogs.showPrompt(title)
  }

  /**
   * Show dialog window at the center of screen.
   * Note that the dialog would always be closed after button click.
   *
   * @param config Dialog configuration.
   * @returns Dialog or null when dialog can't work.
   */
  public async showDialog(config: DialogConfig): Promise<Dialog | null> {
    return await this.dialogs.showDialog(config)
  }

  /**
   * Request input from user
   *
   * @param title Title text of prompt window.
   * @param value Default value of input, empty text by default.
   * @param {InputOptions} option for input window
   * @returns {Promise<string>}
   */
  public async requestInput(title: string, value?: string, option?: InputOptions): Promise<string | undefined> {
    return await this.dialogs.requestInput(title, this.workspace.env, value, option)
  }

  /**
   * Creates and show a {@link InputBox} to let the user enter some text input.
   *
   * @return A new {@link InputBox}.
   */
  public async createInputBox(title: string, value: string | undefined, option?: InputPreference): Promise<InputBox> {
    return await this.dialogs.createInputBox(title, value, option)
  }

  /**
   * Show multiple picker at center of screen.
   * Use `this.workspace.env.dialog` to check if dialog could work.
   *
   * @param items Array of QuickPickItem or string.
   * @param title Title of picker dialog.
   * @param token A token that can be used to signal cancellation.
   * @return A promise that resolves to the selected items or `undefined`.
   */
  public async showPickerDialog(items: string[], title: string, token?: CancellationToken): Promise<string[] | undefined>
  public async showPickerDialog<T extends QuickPickItem>(items: T[], title: string, token?: CancellationToken): Promise<T[] | undefined>
  public async showPickerDialog(items: any, title: string, token?: CancellationToken): Promise<any | undefined> {
    return await this.dialogs.showPickerDialog(items, title, token)
  }

  /**
   * Show an information message to users. Optionally provide an array of items which will be presented as
   * clickable buttons.
   *
   * @param message The message to show.
   * @param items A set of items that will be rendered as actions in the message.
   * @return Promise that resolves to the selected item or `undefined` when being dismissed.
   */
  public async showInformationMessage<T extends MessageItem | string>(message: string, ...items: T[]): Promise<T | undefined> {
    let stack = Error().stack
    return await this.notifications._showMessage('Info', message, items, stack)
  }

  /**
   * Show an warning message to users. Optionally provide an array of items which will be presented as
   * clickable buttons.
   *
   * @param message The message to show.
   * @param items A set of items that will be rendered as actions in the message.
   * @return Promise that resolves to the selected item or `undefined` when being dismissed.
   */
  public async showWarningMessage<T extends MessageItem | string>(message: string, ...items: T[]): Promise<T | undefined> {
    let stack = Error().stack
    return await this.notifications._showMessage('Warning', message, items, stack)
  }

  /**
   * Show an error message to users. Optionally provide an array of items which will be presented as
   * clickable buttons.
   *
   * @param message The message to show.
   * @param items A set of items that will be rendered as actions in the message.
   * @return Promise that resolves to the selected item or `undefined` when being dismissed.
   */
  public async showErrorMessage<T extends MessageItem | string>(message: string, ...items: T[]): Promise<T | undefined> {
    let stack = Error().stack
    return await this.notifications._showMessage('Error', message, items, stack)
  }

  public async showNotification(config: NotificationConfig): Promise<void> {
    let stack = Error().stack
    await this.notifications.showNotification(config, stack)
  }

  /**
   * Show progress in the editor. Progress is shown while running the given callback
   * and while the promise it returned isn't resolved nor rejected.
   */
  public async withProgress<R>(options: ProgressOptions, task: (progress: Progress, token: CancellationToken) => Thenable<R>): Promise<R> {
    return this.notifications.withProgress(options, task)
  }

  /**
   * Apply highlight diffs, normally used with `window.diffHighlights`
   *
   * Timer is used to add highlights when there're too many highlight items to add,
   * the highlight process won't be finished on that case.
   *
   * @param {number} bufnr - Buffer name
   * @param {string} ns - Namespace
   * @param {number} priority
   * @param {HighlightDiff} diff
   * @param {boolean} notify - Use notification, default false.
   * @returns {Promise<void>}
   */
  public async applyDiffHighlights(bufnr: number, ns: string, priority: number, diff: HighlightDiff, notify = false): Promise<void> {
    return this.highlights.applyDiffHighlights(bufnr, ns, priority, diff, notify)
  }

  private get configuration(): WorkspaceConfiguration {
    return this.workspace.initialConfiguration
  }

  public dispose(): void {
    this.terminalManager.dispose()
  }
}

export default new Window()
