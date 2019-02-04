import { Neovim } from '@chemzqm/neovim'
import { Location } from 'vscode-languageserver-types'
import { ListContext, ListItem, QuickfixItem } from '../../types'
import BasicList from '../basic'
const logger = require('../../util/logger')('list-location')

export default class LocationList extends BasicList {
  public defaultAction = 'open'
  public description = 'last jump locations'
  public name = 'location'

  constructor(nvim: Neovim) {
    super(nvim)
    this.addLocationActions()
  }

  public async loadItems(context: ListContext): Promise<ListItem[]> {
    let locs = await this.nvim.getVar('coc_jump_locations') as QuickfixItem[]
    locs = locs || []
    let bufnr: number
    let valid = await context.window.valid
    if (valid) {
      let buf = await context.window.buffer
      bufnr = buf.id
    }
    let ignoreFilepath = locs.every(o => o.bufnr && bufnr && o.bufnr == bufnr)
    let items: ListItem[] = locs.map(loc => {
      let filename = ignoreFilepath ? '' : loc.filename || loc.uri
      let filterText = `${filename}${loc.text.trim()}`
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
    nvim.resumeNotification()
  }
}
