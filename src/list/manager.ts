import { Neovim, Window } from '@chemzqm/neovim'
import debounce from 'debounce'
import { Disposable } from 'vscode-languageserver-protocol'
import events from '../events'
import extensions from '../extensions'
import { IList, ListAction, ListContext, ListItem, ListOptions, Matcher } from '../types'
import { disposeAll, wait } from '../util'
import workspace from '../workspace'
import Highlighter from '../model/highligher'
import ListConfiguration from './configuration'
import History from './history'
import Mappings from './mappings'
import Prompt from './prompt'
import CommandsList from './source/commands'
import DiagnosticsList from './source/diagnostics'
import ExtensionList from './source/extensions'
import FolderList from './source/folders'
import LinksList from './source/links'
import ListsList from './source/lists'
import LocationList from './source/location'
import OutlineList from './source/outline'
import OutputList from './source/output'
import ServicesList from './source/services'
import SourcesList from './source/sources'
import SymbolsList from './source/symbols'
import ActionsList from './source/actions'
import UI from './ui'
import Worker from './worker'
const logger = require('../util/logger')('list-manager')

const mouseKeys = ['<LeftMouse>', '<LeftDrag>', '<LeftRelease>', '<2-LeftMouse>']

export class ListManager implements Disposable {
  public prompt: Prompt
  public ui: UI
  public history: History
  public listOptions: ListOptions
  public config: ListConfiguration
  public worker: Worker
  private plugTs = 0
  private disposables: Disposable[] = []
  private savedHeight: number
  private args: string[] = []
  private listArgs: string[] = []
  private charMap: Map<string, string>
  private listMap: Map<string, IList> = new Map()
  private mappings: Mappings
  private currList: IList
  private cwd: string
  private window: Window
  private activated = false
  private executing = false
  private nvim: Neovim

  public init(nvim: Neovim): void {
    this.nvim = nvim
    this.config = new ListConfiguration()
    this.prompt = new Prompt(nvim, this.config)
    this.history = new History(this)
    this.mappings = new Mappings(this, nvim, this.config)
    this.worker = new Worker(nvim, this)
    this.ui = new UI(nvim, this.config)
    events.on('VimResized', () => {
      if (this.isActivated) nvim.command('redraw!', true)
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
      let curr = await nvim.call('bufnr', '%')
      if (curr == bufnr) {
        this.prompt.start()
      } else {
        nvim.pauseNotification()
        this.prompt.cancel()
        await nvim.resumeNotification()
      }
    }, 100), null, this.disposables)
    this.ui.onDidChangeLine(debounce(async () => {
      if (!this.activated) return
      let previewing = await nvim.call('coc#util#has_preview')
      let mode = await this.nvim.mode
      if (mode.blocking || mode.mode != 'n') return
      if (previewing) await this.doAction('preview')
    }, 100), null, this.disposables)
    this.ui.onDidLineChange(debounce(async () => {
      let { autoPreview } = this.listOptions
      if (!autoPreview || !this.activated) return
      await this.doAction('preview')
    }, 100), null, this.disposables)
    this.ui.onDidChangeLine(this.resolveItem, this, this.disposables)
    this.ui.onDidLineChange(this.resolveItem, this, this.disposables)
    this.ui.onDidOpen(() => {
      if (this.currList) {
        if (typeof this.currList.doHighlight == 'function') {
          this.currList.doHighlight()
        }
      }
    }, null, this.disposables)
    this.ui.onDidClose(async () => {
      await this.cancel()
    }, null, this.disposables)
    this.ui.onDidChange(async () => {
      if (this.activated) {
        this.updateStatus()
      }
      this.prompt.drawPrompt()
    }, null, this.disposables)
    this.ui.onDidDoubleClick(async () => {
      await this.doAction()
    }, null, this.disposables)
    this.worker.onDidChangeItems(async ({ items, highlights, reload, append }) => {
      if (!this.activated) return
      if (append) {
        this.ui.addHighlights(highlights, true)
        await this.ui.appendItems(items)
      } else {
        this.ui.addHighlights(highlights)
        await this.ui.drawItems(items, this.name, this.listOptions, reload)
      }
    }, null, this.disposables)

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
    this.registerList(new FolderList(nvim))
    this.registerList(new ActionsList(nvim))
  }

  public async start(args: string[]): Promise<void> {
    if (this.activated) return
    let res = this.parseArgs(args)
    if (!res) return
    this.args = args
    this.activated = true
    let { list, options, listArgs } = res
    try {
      this.reset()
      this.listOptions = options
      this.currList = list
      this.listArgs = listArgs
      this.cwd = workspace.cwd
      await this.getCharMap()
      this.history.load()
      this.window = await this.nvim.window
      this.savedHeight = await this.window.height
      this.prompt.start(options)
      await this.worker.loadItems()
    } catch (e) {
      await this.cancel()
      let msg = e instanceof Error ? e.message : e.toString()
      workspace.showMessage(`Error on "CocList ${list.name}": ${msg}`, 'error')
      logger.error(e)
    }
  }

  public async resume(): Promise<void> {
    let { name, ui, currList, nvim } = this
    if (!currList) return
    this.activated = true
    this.window = await nvim.window
    this.prompt.start()
    await ui.resume(name, this.listOptions)
    if (this.listOptions.autoPreview) {
      await this.doAction('preview')
    }
  }

  public async doAction(name?: string): Promise<void> {
    let { currList } = this
    name = name || currList.defaultAction
    let action = currList.actions.find(o => o.name == name)
    if (!action) {
      workspace.showMessage(`Action ${name} not found`, 'error')
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
    let { nvim, ui, savedHeight } = this
    if (!this.activated) {
      nvim.call('coc#list#stop_prompt', [], true)
      return
    }
    this.activated = false
    this.worker.stop()
    this.history.add()
    nvim.pauseNotification()
    nvim.command('pclose', true)
    this.prompt.cancel()
    if (close) {
      ui.hide()
      if (this.window) {
        nvim.call('coc#list#restore', [this.window.id, savedHeight], true)
      }
    }
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

  public async togglePreview(): Promise<void> {
    let { nvim } = this
    let has = await nvim.call('coc#list#has_preview')
    if (has) {
      await nvim.command('pclose')
      await nvim.command('redraw')
    } else {
      await this.doAction('preview')
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
    await wait(10)
    this.prompt.start()
    if (n) await this.doAction(names[n - 1])
  }

  public get name(): string {
    let { currList } = this
    return currList ? currList.name : 'anonymous'
  }

  public get list(): IList {
    return this.currList
  }

  public parseArgs(args: string[]): { list: IList, options: ListOptions, listArgs: string[] } | null {
    let options: string[] = []
    let interactive = false
    let autoPreview = false
    let numberSelect = false
    let name: string
    let input = ''
    let matcher: Matcher = 'fuzzy'
    let position = 'bottom'
    let listArgs: string[] = []
    let listOptions: string[] = []
    for (let arg of args) {
      if (!name && arg.startsWith('-')) {
        listOptions.push(arg)
      } else if (!name) {
        if (!/^\w+$/.test(arg)) {
          workspace.showMessage(`Invalid list option: "${arg}"`, 'error')
          return null
        }
        name = arg
      } else {
        listArgs.push(arg)
      }
    }
    name = name || 'lists'
    let config = workspace.getConfiguration(`list.source.${name}`)
    if (!listOptions.length && !listArgs.length) listOptions = config.get<string[]>('defaultOptions', [])
    if (!listArgs.length) listArgs = config.get<string[]>('defaultArgs', [])
    for (let opt of listOptions) {
      if (opt.startsWith('--input')) {
        input = opt.slice(8)
      } else if (opt == '--number-select' || opt == '-N') {
        numberSelect = true
      } else if (opt == '--auto-preview' || opt == '-A') {
        autoPreview = true
      } else if (opt == '--regex' || opt == '-R') {
        matcher = 'regex'
      } else if (opt == '--strict' || opt == '-S') {
        matcher = 'strict'
      } else if (opt == '--interactive' || opt == '-I') {
        interactive = true
      } else if (opt == '--top') {
        position = 'top'
      } else if (opt == '--tab') {
        position = 'tab'
      } else if (opt == '--ignore-case' || opt == '--normal' || opt == '--no-sort') {
        options.push(opt.slice(2))
      } else {
        workspace.showMessage(`Invalid option "${opt}" of list`, 'error')
        return null
      }
    }
    let list = this.listMap.get(name)
    if (!list) {
      workspace.showMessage(`List ${name} not found`, 'error')
      return null
    }
    if (interactive && !list.interactive) {
      workspace.showMessage(`Interactive mode of "${name}" list not supported`, 'error')
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
        position,
        ignorecase: options.indexOf('ignore-case') != -1 ? true : false,
        mode: options.indexOf('normal') == -1 ? 'insert' : 'normal',
        sort: options.indexOf('no-sort') == -1 ? true : false
      },
    }
  }

  public updateStatus(): void {
    let { ui, currList, activated, nvim } = this
    if (!activated) return
    let buf = nvim.createBuffer(ui.bufnr)
    let status = {
      mode: this.prompt.mode.toUpperCase(),
      args: this.args.join(' '),
      name: currList.name,
      total: this.worker.length,
      cwd: this.cwd,
    }
    buf.setVar('list_status', status, true)
    if (ui.window) nvim.command('redraws', true)
  }

  private async onInputChar(ch: string, charmod: number): Promise<void> {
    let { mode } = this.prompt
    let mapped = this.charMap.get(ch)
    let now = Date.now()
    if (mapped == '<plug>' || now - this.plugTs < 2) {
      this.plugTs = now
      return
    }
    if (!ch) return
    if (ch == '\x1b') {
      await this.cancel()
      return
    }
    if (!this.activated) {
      this.nvim.call('coc#list#stop_prompt', [], true)
      return
    }
    try {
      if (mode == 'insert') {
        await this.onInsertInput(ch, charmod)
      } else {
        await this.onNormalInput(ch, charmod)
      }
    } catch (e) {
      workspace.showMessage(`Error on input ${ch}: ${e}`)
      logger.error(e)
    }
  }

  private async onInsertInput(ch: string, charmod: number): Promise<void> {
    let { nvim } = this
    let inserted = this.charMap.get(ch) || ch
    if (mouseKeys.indexOf(inserted) !== -1) {
      await this.onMouseEvent(inserted)
      return
    }
    if (this.listOptions.numberSelect) {
      let code = ch.charCodeAt(0)
      if (code >= 48 && code <= 57) {
        let n = Number(ch)
        if (n == 0) n = 10
        if (this.ui.length >= n) {
          nvim.pauseNotification()
          this.ui.setCursor(Number(ch), 0)
          await nvim.resumeNotification()
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
      if (code < 32 || code >= 127 && code <= 159) return
      await this.prompt.acceptCharacter(s)
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

  public async feedkeys(key: string, remap = true): Promise<void> {
    let { nvim } = this
    key = key.startsWith('<') && key.endsWith('>') ? `\\${key}` : key
    await nvim.call('coc#list#stop_prompt', [1])
    await nvim.call('eval', [`feedkeys("${key}", "${remap ? 'i' : 'in'}")`])
    this.prompt.start()
  }

  public async command(command: string): Promise<void> {
    let { nvim } = this
    await nvim.call('coc#list#stop_prompt', [1])
    await nvim.command(command)
    this.prompt.start()
  }

  public async normal(command: string, bang = true): Promise<void> {
    let { nvim } = this
    await nvim.call('coc#list#stop_prompt', [1])
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

  public async showHelp(): Promise<void> {
    // echo help
    await this.cancel()
    let { list, nvim } = this
    if (!list) return
    let previewHeight = await nvim.eval('&previewheight')
    nvim.pauseNotification()
    nvim.command(`belowright ${previewHeight}sp +setl\\ previewwindow [LIST HELP]`, true)
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
    nvim.command('nnoremap q :bd!<CR>', true)
    await nvim.resumeNotification()
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
    const { name } = list
    let exists = this.listMap.get(name)
    if (this.listMap.has(name)) {
      if (exists) {
        if (typeof exists.dispose == 'function') {
          exists.dispose()
        }
        this.listMap.delete(name)
      }
      workspace.showMessage(`list "${name}" recreated.`)
    }
    this.listMap.set(name, list)
    extensions.addSchemeProperty(`list.source.${name}.defaultOptions`, {
      type: 'array',
      default: list.interactive ? ['--interactive'] : [],
      description: `Default list options of "${name}" list, only used when both list option and argument are empty.`,
      uniqueItems: true,
      items: {
        type: 'string',
        enum: ['--top', '--normal', '--no-sort', '--input', '--tab',
          '--strict', '--regex', '--ignore-case', '--number-select',
          '--interactive', '--auto-preview']
      }
    })
    extensions.addSchemeProperty(`list.source.${name}.defaultArgs`, {
      type: 'array',
      default: [],
      description: `Default argument list of "${name}" list, only used when list argument is empty.`,
      uniqueItems: true,
      items: { type: 'string' }
    })
    return Disposable.create(() => {
      if (typeof list.dispose == 'function') {
        list.dispose()
      }
      this.listMap.delete(name)
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

  public dispose(): void {
    if (this.config) {
      this.config.dispose()
    }
    disposeAll(this.disposables)
  }

  private async getCharMap(): Promise<void> {
    if (this.charMap) return
    this.charMap = new Map()
    let chars = await this.nvim.call('coc#list#get_chars')
    Object.keys(chars).forEach(key => {
      this.charMap.set(chars[key], key)
    })
    return
  }

  private async doItemAction(items: ListItem[], action: ListAction): Promise<void> {
    if (this.executing) return
    this.executing = true
    let { nvim } = this
    let shouldCancel = action.persist !== true && action.name != 'preview'
    try {
      if (shouldCancel) {
        await this.cancel()
      } else if (action.name != 'preview') {
        await nvim.call('coc#list#stop_prompt')
      }
      if (!shouldCancel && !this.isActivated) return
      if (action.multiple) {
        await Promise.resolve(action.execute(items, this.context))
      } else if (action.parallel) {
        await Promise.all(items.map(item => {
          return Promise.resolve(action.execute(item, this.context))
        }))
      } else {
        for (let item of items) {
          await Promise.resolve(action.execute(item, this.context))
        }
      }
      if (!shouldCancel) {
        if (!this.isActivated) {
          this.nvim.command('pclose', true)
          return
        }
        nvim.pauseNotification()
        if (action.name != 'preview') {
          this.prompt.start()
        }
        this.ui.restoreWindow()
        nvim.resumeNotification(false, true).logError()
        if (action.reload) await this.worker.loadItems(true)
      }
    } catch (e) {
      // tslint:disable-next-line: no-console
      console.error(e)
      if (!shouldCancel && this.activated) {
        this.prompt.start()
      }
    }
    this.executing = false
  }

  private async resolveItem(): Promise<void> {
    if (!this.activated) return
    let index = this.ui.index
    let item = this.ui.getItem(0)
    if (!item || item.resolved) return
    let { list } = this
    if (typeof list.resolveItem == 'function') {
      let resolved = await list.resolveItem(item)
      if (resolved && index == this.ui.index) {
        await this.ui.updateItem(resolved, index)
      }
    }
  }

  private get defaultAction(): ListAction {
    let { currList } = this
    let { defaultAction } = currList
    return currList.actions.find(o => o.name == defaultAction)
  }
}

export default new ListManager()
