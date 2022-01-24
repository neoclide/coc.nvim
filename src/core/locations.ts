import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Disposable, Location, LocationLink, Position } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import Configurations from '../configuration'
import { Env, QuickfixItem } from '../types'
import { disposeAll } from '../util'
import { fixDriver, readFileLine } from '../util/fs'
import { byteIndex, byteLength } from '../util/string'
import Documents from './documents'
const logger = require('../util/logger')('core-locations')

export default class Locations implements Disposable {
  private nvim: Neovim
  private env: Env
  private disposables: Disposable[] = []
  constructor(
    private configurations: Configurations,
    private documents: Documents
  ) {
  }

  public attach(nvim: Neovim, env: Env): void {
    this.nvim = nvim
    this.env = env
  }

  public async getQuickfixList(locations: Location[]): Promise<ReadonlyArray<QuickfixItem>> {
    let filesLines: { [fsPath: string]: string[] } = {}
    let filepathList = locations.reduce<string[]>((pre: string[], curr) => {
      let u = URI.parse(curr.uri)
      if (u.scheme == 'file' && !pre.includes(u.fsPath) && !this.documents.getDocument(curr.uri)) {
        pre.push(u.fsPath)
      }
      return pre
    }, [])

    await Promise.all(filepathList.map(fsPath => {
      return new Promise(resolve => {
        fs.readFile(fsPath, 'utf8', (err, content) => {
          if (err) return resolve(undefined)
          filesLines[fsPath] = content.split(/\r?\n/)
          resolve(undefined)
        })
      })
    }))
    return await Promise.all(locations.map(loc => {
      let { uri, range } = loc
      let { fsPath } = URI.parse(uri)
      let text: string | undefined
      let lines = filesLines[fsPath]
      if (lines) text = lines[range.start.line]
      return this.getQuickfixItem(loc, text)
    }))
  }

  /**
   * Populate locations to UI.
   */
  public async showLocations(locations: Location[]): Promise<void> {
    let items = await this.getQuickfixList(locations)
    let { nvim } = this
    const preferences = this.configurations.getConfiguration('coc.preferences')
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
      if (this.env.locationlist) {
        nvim.command('CocList --normal --auto-preview location', true)
      } else {
        nvim.call('coc#util#do_autocmd', ['CocLocationsChange'], true)
      }
    }
  }

  /**
   * Convert location to quickfix item.
   */
  public async getQuickfixItem(loc: Location | LocationLink, text?: string, type = '', module?: string): Promise<QuickfixItem> {
    if (LocationLink.is(loc)) {
      loc = Location.create(loc.targetUri, loc.targetRange)
    }
    let doc = this.documents.getDocument(loc.uri)
    let { uri, range } = loc
    let u = URI.parse(uri)
    if (!text && u.scheme == 'file') {
      text = await this.getLine(uri, range.start.line)
    }
    let item: QuickfixItem = {
      uri,
      filename: u.scheme == 'file' ? u.fsPath : uri,
      lnum: range.start.line + 1,
      end_lnum: range.end.line + 1,
      col: text ? byteIndex(text, range.start.character) + 1 : range.start.character + 1,
      end_col: text ? byteIndex(text, range.end.character) + 1 : range.end.character + 1,
      text: text || '',
      range
    }
    if (module) item.module = module
    if (type) item.type = type
    if (doc) item.bufnr = doc.bufnr
    return item
  }

  /**
   * Get content of line by uri and line.
   */
  public async getLine(uri: string, line: number): Promise<string> {
    let document = this.documents.getDocument(uri)
    if (document) return document.getline(line) || ''
    if (!uri.startsWith('file:')) return ''
    let fsPath = URI.parse(uri).fsPath
    if (!fs.existsSync(fsPath)) return ''
    return await readFileLine(fsPath, line)
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
      if (this.env.isVim) nvim.command('redraw', true)
      await nvim.resumeNotification()
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

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
