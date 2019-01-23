import { Neovim, Window } from '@chemzqm/neovim'
import debounce from 'debounce'
import { Disposable } from 'vscode-languageserver-protocol'
import events from '../events'
import { IList, ListAction, ListContext, ListItem, ListOptions, Matcher, WorkspaceConfiguration } from '../types'
import workspace from '../workspace'
import History from './history'
import Mappings from './mappings'
import Prompt from './prompt'
import CommandsList from './source/commands'
import DiagnosticsList from './source/diagnostics'
import ExtensionList from './source/extensions'
import LinksList from './source/links'
import ListsList from './source/lists'
import LocationList from './source/location'
import OutlineList from './source/outline'
import OutputList from './source/output'
import ServicesList from './source/services'
import SourcesList from './source/sources'
import SymbolsList from './source/symbols'
import UI from './ui'
import Worker from './worker'
const logger = require('../util/logger')('list-manager')

const mouseKeys = ['<LeftMouse>', '<LeftDrag>', '<LeftRelease>', '<2-LeftMouse>']

export class ListManager {
  public prompt: Prompt
  public ui: UI
  public history: History
  public listOptions: ListOptions
  public config: WorkspaceConfiguration
  public worker: Worker
  private disposables: Disposable[] = []
  private args: string[] = []
  private listArgs: string[] = []
  private charMap: Map<string, string> = new Map()
  private listMap: Map<string, IList> = new Map()
  private mappings: Mappings
  private currList: IList
  private cwd: string
  private window: Window
  private activated = false
  private executing = false
  private nvim: Neovim

  public async init(nvim: Neovim): Promise<void> {
    this.nvim = nvim
    this.config = workspace.getConfiguration('list')
    this.prompt = new Prompt(nvim)
    this.history = new History(this)
    this.mappings = new Mappings(this, nvim, this.config)
    this.worker = new Worker(nvim, this)
    this.ui = new UI(nvim, this.config)
    let chars = await this.nvim.call('coc#list#get_chars')
    Object.keys(chars).forEach(key => {
      this.charMap.set(chars[key], key)
    })
    events.on('VimResized', () => {
      if (this.isActivated) nvim.command('redraw!')
    }, null, this.disposables)
    events.on('InputChar', this.onInputChar, this, this.disposables)
    events.on('FocusGained', debounce(async () => {
      if (this.activated) this.prompt.drawPrompt()
    }, 100), null, this.disposables)
    events.on('BufEnter', debounce(async () => {
      let { bufnr } = this.ui
      if (!bufnr) return
      if (!this.activated) {
        this.ui.hide()
        return
      }
      if (workspace.bufnr == bufnr) {
        this.prompt.start()
      } else {
        this.prompt.cancel()
      }
    }, 200), null, this.disposables)
    this.ui.onDidChangeLine(async () => {
      let autoPreview = this.config.get<boolean>('autoPreview', true)
      if (!autoPreview || !this.activated) return
      let previewing = await nvim.call('coc#util#has_preview')
      if (previewing) await this.doAction('preview')
    }, null, this.disposables)
    this.ui.onDidLineChange(async () => {
      let { autoPreview } = this.listOptions
      if (!autoPreview || !this.activated) return
      await this.doAction('preview')
    }, null, this.disposables)
    this.ui.onDidOpen(async () => {
      if (this.currList) {
        this.currList.doHighlight()
        nvim.command(`setl statusline=${this.buildStatusline()}`, true)
      }
    }, null, this.disposables)
    this.ui.onDidClose(async () => {
      await this.cancel()
    }, null, this.disposables)
    this.ui.onDidChange(async () => {
      if (this.activated) {
        this.updateStatus()
        if (workspace.isNvim) {
          this.prompt.drawPrompt()
        }
      }
    }, null, this.disposables)
    this.ui.onDidDoubleClick(async () => {
      await this.doAction()
    }, null, this.disposables)
    this.worker.onDidChangeItems(async ({ items, highlights, reload, append }) => {
      if (!this.activated) return
      if (append) {
        this.ui.addHighlights(highlights, true)
        this.ui.appendItems(items)
      } else {
        this.ui.addHighlights(highlights)
        this.ui.drawItems(items, this.name, this.listOptions.position, reload)
      }
    })
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('list')) {
        this.config = workspace.getConfiguration('list')
      }
    }, null, this.disposables)
    await this.defineHighlights()

    this.registerList(new LinksList(nvim))
    this.registerList(new LocationList(nvim))
    this.registerList(new SymbolsList(nvim))
    this.registerList(new OutlineList(nvim))
    this.registerList(new CommandsList(nvim))
    this.registerList(new ExtensionList(nvim))
    this.registerList(new DiagnosticsList(nvim))
    this.registerList(new SourcesList(nvim))
    this.registerList(new ServicesList(nvim))
    this.registerList(new OutputList(nvim))
    this.registerList(new ListsList(nvim, this.listMap))
  }

  public async defineHighlights(): Promise<void> {
    let { nvim } = this
    let map = await nvim.call('coc#list#get_colors')
    nvim.pauseNotification()
    for (let key of Object.keys(map)) {
      let foreground = key[0].toUpperCase() + key.slice(1)
      let foregroundColor = map[key]
      for (let key of Object.keys(map)) {
        let background = key[0].toUpperCase() + key.slice(1)
        let backgroundColor = map[key]
        nvim.command(`hi default CocList${foreground}${background} guifg=${foregroundColor} guibg=${backgroundColor}`, true)
      }
      nvim.command(`hi default CocListFg${foreground} guifg=${foregroundColor}`, true)
      nvim.command(`hi default CocListBg${foreground} guibg=${foregroundColor}`, true)
    }
    await nvim.resumeNotification()
  }

  public async start(args: string[]): Promise<void> {
    if (this.activated) return
    let res = this.parseArgs(args)
    if (!res) return
    this.activated = true
    this.args = args
    try {
      let { list, options, listArgs } = res
      this.reset()
      this.listOptions = options
      this.currList = list
      if (!list.interactive) this.listOptions.interactive = false
      this.listArgs = listArgs
      this.cwd = workspace.cwd
      this.window = await this.nvim.window
      this.prompt.start(this.listOptions.input, options.mode)
      this.history.load()
      await this.worker.loadItems()
    } catch (e) {
      await this.cancel()
      workspace.showMessage(e.message, 'error')
      logger.error(e)
    }
  }

  public async resume(): Promise<void> {
    let { name, ui, currList } = this
    if (!currList) return
    this.activated = true
    this.prompt.start()
    await ui.resume(name, this.listOptions.position)
  }

  public async doAction(name?: string): Promise<void> {
    let { currList } = this
    name = name || currList.defaultAction
    let action = currList.actions.find(o => o.name == name)
    if (!action) {
      workspace.showMessage(`Action ${name} not found`, 'error')
      return
    }
    let items = await this.ui.getItems()
    if (items.length) await this.doItemAction(items, action)
  }

  private async doItemAction(items: ListItem[], action: ListAction): Promise<void> {
    if (this.executing) return
    this.executing = true
    let { nvim, ui } = this
    try {
      if (action.persist !== true && action.name != 'preview') {
        await this.cancel()
      }
      if (action.name == 'preview') {
        items = items.slice(0, 1)
      }
      if (action.parallel) {
        await Promise.all(items.map(item => {
          return Promise.resolve(action.execute(item, this.context))
        }))
      } else {
        for (let item of items) {
          await Promise.resolve(action.execute(item, this.context))
        }
      }
      if (action.persist || action.name == 'preview') {
        let { bufnr } = ui
        let winnr = bufnr ? await nvim.call('bufwinnr', bufnr) : -1
        if (winnr == -1) return
        nvim.pauseNotification()
        this.nvim.command(`${winnr}wincmd w`, true)
        this.ui.restoreWindow()
        await nvim.resumeNotification()
        if (action.reload) await this.worker.loadItems(true)
      }
    } catch (e) {
      logger.error(e)
    }
    this.executing = false
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

  public async cancel(close = true): Promise<void> {
    let { nvim, ui } = this
    if (!this.activated) {
      nvim.call('coc#list#stop_prompt', [], true)
      return
    }
    this.activated = false
    this.worker.stop()
    this.history.add()
    nvim.pauseNotification()
    if (this.window) {
      let valid = await this.window.valid
      if (valid) nvim.call('win_gotoid', this.window.id, true)
    }
    this.prompt.cancel()
    nvim.command('pclose', true)
    nvim.command('echo ""', true)
    if (close) ui.hide()
    nvim.command('redraw', true)
    nvim.call('coc#list#restore', [], true)
    await nvim.resumeNotification()
  }

  public async togglePreview(): Promise<void> {
    let autoPreview = this.config.get<boolean>('autoPreview', true)
    if (!autoPreview) {
      await this.doAction('preview')
    } else {
      let { nvim } = this
      let has = await nvim.call('coc#list#has_preview')
      if (has) {
        await nvim.command('pclose')
        await nvim.command('redraw')
      } else {
        await this.doAction('preview')
      }
    }
  }

  public async chooseAction(): Promise<void> {
    let { nvim, currList } = this
    if (!this.activated) return
    let { actions, defaultAction } = currList
    let names: string[] = actions.map(o => o.name)
    let idx = names.indexOf(defaultAction)
    if (idx != -1) {
      names.splice(idx, 1)
      names.unshift(defaultAction)
    }
    let shortcuts: Set<string> = new Set()
    let choices: string[] = []
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
    }
    await nvim.call('coc#list#stop_prompt')
    let n = await nvim.call('confirm', ['Choose action:', choices.join('\n')]) as number
    nvim.pauseNotification()
    await nvim.resumeNotification()
    await this.prompt.start()
    if (n) await this.doAction(names[n - 1])
  }

  public get name(): string {
    let { currList } = this
    return currList ? currList.name : 'anonymous'
  }

  public get list(): IList {
    return this.currList
  }

  private get defaultAction(): ListAction {
    let { currList } = this
    let { defaultAction } = currList
    return currList.actions.find(o => o.name == defaultAction)
  }

  private parseArgs(args: string[]): { list: IList, options: ListOptions, listArgs: string[] } | null {
    let options: string[] = []
    let interactive = false
    let autoPreview = false
    let numberSelect = false
    let name: string
    let listArgs: string[] = []
    let input = ''
    let matcher: Matcher = 'fuzzy'
    for (let arg of args) {
      if (!name && arg.startsWith('-')) {
        if (arg.startsWith('--input')) {
          input = arg.slice(8)
        } else if (arg == '--number-select' || arg == '-N') {
          numberSelect = true
        } else if (arg == '--auto-preview' || arg == '-A') {
          autoPreview = true
        } else if (arg == '--regex' || arg == '-R') {
          matcher = 'regex'
        } else if (arg == '--strictMatch' || arg == '-S') {
          matcher = 'strict'
        } else if (arg == '--interactive' || arg == '-I') {
          interactive = true
        } else {
          options.push(arg.slice(2))
        }
      } else if (!name) {
        name = arg
      } else {
        listArgs.push(arg)
      }
    }
    if (!name) name = 'lists'
    let list = this.listMap.get(name)
    if (!list) {
      workspace.showMessage(`List ${name} not found`, 'error')
      return null
    }
    return {
      list,
      listArgs,
      options: {
        numberSelect,
        autoPreview,
        input,
        interactive,
        matcher,
        ignorecase: options.indexOf('ignore-case') != -1 ? true : false,
        position: options.indexOf('top') == -1 ? 'bottom' : 'top',
        mode: options.indexOf('normal') == -1 ? 'insert' : 'normal',
        sort: options.indexOf('no-sort') == -1 ? true : false
      },
    }
  }

  public updateStatus(): void {
    let { ui, currList, listArgs, activated, nvim } = this
    if (!activated) return
    let buf = nvim.createBuffer(ui.bufnr)
    let status = {
      mode: this.prompt.mode.toUpperCase(),
      args: listArgs.join(' '),
      name: currList.name,
      total: this.worker.length,
      cwd: this.cwd,
    }
    nvim.pauseNotification()
    buf.setVar('list_status', status, true)
    if (ui.window) nvim.command('redraws', true)
    nvim.resumeNotification()
  }

  private buildStatusline(): string {
    let { args } = this
    let parts: string[] = [
      `%#CocListMode#-- %{coc#list#status('mode')} --%*`,
      `%{get(g:, 'coc_list_loading_status', '')}`,
      args.join(' '),
      `\\(%L/%{coc#list#status('total')}\\)`,
      '%=',
      `%#CocListPath# %{coc#list#status('cwd')} %l/%L%*`
    ]
    return parts.join(' ').replace(/\s/g, '\\ ')
  }

  private async onInputChar(ch: string, charmod: number): Promise<void> {
    let { mode } = this.prompt
    if (!ch) return
    if (!this.activated) {
      this.nvim.call('coc#list#stop_prompt', [], true)
      return
    }
    if (mode == 'insert') {
      await this.onInsertInput(ch, charmod)
    } else {
      await this.onNormalInput(ch, charmod)
    }
  }

  private async onInsertInput(ch: string, charmod: number): Promise<void> {
    let inserted = this.charMap.get(ch) || ch
    if (mouseKeys.indexOf(inserted) !== -1) {
      await this.onMouseEvent(inserted)
      return
    }
    if (this.listOptions.numberSelect) {
      let code = ch.charCodeAt(0)
      if (code >= 49 && code <= 57) {
        let n = Number(ch)
        if (this.ui.length >= n) {
          await this.ui.setCursor(Number(ch), 0)
          await this.doAction()
        }
        return
      }
    }
    let done = await this.mappings.doInsertKeymap(inserted)
    if (done || charmod || this.charMap.has(ch)) return
    for (let s of ch) {
      let code = s.codePointAt(0)
      if (code == 65533) return
      // exclude control characer
      if (code < 33 || code >= 127 && code <= 159) return
      this.prompt.insertCharacter(s)
    }
  }

  private async onNormalInput(ch: string, _charmod: number): Promise<void> {
    let inserted = this.charMap.get(ch) || ch
    if (mouseKeys.indexOf(inserted) !== -1) {
      await this.onMouseEvent(inserted)
      return
    }
    let done = await this.mappings.doNormalKeymap(inserted)
    if (!done) await this.feedkeys(inserted)
  }

  private onMouseEvent(key): Promise<void> {
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

  public async feedkeys(key: string): Promise<void> {
    let { nvim } = this
    key = key.startsWith('<') && key.endsWith('>') ? `\\${key}` : key
    await nvim.call('coc#list#stop_prompt', [])
    await nvim.eval(`feedkeys("${key}")`)
    this.prompt.start()
  }

  public async normal(command: string, bang = true): Promise<void> {
    let { nvim } = this
    await nvim.call('coc#list#stop_prompt', [])
    await nvim.command(`normal${bang ? '!' : ''} ${command}`)
    this.prompt.start()
  }

  public async call(fname: string): Promise<any> {
    if (!this.currList || !this.window) return
    await this.nvim.call('coc#list#stop_prompt', [])
    let buf = await this.window.buffer
    let targets = await this.ui.getItems()
    let context = {
      name: this.currList.name,
      args: this.listArgs,
      input: this.prompt.input,
      winid: this.window.id,
      bufnr: buf.id,
      targets
    }
    let res = await this.nvim.call(fname, [context])
    this.prompt.start()
    return res
  }

  public get context(): ListContext {
    return {
      options: this.listOptions,
      args: this.listArgs,
      input: this.prompt.input,
      window: this.window,
      listWindow: this.ui.window,
      cwd: this.cwd
    }
  }

  public registerList(list: IList): Disposable {
    if (this.listMap.has(list.name)) {
      workspace.showMessage(`list ${list.name} already exists.`)
      return Disposable.create(() => {
        // noop
      })
    }
    this.listMap.set(list.name, list)
    return Disposable.create(() => {
      this.listMap.delete(list.name)
    })
  }

  public get names(): string[] {
    return Array.from(this.listMap.keys())
  }

  public toggleMode(): void {
    let { mode } = this.prompt
    this.prompt.mode = mode == 'normal' ? 'insert' : 'normal'
    this.updateStatus()
  }

  public getConfig<T>(key: string, defaultValue: T): T {
    return this.config.get<T>(key, defaultValue)
  }

  public get isActivated(): boolean {
    return this.activated
  }

  public stop(): void {
    this.worker.stop()
  }

  public reset(): void {
    this.window = null
    this.listOptions = null
    this.prompt.reset()
    this.worker.stop()
    this.ui.reset()
  }
}

export default new ListManager()
