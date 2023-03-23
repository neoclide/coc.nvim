'use strict'
import type { Buffer, Neovim, Window } from '@chemzqm/neovim'
import Highlighter from '../model/highligher'
import { defaultValue, disposeAll, getConditionValue, wait } from '../util'
import { debounce } from '../util/node'
import { Disposable } from '../util/protocol'
import window from '../window'
import workspace from '../workspace'
import listConfiguration from './configuration'
import db from './db'
import InputHistory from './history'
import Prompt from './prompt'
import { IList, ListAction, ListContext, ListItem, ListMode, ListOptions, Matcher } from './types'
import UI from './ui'
import Worker from './worker'
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const debounceTime = getConditionValue(50, 1)

/**
 * Activated list session with UI and worker
 */
export default class ListSession {
  public readonly history: InputHistory
  public readonly ui: UI
  public readonly worker: Worker
  private cwd: string
  private loadingFrame = ''
  private timer: NodeJS.Timer
  private hidden = false
  private disposables: Disposable[] = []
  private savedHeight: number
  private targetWinid: number | undefined
  private targetBufnr: number | undefined
  /**
   * Original list arguments.
   */
  private args: string[] = []
  constructor(
    private nvim: Neovim,
    private prompt: Prompt,
    private list: IList,
    public readonly listOptions: ListOptions,
    private listArgs: string[]
  ) {
    this.ui = new UI(nvim, list.name, listOptions)
    this.history = new InputHistory(prompt, list.name, db, workspace.cwd)
    this.worker = new Worker(list, prompt, listOptions)
    let debouncedChangeLine = debounce(async () => {
      let [previewing, currwin, lnum] = await nvim.eval('[coc#list#has_preview(),win_getid(),line(".")]') as [number, number, number]
      if (previewing && currwin == this.winid) {
        let idx = this.ui.lnumToIndex(lnum)
        await this.doPreview(idx)
      }
    }, debounceTime)
    this.disposables.push({
      dispose: () => {
        debouncedChangeLine.clear()
      }
    })
    this.ui.onDidChangeLine(debouncedChangeLine, null, this.disposables)
    this.ui.onDidChangeLine(this.resolveItem, this, this.disposables)
    this.ui.onDidLineChange(this.resolveItem, this, this.disposables)
    let debounced = debounce(async () => {
      this.updateStatus()
      let { autoPreview } = this.listOptions
      if (!autoPreview) {
        let [previewing, mode] = await nvim.eval('[coc#list#has_preview(),mode()]') as [number, string]
        if (mode != 'n' || !previewing) return
      }
      await this.doAction('preview')
    }, 50)
    this.disposables.push({
      dispose: () => {
        debounced.clear()
      }
    })
    this.ui.onDidLineChange(debounced, null, this.disposables)
    this.ui.onDidOpen(async () => {
      if (typeof this.list.doHighlight == 'function') {
        this.list.doHighlight()
      }
      if (this.listOptions.first) {
        await this.doAction()
      }
    }, null, this.disposables)
    this.ui.onDidClose(this.hide as any, this, this.disposables)
    this.ui.onDidDoubleClick(this.doAction as any, this, this.disposables)
    this.worker.onDidChangeItems(ev => {
      if (this.hidden) return
      this.ui.onDidChangeItems(ev)
    }, null, this.disposables)
    let start = 0
    let timer: NodeJS.Timeout
    let interval: NodeJS.Timeout
    this.disposables.push(Disposable.create(() => {
      clearTimeout(timer)
      clearInterval(interval)
    }))
    this.worker.onDidChangeLoading(loading => {
      if (this.hidden) return
      if (timer) clearTimeout(timer)
      if (loading) {
        start = Date.now()
        if (interval) clearInterval(interval)
        interval = setInterval(() => {
          let idx = Math.floor((Date.now() - start) % 1000 / 100)
          this.loadingFrame = frames[idx]
          this.updateStatus()
        }, 100)
      } else {
        timer = setTimeout(() => {
          this.loadingFrame = ''
          if (interval) clearInterval(interval)
          interval = null
          this.updateStatus()
        }, Math.max(0, 200 - (Date.now() - start)))
      }
    }, null, this.disposables)
  }

  public async start(args: string[]): Promise<void> {
    this.args = args
    this.cwd = workspace.cwd
    this.hidden = false
    let { listArgs } = this
    let res = await this.nvim.eval('[win_getid(),bufnr("%"),winheight("%")]')
    this.listArgs = listArgs
    this.history.filter()
    this.targetWinid = res[0]
    this.targetBufnr = res[1]
    this.savedHeight = res[2]
    await this.worker.loadItems(this.context)
  }

  public async reloadItems(): Promise<void> {
    if (!this.ui.winid) return
    await this.worker.loadItems(this.context, true)
  }

  public async call(fname: string): Promise<any> {
    await this.nvim.call('coc#prompt#stop_prompt', ['list'])
    let targets = await this.ui.getItems()
    let context = {
      name: this.name,
      args: this.listArgs,
      input: this.prompt.input,
      winid: this.targetWinid,
      bufnr: this.targetBufnr,
      targets
    }
    let res = await this.nvim.call(fname, [context])
    this.prompt.start()
    return res
  }

  public async chooseAction(): Promise<void> {
    let { nvim, defaultAction } = this
    let { actions } = this.list
    let names: string[] = actions.map(o => o.name)
    let idx = names.indexOf(defaultAction.name)
    if (idx != -1) {
      names.splice(idx, 1)
      names.unshift(defaultAction.name)
    }
    let shortcuts: Set<string> = new Set()
    let choices: string[] = []
    let invalids: string[] = []
    let menuAction = workspace.env.dialog && listConfiguration.get('menuAction', false)
    for (let name of names) {
      let i = 0
      for (let ch of name) {
        if (!shortcuts.has(ch)) {
          shortcuts.add(ch)
          choices.push(`${name.slice(0, i)}&${name.slice(i)}`)
          break
        }
        i++
      }
      if (i == name.length) {
        invalids.push(name)
      }
    }
    if (invalids.length && !menuAction) {
      names = names.filter(s => !invalids.includes(s))
    }
    let n: number
    if (menuAction) {
      nvim.call('coc#prompt#stop_prompt', ['list'], true)
      n = await window.showMenuPicker(names, { title: 'Choose action', shortcuts: true })
      n = n + 1
      this.prompt.start()
    } else {
      await nvim.call('coc#prompt#stop_prompt', ['list'])
      n = await nvim.call('confirm', ['Choose action:', choices.join('\n')]) as number
      await wait(10)
      this.prompt.start()
    }
    if (n) await this.doAction(names[n - 1])
  }

  public async doAction(name?: string): Promise<void> {
    let { list } = this
    let action: ListAction
    if (name != null) {
      action = list.actions.find(o => o.name == name)
      if (!action) {
        void window.showErrorMessage(`Action ${name} not found`)
        return
      }
    } else {
      action = this.defaultAction
    }
    let items: ListItem[]
    if (name == 'preview') {
      let item = await this.ui.item
      items = item ? [item] : []
    } else {
      items = await this.ui.getItems()
    }
    if (items.length) await this.doItemAction(items, action)
  }

  public async doPreview(index: number): Promise<void> {
    let item = this.ui.getItem(index)
    let action = this.list.actions.find(o => o.name == 'preview')
    if (!item || !action) return
    await this.doItemAction([item], action)
  }

  public async first(): Promise<void> {
    await this.doDefaultAction(0)
  }

  public async last(): Promise<void> {
    await this.doDefaultAction(this.ui.length - 1)
  }

  public async previous(): Promise<void> {
    await this.doDefaultAction(this.ui.index - 1)
  }

  public async next(): Promise<void> {
    await this.doDefaultAction(this.ui.index + 1)
  }

  private async doDefaultAction(index: number): Promise<void> {
    let { ui } = this
    let item = ui.getItem(index)
    if (!item) return
    await this.ui.setIndex(index)
    await this.doItemAction([item], this.defaultAction)
    await ui.echoMessage(item)
  }

  /**
   * list name
   */
  public get name(): string {
    return this.list.name
  }

  /**
   * Window id used by list.
   *
   * @returns {number | undefined}
   */
  public get winid(): number | undefined {
    return this.ui.winid
  }

  public get length(): number {
    return this.ui.length
  }

  public get defaultAction(): ListAction {
    let { defaultAction, actions, name } = this.list
    let config = workspace.getConfiguration(`list.source.${name}`)
    let action: ListAction
    if (config.defaultAction) action = actions.find(o => o.name == config.defaultAction)
    if (!action) action = actions.find(o => o.name == defaultAction)
    if (!action) action = actions[0]
    if (!action) throw new Error(`default action "${defaultAction}" not found`)
    return action
  }

  public async hide(notify = false, isVim = workspace.isVim): Promise<void> {
    if (this.hidden) return
    let { nvim, timer, targetWinid, context } = this
    let { winid } = this.ui
    if (timer) clearTimeout(timer)
    this.worker.stop()
    this.history.add()
    this.ui.reset()
    db.save()
    this.hidden = true
    nvim.pauseNotification()
    if (!isVim) nvim.call('coc#prompt#stop_prompt', ['list'], true)
    if (winid) nvim.call('coc#list#close', [winid, context.options.position, targetWinid, this.savedHeight], true)
    if (notify) return nvim.resumeNotification(true, true)
    await nvim.resumeNotification(false)
    if (isVim) {
      // required on vim
      await wait(10)
      nvim.call('coc#prompt#stop_prompt', ['list'], true)
      nvim.redrawVim()
    }
  }

  public toggleMode(): void {
    let mode: ListMode = this.prompt.mode == 'normal' ? 'insert' : 'normal'
    this.prompt.mode = mode
    this.listOptions.mode = mode
    this.updateStatus()
  }

  public stop(): void {
    this.worker.stop()
  }

  public async resolveItem(): Promise<void> {
    let index = this.ui.index
    let item = this.ui.getItem(index)
    if (!item || item.resolved) return
    let { list } = this
    if (typeof list.resolveItem === 'function') {
      let label = item.label
      let resolved = await Promise.resolve(list.resolveItem(item))
      if (resolved && index == this.ui.index) {
        Object.assign(item, resolved, { resolved: true })
        if (label == resolved.label) return
        this.ui.updateItem(item, index)
      }
    }
  }

  public async showHelp(): Promise<void> {
    await this.hide()
    let { list, nvim } = this
    nvim.pauseNotification()
    nvim.command(`tabe +setl\\ previewwindow [LIST HELP]`, true)
    nvim.command('setl nobuflisted noswapfile buftype=nofile bufhidden=wipe', true)
    await nvim.resumeNotification()
    let hasOptions = list.options && list.options.length
    let buf = await nvim.buffer
    let highligher = new Highlighter()
    highligher.addLine('NAME', 'Label')
    highligher.addLine(`  ${list.name} - ${list.description || ''}\n`)
    highligher.addLine('SYNOPSIS', 'Label')
    highligher.addLine(`  :CocList [LIST OPTIONS] ${list.name}${hasOptions ? ' [ARGUMENTS]' : ''}\n`)
    if (list.detail) {
      highligher.addLine('DESCRIPTION', 'Label')
      let lines = list.detail.split('\n').map(s => '  ' + s)
      highligher.addLine(lines.join('\n') + '\n')
    }
    if (hasOptions) {
      highligher.addLine('ARGUMENTS', 'Label')
      highligher.addLine('')
      for (let opt of list.options) {
        highligher.addLine(opt.name, 'Special')
        highligher.addLine(`  ${opt.description}`)
        highligher.addLine('')
      }
      highligher.addLine('')
    }
    let config = workspace.getConfiguration(`list.source.${list.name}`)
    if (Object.keys(config).length) {
      highligher.addLine('CONFIGURATIONS', 'Label')
      highligher.addLine('')
      for (let key of Object.keys(config)) {
        let val = config[key]
        let name = `list.source.${list.name}.${key}`
        let description = defaultValue(workspace.configurations.getDescription(name), key)
        highligher.addLine(`  "${name}"`, 'MoreMsg')
        highligher.addText(` - ${description} current value: `)
        highligher.addText(JSON.stringify(val), 'Special')
      }
      highligher.addLine('')
    }
    highligher.addLine('ACTIONS', 'Label')
    highligher.addLine(`  ${list.actions.map(o => o.name).join(', ')}`)
    highligher.addLine('')
    highligher.addLine(`see ':h coc-list-options' for available list options.`, 'Comment')
    nvim.pauseNotification()
    highligher.render(buf, 0, -1)
    nvim.command('setl nomod', true)
    nvim.command('setl nomodifiable', true)
    nvim.command('normal! gg', true)
    nvim.command('nnoremap <buffer> q :bd!<CR>', true)
    await nvim.resumeNotification()
  }

  public async switchMatcher(): Promise<void> {
    let { matcher, interactive } = this.listOptions
    if (interactive) return
    const list: Matcher[] = ['fuzzy', 'strict', 'regex']
    let idx = list.indexOf(matcher) + 1
    if (idx >= list.length) idx = 0
    this.listOptions.matcher = list[idx]
    this.prompt.matcher = list[idx]
    await this.worker.drawItems()
  }

  private updateStatus(): void {
    let { ui, list, nvim } = this
    if (!ui.bufnr) return
    let buf = nvim.createBuffer(ui.bufnr)
    let status = {
      mode: this.prompt.mode.toUpperCase(),
      args: this.args.join(' '),
      name: list.name,
      cwd: this.cwd,
      loading: this.loadingFrame,
      total: this.worker.length
    }
    buf.setVar('list_status', status, true)
    nvim.command('redraws', true)
  }

  public get context(): ListContext {
    let { winid } = this.ui
    return {
      options: this.listOptions,
      args: this.listArgs,
      input: this.prompt.input,
      cwd: workspace.cwd,
      window: this.window,
      buffer: this.buffer,
      listWindow: winid ? this.nvim.createWindow(winid) : undefined
    }
  }

  private get window(): Window | undefined {
    return this.targetWinid ? this.nvim.createWindow(this.targetWinid) : undefined
  }

  private get buffer(): Buffer | undefined {
    return this.targetBufnr ? this.nvim.createBuffer(this.targetBufnr) : undefined
  }

  public onMouseEvent(key): Promise<void> {
    switch (key) {
      case '<LeftMouse>':
        return this.ui.onMouse('mouseDown')
      case '<LeftDrag>':
        return this.ui.onMouse('mouseDrag')
      case '<LeftRelease>':
        return this.ui.onMouse('mouseUp')
      case '<2-LeftMouse>':
        return this.ui.onMouse('doubleClick')
    }
  }

  public async doNumberSelect(ch: string): Promise<boolean> {
    if (!this.listOptions.numberSelect) return false
    let code = ch.charCodeAt(0)
    if (code >= 48 && code <= 57) {
      let n = Number(ch)
      if (n == 0) n = 10
      if (this.ui.length >= n) {
        this.nvim.pauseNotification()
        this.ui.setCursor(n)
        await this.nvim.resumeNotification()
        await this.doAction()
        return true
      }
    }
    return false
  }

  public jumpBack(): void {
    let { targetWinid, nvim } = this
    if (targetWinid) {
      nvim.pauseNotification()
      nvim.call('coc#prompt#stop_prompt', ['list'], true)
      this.nvim.call('win_gotoid', [targetWinid], true)
      nvim.resumeNotification(false, true)
    }
  }

  public async resume(): Promise<void> {
    if (this.winid) await this.hide()
    let res = await this.nvim.eval('[win_getid(),bufnr("%"),winheight("%")]')
    this.hidden = false
    this.targetWinid = res[0]
    this.targetBufnr = res[1]
    this.savedHeight = res[2]
    this.prompt.start()
    await this.ui.resume()
    if (this.listOptions.autoPreview) {
      await this.doAction('preview')
    }
  }

  private async doItemAction(items: ListItem[], action: ListAction): Promise<void> {
    let { noQuit, position } = this.listOptions
    let { nvim } = this
    let persistAction = action.persist === true || action.name == 'preview'
    if (position === 'tab' && action.tabPersist) persistAction = true
    let persist = this.winid && (persistAction || noQuit)
    if (persist) {
      if (!persistAction) {
        nvim.pauseNotification()
        nvim.call('coc#prompt#stop_prompt', ['list'], true)
        nvim.call('win_gotoid', [this.context.window.id], true)
        await nvim.resumeNotification()
      }
    } else {
      await this.hide()
    }
    if (action.multiple) {
      await Promise.resolve(action.execute(items, this.context))
    } else if (action.parallel) {
      await Promise.all(items.map(item => Promise.resolve(action.execute(item, this.context))))
    } else {
      for (let item of items) {
        await Promise.resolve(action.execute(item, this.context))
      }
    }
    if (persist) this.ui.restoreWindow()
    if (action.reload && persist) {
      await this.reloadItems()
    } else if (persist) {
      this.nvim.command('redraw', true)
    }
  }

  public onInputChange(): void {
    if (this.timer) clearTimeout(this.timer)
    this.ui.cancel()
    this.history.filter()
    this.listOptions.input = this.prompt.input
    // reload or filter items
    if (this.listOptions.interactive) {
      this.worker.stop()
      this.timer = setTimeout(async () => {
        await this.worker.loadItems(this.context)
      }, listConfiguration.debounceTime)
    } else {
      void this.worker.drawItems()
    }
  }

  public dispose(): void {
    void this.hide(true)
    disposeAll(this.disposables)
    this.worker.dispose()
    this.ui.dispose()
  }
}
