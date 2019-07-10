import { Neovim } from '@chemzqm/neovim'
import { Location, Range } from 'vscode-languageserver-types'
import path from 'path'
import { ListContext, ListItem, QuickfixItem } from '../../types'
import BasicList from '../basic'
import workspace from '../../workspace'
import { URI } from 'vscode-uri'
import { isParentFolder } from '../../util/fs'
const logger = require('../../util/logger')('list-location')

export default class LocationList extends BasicList {
  public defaultAction = 'open'
  public description = 'show locations saved by g:coc_jump_locations variable'
  public name = 'location'

  constructor(nvim: Neovim) {
    super(nvim)
    this.addLocationActions()
  }

  public async loadItems(context: ListContext): Promise<ListItem[]> {
    // filename, lnum, col, text, type
    let locs = await this.nvim.getVar('coc_jump_locations') as QuickfixItem[]
    locs = locs || []
    locs.forEach(loc => {
      if (!loc.uri) {
        let fullpath = path.isAbsolute(loc.filename) ? loc.filename : path.join(context.cwd, loc.filename)
        loc.uri = URI.file(fullpath).toString()
      }
      if (!loc.bufnr && workspace.getDocument(loc.uri) != null) {
        loc.bufnr = workspace.getDocument(loc.uri).bufnr
      }
      if (!loc.range) {
        let { lnum, col } = loc
        loc.range = Range.create(lnum - 1, col - 1, lnum - 1, col - 1)
      } else {
        loc.lnum = loc.lnum || loc.range.start.line + 1
        loc.col = loc.col || loc.range.start.character + 1
      }
    })
    let bufnr = await this.nvim.call('bufnr', '%')
    let ignoreFilepath = locs.every(o => o.bufnr && bufnr && o.bufnr == bufnr)
    let items: ListItem[] = locs.map(loc => {
      let filename = ignoreFilepath ? '' : loc.filename
      let filterText = `${filename}${loc.text.trim()}`
      if (path.isAbsolute(filename)) {
        filename = isParentFolder(context.cwd, filename) ? path.relative(context.cwd, filename) : filename
      }
      return {
        label: `${filename} |${loc.type ? loc.type + ' ' : ''}${loc.lnum} col ${loc.col}| ${loc.text}`,
        location: Location.create(loc.uri!, loc.range),
        filterText
      } as ListItem
    })
    return items
  }

  public doHighlight(): void {
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command('syntax match CocLocationName /\\v^[^|]+/ contained containedin=CocLocationLine', true)
    nvim.command('syntax match CocLocationPosition /\\v\\|\\w*\\s?\\d+\\scol\\s\\d+\\|/ contained containedin=CocLocationLine', true)
    nvim.command('syntax match CocLocationError /Error/ contained containedin=CocLocationPosition', true)
    nvim.command('syntax match CocLocationWarning /Warning/ contained containedin=CocLocationPosition', true)
    nvim.command('highlight default link CocLocationName Directory', true)
    nvim.command('highlight default link CocLocationPosition LineNr', true)
    nvim.command('highlight default link CocLocationError Error', true)
    nvim.command('highlight default link CocLocationWarning WarningMsg', true)
    nvim.resumeNotification().catch(_e => {
      // noop
    })
  }
}
