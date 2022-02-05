import { Neovim } from '@chemzqm/neovim'
import os from 'os'
import path from 'path'
import { Disposable, Location, Position } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import Configurations from '../configuration'
import { Env } from '../types'
import { disposeAll } from '../util'
import { fixDriver } from '../util/fs'
import { byteLength } from '../util/string'
import ContentProvider from './contentProvider'
import Documents from './documents'
const logger = require('../util/logger')('core-locations')

export default class Locations implements Disposable {
  private nvim: Neovim
  private env: Env
  private disposables: Disposable[] = []
  constructor(
    private configurations: Configurations,
    private documents: Documents,
    private contentProvider: ContentProvider
  ) {
  }

  public attach(nvim: Neovim, env: Env): void {
    this.nvim = nvim
    this.env = env
  }

  /**
   * Populate locations to UI.
   */
  public async showLocations(locations: Location[]): Promise<void> {
    let { documents, nvim, env, configurations } = this
    let items = await documents.getQuickfixList(locations)
    const preferences = configurations.getConfiguration('coc.preferences')
    if (preferences.get<boolean>('useQuickfixForLocations', false)) {
      let openCommand = await nvim.getVar('coc_quickfix_open_command') as string
      if (typeof openCommand != 'string') {
        openCommand = items.length < 10 ? `copen ${items.length}` : 'copen'
      }
      nvim.pauseNotification()
      nvim.call('setqflist', [items], true)
      nvim.command(openCommand, true)
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      nvim.resumeNotification(false, true)
    } else {
      await nvim.setVar('coc_jump_locations', items)
      if (env.locationlist) {
        nvim.command('CocList --normal --auto-preview location', true)
      } else {
        nvim.call('coc#util#do_autocmd', ['CocLocationsChange'], true)
      }
    }
  }

  public async jumpTo(uri: string, position?: Position | null, openCommand?: string): Promise<void> {
    const preferences = this.configurations.getConfiguration('coc.preferences')
    let jumpCommand = openCommand || preferences.get<string>('jumpCommand', 'edit')
    let { nvim } = this
    let doc = this.documents.getDocument(uri)
    let bufnr = doc ? doc.bufnr : -1
    if (bufnr != -1 && jumpCommand == 'edit') {
      // use buffer command since edit command would reload the buffer
      nvim.pauseNotification()
      nvim.command(`silent! normal! m'`, true)
      nvim.command(`buffer ${bufnr}`, true)
      nvim.command(`filetype detect`, true)
      if (position) {
        let line = doc.getline(position.line)
        let col = byteLength(line.slice(0, position.character)) + 1
        nvim.call('cursor', [position.line + 1, col], true)
      }
      await nvim.resumeNotification(true)
    } else {
      let { fsPath, scheme } = URI.parse(uri)
      let pos = position == null ? null : [position.line, position.character]
      if (scheme == 'file') {
        let bufname = fixDriver(path.normalize(fsPath))
        await this.nvim.call('coc#util#jump', [jumpCommand, bufname, pos])
      } else {
        if (os.platform() == 'win32') {
          uri = uri.replace(/\/?/, '?')
        }
        await this.nvim.call('coc#util#jump', [jumpCommand, uri, pos])
      }
    }
  }

  /**
   * Open resource by uri
   */
  public async openResource(uri: string): Promise<void> {
    let { nvim, contentProvider } = this
    let u = URI.parse(uri)
    if (u.scheme !== 'file' && !contentProvider.schemes.includes(u.scheme)) {
      await nvim.call('coc#util#open_url', uri)
      return
    }
    let wildignore = await nvim.getOption('wildignore')
    await nvim.setOption('wildignore', '')
    await this.jumpTo(uri)
    await nvim.setOption('wildignore', wildignore)
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
