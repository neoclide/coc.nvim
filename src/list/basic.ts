import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import { Disposable, Location } from 'vscode-languageserver-protocol'
import URI from 'vscode-uri'
import workspace from '../workspace'
import { ProviderResult } from '../provider'
import { IList, ListAction, ListContext, ListItem, ListTask } from '../types'
import { comparePosition } from '../util/position'
import { disposeAll } from '../util'
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

  constructor(protected nvim: Neovim) {
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
    filepath = filepath.startsWith(cwd) ? path.relative(cwd, filepath) : filepath
    let lnum = range.start.line + 1
    let mod = context.options.position == 'top' ? 'below' : ''
    let winid = context.listWindow.id
    nvim.pauseNotification()
    nvim.command('pclose', true)
    nvim.call('coc#util#open_file', [`${mod} ${height}sp +${lnum}`, filepath], true)
    let cmd = 'setl previewwindow winfixheight'
    // TODO not use cursorline
    if (lnum != 1) cmd += ' cursorline'
    if (!workspace.getDocument(uri)) cmd += ' nobuflisted bufhidden=wipe'
    nvim.command(cmd, true)
    nvim.command('normal! zt', true)
    nvim.call('win_gotoid', [winid], true)
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
