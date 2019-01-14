import { Neovim } from '@chemzqm/neovim'
import { Location, Position, Range } from 'vscode-languageserver-types'
import { ListItem, QuickfixItem, ListContext } from '../../types'
import BasicList from '../basic'

export default class LocationList extends BasicList {
  public defaultAction = 'open'
  public description = 'last jump locations'

  constructor(nvim: Neovim) {
    super(nvim)
    this.addLocationActions()
  }

  public get name(): string {
    return 'location'
  }

  public async loadItems(_context: ListContext): Promise<ListItem[]> {
    let locs = await this.nvim.getVar('coc_jump_locations') as QuickfixItem[]
    locs = locs || []
    let items: ListItem[] = locs.map(loc => {
      let pos: Position = Position.create(loc.lnum - 1, loc.col - 1)
      let end = pos.line == 0 && pos.character == 0 ? { line: 0, character: 1 } : pos
      let range = Range.create(pos, end)
      let filterText = `${loc.filename || loc.uri}${loc.text.trim()}`
      return {
        label: `${loc.filename || loc.uri} |${loc.type ? loc.type + ' ' : ''}${loc.lnum} col ${loc.col}| ${loc.text}`,
        location: Location.create(loc.uri!, range),
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
