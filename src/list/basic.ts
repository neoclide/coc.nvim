import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import readline from 'readline'
import { CancellationToken, Position, Disposable, Location, Range } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { ProviderResult } from '../provider'
import { IList, ListAction, ListContext, ListItem, ListTask, LocationWithLine, WorkspaceConfiguration, ListArgument, PreiewOptions } from '../types'
import { disposeAll } from '../util'
import { comparePosition } from '../util/position'
import { byteIndex } from '../util/string'
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
        let quickfixItems = await Promise.all(items.map(item => {
          return this.convertLocation(item.location).then(loc => {
            return workspace.getQuickfixItem(loc)
          })
        }))
        await nvim.call('setqflist', [quickfixItems])
        nvim.command('copen', true)
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
        if (line.indexOf(match) !== -1) {
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
    let { nvim } = this
    let { uri, range } = location
    let lineCount = Infinity
    let doc = workspace.getDocument(location.uri)
    if (doc) lineCount = doc.lineCount
    let height = Math.min(this.previewHeight, lineCount)
    let u = URI.parse(uri)
    if (u.scheme == 'untitled' || u.scheme == 'unknown') {
      let bufnr = parseInt(u.path, 10)
      let valid = await nvim.call('bufloaded', [bufnr])
      let lnum = location.range.start.line + 1
      if (valid) {
        let name = await nvim.call('bufname', [bufnr])
        name = name || '[No Name]'
        let filetype = await nvim.call('getbufvar', [bufnr, '&filetype'])
        let lines = await nvim.call('getbufline', [bufnr, 1, '$'])
        await this.preview({ bufname: name, sketch: true, filetype: filetype || 'txt', lnum, lines }, context)
      } else {
        await this.preview({ bufname: '[No Name]', sketch: true, filetype: 'txt', lines: [] }, context)
      }
      return
    }
    let filepath = u.scheme == 'file' ? u.fsPath : u.toString()
    let escaped = await nvim.call('fnameescape', filepath)
    let lnum = range.start.line + 1
    let mod = context.options.position == 'top' ? 'below' : 'above'
    let winid = context.listWindow.id
    let exists = await nvim.call('bufloaded', filepath)
    let valid = await context.window.valid
    nvim.pauseNotification()
    nvim.command('pclose', true)
    if (this.splitRight) {
      if (valid) nvim.call('win_gotoid', [context.window.id], true)
      nvim.command(`silent belowright vs +setl\\ previewwindow ${escaped}`, true)
    } else {
      nvim.command(`silent ${mod} ${height}sp +setl\\ previewwindow ${escaped}`, true)
    }
    nvim.command(`exe ${lnum}`, true)
    nvim.command('setl winfixheight nofoldenable', true)
    if (comparePosition(range.start, range.end) !== 0) {
      let arr: Range[] = []
      for (let i = range.start.line; i <= range.end.line; i++) {
        let curr = await workspace.getLine(uri, range.start.line)
        let sc = i == range.start.line ? range.start.character : 0
        let ec = i == range.end.line ? range.end.character : curr.length
        if (sc == ec) continue
        arr.push(Range.create(i, sc, i, ec))
      }
      for (let r of arr) {
        let line = await workspace.getLine(uri, r.start.line)
        let start = byteIndex(line, r.start.character) + 1
        let end = byteIndex(line, r.end.character) + 1
        nvim.call('matchaddpos', [this.hlGroup, [[lnum, start, end - start]]], true)
      }
    }
    if (!exists) nvim.command('setl nobuflisted bufhidden=wipe', true)
    nvim.command('normal! zz', true)
    nvim.call('win_gotoid', [winid], true)
    if (workspace.isVim) nvim.command('redraw', true)
    let [, err] = await nvim.resumeNotification()
    // tslint:disable-next-line: no-console
    if (err) console.error(`Error on ${err[0]}: ${err[1]} - ${err[2]}`)
  }

  public async preview(options: PreiewOptions, context: ListContext): Promise<void> {
    let { nvim } = this
    let { bufname, filetype, sketch, lines, lnum } = options
    let mod = context.options.position == 'top' ? 'below' : 'above'
    let height = Math.min(this.previewHeight, lines ? Math.max(lines.length, 1) : Infinity)
    let winid = context.listWindow.id
    let valid = await context.window.valid
    nvim.pauseNotification()
    nvim.command('pclose', true)
    if (this.splitRight) {
      if (valid) nvim.call('win_gotoid', [context.window.id], true)
      nvim.command(`silent belowright vs +setl\\ previewwindow ${bufname}`, true)
    } else {
      nvim.command(`silent ${mod} ${height}sp +setl\\ previewwindow ${bufname}`, true)
    }
    if (lines) {
      nvim.call('append', [0, lines], true)
      nvim.command('normal! Gdd', true)
    }
    if (lnum) nvim.command(`exe ${lnum}`, true)
    nvim.command('setl winfixheight nomodifiable', true)
    if (sketch) nvim.command('setl buftype=nofile bufhidden=wipe nobuflisted', true)
    if (filetype == 'detect') {
      nvim.command('filetype detect', true)
    } else if (filetype) {
      nvim.command(`setf ${filetype}`, true)
    }
    nvim.command('normal! zz', true)
    nvim.call('win_gotoid', [winid], true)
    if (workspace.isVim) nvim.command('redraw', true)
    let [, err] = await nvim.resumeNotification()
    // tslint:disable-next-line: no-console
    if (err) console.error(`Error on ${err[0]}: ${err[1]} - ${err[2]}`)
  }

  public abstract loadItems(context: ListContext, token?: CancellationToken): Promise<ListItem[] | ListTask | null | undefined>

  public doHighlight(): void {
    // noop
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
