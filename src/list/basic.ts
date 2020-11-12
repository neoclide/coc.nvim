import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import readline from 'readline'
import { CancellationToken, Position, Disposable, Location, Range } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { ProviderResult } from '../provider'
import { IList, ListAction, ListContext, ListItem, ListTask, LocationWithLine, WorkspaceConfiguration, ListArgument, PreiewOptions } from '../types'
import { disposeAll } from '../util'
import { readFileLines } from '../util/fs'
import { comparePosition } from '../util/position'
import workspace from '../workspace'
import ListConfiguration from './configuration'
const logger = require('../util/logger')('list-basic')

interface ActionOptions {
  persist?: boolean
  reload?: boolean
  parallel?: boolean
}

interface ArgumentItem {
  hasValue: boolean
  name: string
}

interface PreviewConfig {
  position: string
  hlGroup: string
  maxHeight: number
  name?: string
  splitRight: boolean
  lnum: number
  filetype?: string
  range?: Range
}

export default abstract class BasicList implements IList, Disposable {
  public name: string
  public defaultAction = 'open'
  public readonly actions: ListAction[] = []
  public options: ListArgument[] = []
  protected disposables: Disposable[] = []
  private optionMap: Map<string, ArgumentItem>
  public config: ListConfiguration

  constructor(protected nvim: Neovim) {
    this.config = new ListConfiguration()
  }

  protected get hlGroup(): string {
    return this.config.get('previewHighlightGroup', 'Search')
  }

  protected get previewHeight(): number {
    return this.config.get('maxPreviewHeight', 12)
  }

  protected get splitRight(): boolean {
    return this.config.get('previewSplitRight', false)
  }

  public parseArguments(args: string[]): { [key: string]: string | boolean } {
    if (!this.optionMap) {
      this.optionMap = new Map()
      for (let opt of this.options) {
        let parts = opt.name.split(/,\s*/g).map(s => s.replace(/\s+.*/g, ''))
        let name = opt.key ? opt.key : parts[parts.length - 1].replace(/^-/, '')
        for (let p of parts) {
          this.optionMap.set(p, { name, hasValue: opt.hasValue })
        }
      }
    }
    let res: { [key: string]: string | boolean } = {}
    for (let i = 0; i < args.length; i++) {
      let arg = args[i]
      let def = this.optionMap.get(arg)
      if (!def) {
        logger.error(`Option "${arg}" of "${this.name}" not found`)
        continue
      }
      let value: string | boolean = true
      if (def.hasValue) {
        value = args[i + 1] || ''
        i = i + 1
      }
      res[def.name] = value
    }
    return res
  }

  /**
   * Get configuration of current list
   */
  protected getConfig(): WorkspaceConfiguration {
    return workspace.getConfiguration(`list.source.${this.name}`)
  }

  protected addAction(name: string, fn: (item: ListItem, context: ListContext) => ProviderResult<void>, options?: ActionOptions): void {
    this.createAction(Object.assign({
      name,
      execute: fn
    }, options || {}))
  }

  protected addMultipleAction(name: string, fn: (item: ListItem[], context: ListContext) => ProviderResult<void>, options?: ActionOptions): void {
    this.createAction(Object.assign({
      name,
      multiple: true,
      execute: fn
    }, options || {}))
  }

  public addLocationActions(): void {
    this.createAction({
      name: 'preview',
      execute: async (item: ListItem, context: ListContext) => {
        let loc = await this.convertLocation(item.location)
        await this.previewLocation(loc, context)
      }
    })
    let { nvim } = this
    this.createAction({
      name: 'quickfix',
      multiple: true,
      execute: async (items: ListItem[]) => {
        let quickfixItems = await Promise.all(items.map(item => this.convertLocation(item.location).then(loc => workspace.getQuickfixItem(loc))))
        await nvim.call('setqflist', [quickfixItems])
        let openCommand = await nvim.getVar('coc_quickfix_open_command') as string
        nvim.command(typeof openCommand === 'string' ? openCommand : 'copen', true)
      }
    })
    for (let name of ['open', 'tabe', 'drop', 'vsplit', 'split']) {
      this.createAction({
        name,
        execute: async (item: ListItem) => {
          await this.jumpTo(item.location, name == 'open' ? null : name)
        }
      })
    }
  }

  public async convertLocation(location: Location | LocationWithLine | string): Promise<Location> {
    if (typeof location == 'string') return Location.create(location, Range.create(0, 0, 0, 0))
    if (Location.is(location)) return location
    let u = URI.parse(location.uri)
    if (u.scheme != 'file') return Location.create(location.uri, Range.create(0, 0, 0, 0))
    const rl = readline.createInterface({
      input: fs.createReadStream(u.fsPath, { encoding: 'utf8' }),
    })
    let match = location.line
    let n = 0
    let resolved = false
    let line = await new Promise<string>(resolve => {
      rl.on('line', line => {
        if (resolved) return
        if (line.includes(match)) {
          rl.removeAllListeners()
          rl.close()
          resolved = true
          resolve(line)
          return
        }
        n = n + 1
      })
      rl.on('error', e => {
        this.nvim.errWriteLine(`Read ${u.fsPath} error: ${e.message}`)
        resolve(null)
      })
    })
    if (line != null) {
      let character = location.text ? line.indexOf(location.text) : 0
      if (character == 0) character = line.match(/^\s*/)[0].length
      let end = Position.create(n, character + (location.text ? location.text.length : 0))
      return Location.create(location.uri, Range.create(Position.create(n, character), end))
    }
    return Location.create(location.uri, Range.create(0, 0, 0, 0))
  }

  public async jumpTo(location: Location | LocationWithLine | string, command?: string): Promise<void> {
    if (typeof location == 'string') {
      await workspace.jumpTo(location, null, command)
      return
    }
    let { range, uri } = await this.convertLocation(location)
    let position = range.start
    if (position.line == 0 && position.character == 0 && comparePosition(position, range.end) == 0) {
      // allow plugin that remember position.
      position = null
    }
    await workspace.jumpTo(uri, position, command)
  }

  private createAction(action: ListAction): void {
    let { name } = action
    let idx = this.actions.findIndex(o => o.name == name)
    // allow override
    if (idx !== -1) this.actions.splice(idx, 1)
    this.actions.push(action)
  }

  protected async previewLocation(location: Location, context: ListContext): Promise<void> {
    if (!context.listWindow) return
    let { nvim } = this
    let { uri, range } = location
    let doc = workspace.getDocument(location.uri)
    let u = URI.parse(uri)
    let lines: string[] = []
    if (doc) {
      lines = doc.getLines(0, range.end.line + this.previewHeight)
    } else if (u.scheme == 'file') {
      lines = await readFileLines(u.fsPath, 0, range.end.line + 30)
    }
    let config: PreviewConfig = {
      range,
      lnum: range.start.line + 1,
      name: u.scheme == 'file' ? u.fsPath : '',
      filetype: doc ? doc.filetype : '',
      position: context.options.position,
      maxHeight: this.previewHeight,
      splitRight: this.splitRight,
      hlGroup: this.hlGroup,
    }
    await nvim.call('coc#list#preview', [lines, config])
  }

  public async preview(options: PreiewOptions, context: ListContext): Promise<void> {
    let { nvim } = this
    let { bufname, filetype, range, lines, lnum } = options
    let config: PreviewConfig = {
      lnum: range ? range.start.line + 1 : lnum || 1,
      filetype: filetype || '',
      position: context.options.position,
      maxHeight: this.previewHeight,
      splitRight: this.splitRight,
      hlGroup: this.hlGroup,
    }
    if (bufname) config.name = bufname
    if (range) config.range = range
    await nvim.call('coc#list#preview', [lines, config])
  }

  public abstract loadItems(context: ListContext, token?: CancellationToken): Promise<ListItem[] | ListTask | null | undefined>

  public doHighlight(): void {
    // noop
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
