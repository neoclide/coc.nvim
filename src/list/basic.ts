import { Neovim } from '@chemzqm/neovim'
import { Disposable, Location, CancellationToken } from 'vscode-languageserver-protocol'
import URI from 'vscode-uri'
import { ProviderResult } from '../provider'
import { IList, ListAction, ListContext, ListItem, ListTask, WorkspaceConfiguration } from '../types'
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
        await this.previewLocation(item.location, context)
      }
    })
    let { nvim } = this
    this.createAction({
      name: 'quickfix',
      multiple: true,
      execute: async (items: ListItem[]) => {
        let quickfixItems = await Promise.all(items.map(item => {
          return workspace.getQuickfixItem(item.location)
        }))
        await nvim.call('setqflist', [quickfixItems])
        nvim.command('copen', true)
      }
    })
    for (let name of ['open', 'tabe', 'drop', 'vsplit', 'split']) {
      this.createAction({
        name,
        execute: async (item: ListItem) => {
          if (name == 'open') {
            await this.jumpTo(item.location)
          } else {
            await this.jumpTo(item.location, name)
          }
        }
      })
    }
  }

  public async jumpTo(location: Location, command?: string): Promise<void> {
    let { range, uri } = location
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
    await nvim.command('pclose')
    let exists = await nvim.call('bufloaded', filepath)
    nvim.pauseNotification()
    nvim.command(`${mod} ${height}sp +setl\\ previewwindow ${escaped}`, true)
    nvim.command(`exe ${lnum}`, true)
    nvim.command('setl winfixheight', true)
    if (range.start.line == range.end.line && range.start.character != range.end.character) {
      let line = await workspace.getLine(uri, range.start.line)
      let { hlGroup } = this
      let start = byteIndex(line, range.start.character) + 1
      let end = byteIndex(line, range.end.character) + 1
      nvim.call('matchaddpos', [hlGroup, [[lnum, start, end - start]]], true)
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
