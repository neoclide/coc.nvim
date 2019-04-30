import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import readline from 'readline'
import { CancellationToken, Position, Disposable, Location, Range } from 'vscode-languageserver-protocol'
import { default as URI, default as Uri } from 'vscode-uri'
import { ProviderResult } from '../provider'
import { IList, ListAction, ListContext, ListItem, ListTask, LocationWithLine, WorkspaceConfiguration } from '../types'
import { disposeAll } from '../util'
import { comparePosition } from '../util/position'
import { byteIndex } from '../util/string'
import workspace from '../workspace'
const logger = require('../util/logger')('list-basic')

interface ActionOptions {
  persist?: boolean
  reload?: boolean
  parallel?: boolean
}

export default abstract class BasicList implements IList, Disposable {
  public name: string
  public defaultAction = 'open'
  public readonly actions: ListAction[] = []
  protected previewHeight = 12
  protected disposables: Disposable[] = []
  private hlGroup: string

  constructor(protected nvim: Neovim) {
    let config = workspace.getConfiguration('list')
    this.hlGroup = config.get<string>('previewHighlightGroup', 'Search')
    this.previewHeight = config.get<number>('maxPreviewHeight', 12)
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
    let u = Uri.parse(location.uri)
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
    let filepath = u.scheme == 'file' ? u.fsPath : u.toString()
    let escaped = await nvim.call('fnameescape', filepath)
    let lnum = range.start.line + 1
    let mod = context.options.position == 'top' ? 'below' : 'above'
    let winid = context.listWindow.id
    let exists = await nvim.call('bufloaded', filepath)
    nvim.pauseNotification()
    nvim.command('pclose', true)
    nvim.command(`${mod} ${height}sp +setl\\ previewwindow ${escaped}`, true)
    nvim.command(`exe ${lnum}`, true)
    nvim.command('setl winfixheight', true)
    nvim.command('setl nofoldenable', true)
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
    await nvim.resumeNotification()
  }

  public abstract loadItems(context: ListContext, token?: CancellationToken): Promise<ListItem[] | ListTask | null | undefined>

  public doHighlight(): void {
    // noop
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
