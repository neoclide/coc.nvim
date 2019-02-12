import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import { Disposable, Location } from 'vscode-languageserver-protocol'
import URI from 'vscode-uri'
import workspace from '../workspace'
import { ProviderResult } from '../provider'
import { IList, ListAction, ListContext, ListItem, ListTask } from '../types'
import { comparePosition } from '../util/position'
import { disposeAll } from '../util'
import { byteIndex } from '../util/string'
const logger = require('../util/logger')('list-basic')

interface ActionOptions {
  persist?: boolean
  reload?: boolean
  parallel?: boolean
}

export default abstract class BasicList implements IList, Disposable {
  public abstract name: string
  public defaultAction = 'open'
  public readonly actions: ListAction[] = []
  protected previewHeight = 12
  protected disposables: Disposable[] = []
  private hlGroup: string

  constructor(protected nvim: Neovim) {
    let config = workspace.getConfiguration('list')
    this.hlGroup = config.get<string>('previewHighlightGroup', 'Search')
  }

  protected addAction(name: string, fn: (item: ListItem, context: ListContext) => ProviderResult<void>, options?: ActionOptions): void {
    this.createAction(Object.assign({
      name,
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
    if (idx !== -1) {
      this.actions.splice(idx, 1)
    }
    this.actions.push(action)
  }

  protected async previewLocation(location: Location, context: ListContext): Promise<void> {
    let { nvim } = this
    let { uri, range } = location
    let lineCount = range.end.line - range.start.line + 1
    let height = Math.max(this.previewHeight, lineCount)
    let u = URI.parse(uri)
    let filepath = u.scheme == 'file' ? u.fsPath : u.toString()
    let cwd = workspace.cwd
    let escaped = await nvim.call('fnameescape', filepath)
    filepath = filepath.startsWith(cwd) ? path.relative(cwd, filepath) : filepath
    let lnum = range.start.line + 1
    let mod = context.options.position == 'top' ? 'below' : ''
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
    if (!exists) {
      nvim.command('setl nobuflisted bufhidden=wipe', true)
    }
    nvim.command('normal! zt', true)
    nvim.call('win_gotoid', [winid], true)
    nvim.command('redraw', true)
    await nvim.resumeNotification()
  }

  public abstract loadItems(context: ListContext): Promise<ListItem[] | ListTask | null | undefined>

  public doHighlight(): void {
    // noop
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
