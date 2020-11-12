import { Buffer, Neovim, Window } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import extensions from '../extensions'
import Highlighter from '../model/highligher'
import { IList, ListAction, ListContext, ListItem, ListMode, ListOptions, Matcher } from '../types'
import { disposeAll, wait } from '../util'
import workspace from '../workspace'
import window from '../window'
import ListConfiguration from './configuration'
import InputHistory from './history'
import Prompt from './prompt'
import UI from './ui'
import Worker from './worker'
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const logger = require('../util/logger')('list-session')

/**
 * Activated list session with UI and worker
 */
export default class ListSession {
  public readonly history: InputHistory
  public readonly ui: UI
  public readonly worker: Worker
  private cwd: string
  private uiTokenSource: CancellationTokenSource
  private interval: NodeJS.Timer
  private loadingFrame = ''
  private timer: NodeJS.Timer
  private hidden = false
  private disposables: Disposable[] = []
  private savedHeight: number
  private window: Window
  private buffer: Buffer
  private interactiveDebounceTime: number
  /**
   * Original list arguments.
   */
  private args: string[] = []
  constructor(
    private nvim: Neovim,
    private prompt: Prompt,
    private list: IList,
    public readonly listOptions: ListOptions,
    private listArgs: string[] = [],
    private config: ListConfiguration
  ) {
    this.ui = new UI(nvim, list.name, listOptions, config)
    this.history = new InputHistory(prompt, list.name)
    this.worker = new Worker(nvim, list, prompt, listOptions, {
      interactiveDebounceTime: config.get<number>('interactiveDebounceTime', 100),
      extendedSearchMode: config.get<boolean>('extendedSearchMode', true)
    })
    this.interactiveDebounceTime = config.get<number>('interactiveDebounceTime', 100)
    let debouncedChangeLine = debounce(async () => {
      let [previewing, mode] = await nvim.eval('[coc#util#has_preview(),mode()]') as [number, string]
      if (!previewing || mode != 'n') return
      if (previewing) await this.doAction('preview')
    }, 50)
    this.disposables.push({
      dispose: () => {
        debouncedChangeLine.clear()
      }
    })
    this.ui.onDidChangeLine(debouncedChangeLine, null, this.disposables)
    this.ui.onDidChangeLine(this.resolveItem, this, this.disposables)
    this.ui.onDidLineChange(this.resolveItem, this, this.disposables)
    let debounced = debounce(async () => {
      let { autoPreview } = this.listOptions
      if (!autoPreview) {
        let [previewing, mode] = await nvim.eval('[coc#util#has_preview(),mode()]') as [number, string]
        if (!previewing || mode != 'n') return
      }
      await this.doAction('preview')
    }, 50)
    this.disposables.push({
      dispose: () => {
        debounced.clear()
      }
    })
    this.ui.onDidLineChange(debounced, null, this.disposables)
    this.ui.onDidLineChange(() => {
      this.updateStatus()
    }, null, this.disposables)
    this.ui.onDidOpen(async () => {
      if (typeof this.list.doHighlight == 'function') {
        this.list.doHighlight()
      }
      if (this.listOptions.first) {
        await this.doAction()
      }
    }, null, this.disposables)
    this.ui.onDidClose(async () => {
      await this.hide()
    }, null, this.disposables)
    this.ui.onDidDoubleClick(async () => {
      await this.doAction()
    }, null, this.disposables)
    this.worker.onDidChangeItems(async ({ items, highlights, reload, append, finished }) => {
      if (this.hidden) return
      if (append) {
        this.ui.addHighlights(highlights, true)
        await this.ui.appendItems(items)
      } else {
        this.ui.addHighlights(highlights)
        let height = this.config.get<number>('height', 10)
        if (finished && !listOptions.interactive && listOptions.input.length == 0) {
          height = Math.min(items.length, height)
        }
        let tokenSource = this.uiTokenSource = new CancellationTokenSource()
        await this.ui.drawItems(items, Math.max(1, height), reload, tokenSource.token)
      }
    }, null, this.disposables)
    this.worker.onDidChangeLoading(loading => {
      if (this.hidden) return
      if (loading) {
        this.interval = setInterval(() => {
          let idx = Math.floor((new Date()).getMilliseconds() / 100)
          this.loadingFrame = frames[idx]
          this.updateStatus()
        }, 100)
      } else {
        if (this.interval) {
          this.loadingFrame = ''
          clearInterval(this.interval)
          this.interval = null
        }
        this.updateStatus()
      }
    }, null, this.disposables)
  }

  public async start(args: string[]): Promise<void> {
    this.args = args
    this.cwd = workspace.cwd
    this.hidden = false
    let { listOptions, listArgs } = this
    let res = await this.nvim.eval('[win_getid(),bufnr("%"),winheight("%"),execute("pclose","silent!")]')
    this.listArgs = listArgs
    this.history.load(listOptions.input || '')
    this.window = this.nvim.createWindow(res[0])
    this.buffer = this.nvim.createBuffer(res[1])
    this.savedHeight = res[2]
    await this.worker.loadItems(this.context)
  }

  public async reloadItems(): Promise<void> {
    if (!this.window) return
    let bufnr = await this.nvim.call('winbufnr', [this.window.id])
    // can't reload since window not exists
    if (bufnr == -1) return
    this.buffer = this.nvim.createBuffer(bufnr)
    await this.worker.loadItems(this.context, true)
  }

  public async call(fname: string): Promise<any> {
    await this.nvim.call('coc#prompt#stop_prompt', ['list'])
    let targets = await this.ui.getItems()
    let context = {
      name: this.name,
      args: this.listArgs,
      input: this.prompt.input,
      winid: this.window?.id,
      bufnr: this.buffer?.id,
      targets
    }
    let res = await this.nvim.call(fname, [context])
    this.prompt.start()
    return res
  }

  public async chooseAction(): Promise<void> {
    let { nvim } = this
    let { actions, defaultAction } = this.list
    let names: string[] = actions.map(o => o.name)
    let idx = names.indexOf(defaultAction)
    if (idx != -1) {
      names.splice(idx, 1)
      names.unshift(defaultAction)
    }
    let shortcuts: Set<string> = new Set()
    let choices: string[] = []
    let invalids: string[] = []
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
    if (invalids.length) {
      logger.error(`Can't create shortcut for actions: ${invalids.join(',')} of "${this.name}" list`)
      names = names.filter(s => !invalids.includes(s))
    }
    await nvim.call('coc#prompt#stop_prompt', ['list'])
    let n = await nvim.call('confirm', ['Choose action:', choices.join('\n')]) as number
    await wait(10)
    this.prompt.start()
    if (n) await this.doAction(names[n - 1])
  }

  public async doAction(name?: string): Promise<void> {
    let { list } = this
    name = name || list.defaultAction
    let action = list.actions.find(o => o.name == name)
    if (!action) {
      window.showMessage(`Action ${name} not found`, 'error')
      return
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

  public async first(): Promise<void> {
    let { ui } = this
    let item = this.ui.firstItem
    if (!item) return
    ui.index = 0
    await this.doItemAction([item], this.defaultAction)
    await ui.echoMessage(item)
  }

  public async last(): Promise<void> {
    let { ui } = this
    let item = this.ui.lastItem
    if (!item) return
    ui.index = this.ui.length - 1
    await this.doItemAction([item], this.defaultAction)
    await ui.echoMessage(item)
  }

  public async previous(): Promise<void> {
    let { ui } = this
    let item = ui.getItem(-1)
    if (!item) return
    ui.index = ui.index - 1
    await this.doItemAction([item], this.defaultAction)
    await ui.echoMessage(item)
  }

  public async next(): Promise<void> {
    let { ui } = this
    let item = ui.getItem(1)
    if (!item) return
    ui.index = ui.index + 1
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

  private get defaultAction(): ListAction {
    let { defaultAction, actions } = this.list
    let action = actions.find(o => o.name == defaultAction)
    if (!action) throw new Error(`default action "${defaultAction}" not found`)
    return action
  }

  public async hide(): Promise<void> {
    if (this.hidden) return
    if (this.uiTokenSource) {
      this.uiTokenSource.cancel()
      this.uiTokenSource.dispose()
      this.uiTokenSource = null
    }
    let { nvim, interval } = this
    if (interval) clearInterval(interval)
    this.hidden = true
    this.worker.stop()
    this.history.add()
    let { winid } = this.ui
    this.ui.reset()
    await nvim.call('coc#list#hide', [this.window.id, this.savedHeight, winid])
    if (workspace.isVim) {
      // Needed for tabe action, don't know why.
      await wait(10)
    }
    nvim.call('coc#prompt#stop_prompt', ['list'], true)
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

  private async resolveItem(): Promise<void> {
    let index = this.ui.index
    let item = this.ui.getItem(0)
    if (!item || item.resolved) return
    let { list } = this
    if (typeof list.resolveItem == 'function') {
      let resolved = await Promise.resolve(list.resolveItem(item))
      if (resolved && index == this.ui.index) {
        await this.ui.updateItem(resolved, index)
      }
    }
  }

  public async showHelp(): Promise<void> {
    await this.hide()
    let { list, nvim } = this
    if (!list) return
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
      let props = {}
      extensions.all.forEach(extension => {
        let { packageJSON } = extension
        let { contributes } = packageJSON
        if (!contributes) return
        let { configuration } = contributes
        if (configuration) {
          let { properties } = configuration
          if (properties) {
            for (let key of Object.keys(properties)) {
              props[key] = properties[key]
            }
          }
        }
      })
      for (let key of Object.keys(config)) {
        let val = config[key]
        let name = `list.source.${list.name}.${key}`
        let description = props[name] && props[name].description ? props[name].description : key
        highligher.addLine(`  "${name}"`, 'MoreMsg')
        highligher.addText(` - ${description}, current value: `)
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

  public switchMatcher(): void {
    let { matcher, interactive } = this.listOptions
    if (interactive) return
    const list: Matcher[] = ['fuzzy', 'strict', 'regex']
    let idx = list.indexOf(matcher) + 1
    if (idx >= list.length) idx = 0
    this.listOptions.matcher = list[idx]
    this.prompt.matcher = list[idx]
    this.worker.drawItems()
  }

  public updateStatus(): void {
    let { ui, list, nvim } = this
    if (!ui.winid) return
    let buf = nvim.createBuffer(ui.bufnr)
    let status = {
      mode: this.prompt.mode.toUpperCase(),
      args: this.args.join(' '),
      name: list.name,
      cwd: this.cwd,
      loading: this.loadingFrame,
      total: this.worker.length
    }
    nvim.pauseNotification()
    buf.setVar('list_status', status, true)
    nvim.command('redraws', true)
    nvim.resumeNotification(false, true).logError()
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

  public redrawItems(): void {
    this.worker.drawItems()
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
        this.ui.setCursor(Number(ch), 0)
        await this.nvim.resumeNotification()
        await this.doAction()
      }
      return true
    }
    return false
  }

  public jumpBack(): void {
    let { window, nvim } = this
    if (window) {
      nvim.pauseNotification()
      nvim.call('coc#prompt#stop_prompt', ['list'], true)
      this.nvim.call('win_gotoid', [window.id], true)
      nvim.resumeNotification(false, true).logError()
    }
  }

  public async resume(): Promise<void> {
    if (this.winid) await this.hide()
    let res = await this.nvim.eval('[win_getid(),bufnr("%"),winheight("%")]')
    this.hidden = false
    this.window = this.nvim.createWindow(res[0])
    this.buffer = this.nvim.createBuffer(res[1])
    this.savedHeight = res[2]
    this.prompt.start()
    await this.ui.resume()
    if (this.listOptions.autoPreview) {
      await this.doAction('preview')
    }
  }

  private async doItemAction(items: ListItem[], action: ListAction): Promise<void> {
    let { noQuit } = this.listOptions
    let { nvim } = this
    let persist = this.winid && (action.persist === true || action.name == 'preview')
    noQuit = noQuit && this.winid != null
    try {
      if (!persist) {
        if (noQuit) {
          nvim.pauseNotification()
          nvim.call('coc#prompt#stop_prompt', ['list'], true)
          nvim.call('win_gotoid', [this.context.window.id], true)
          await nvim.resumeNotification()
        } else {
          await this.hide()
        }
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
      if (persist) {
        this.ui.restoreWindow()
        if (action.reload) await this.worker.loadItems(this.context, true)
      } else if (noQuit) {
        if (action.reload) await this.worker.loadItems(this.context, true)
      }
    } catch (e) {
      console.error(e)
    }
  }

  public onInputChange(): void {
    if (this.timer) clearTimeout(this.timer)
    let len = this.worker.length
    this.listOptions.input = this.prompt.input
    // reload or filter items
    if (this.listOptions.interactive) {
      this.worker.stop()
      this.timer = setTimeout(async () => {
        await this.worker.loadItems(this.context)
      }, this.interactiveDebounceTime)
    } else if (len) {
      let wait = Math.max(Math.min(Math.floor(len / 200), 300), 50)
      this.timer = setTimeout(() => {
        this.worker.drawItems()
      }, wait)
    }
  }

  public dispose(): void {
    if (this.interval) {
      clearInterval(this.interval)
    }
    if (this.timer) {
      clearTimeout(this.timer)
    }
    disposeAll(this.disposables)
    this.worker.dispose()
    this.ui.dispose()
  }
}
