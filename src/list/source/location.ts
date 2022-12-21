'use strict'
import { CancellationToken } from 'vscode-languageserver-protocol'
import { Location, Position, Range } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import commands from '../../commands'
import { AnsiHighlight, LocationWithTarget, QuickfixItem } from '../../types'
import { toArray } from '../../util/array'
import { isParentFolder } from '../../util/fs'
import { path } from '../../util/node'
import { byteLength } from '../../util/string'
import BasicList from '../basic'
import { ListContext, ListItem } from '../types'

export default class LocationList extends BasicList {
  public defaultAction = 'open'
  public description = 'show locations saved by g:coc_jump_locations variable'
  public name = 'location'

  constructor() {
    super()
    this.createAction({
      name: 'refactor',
      multiple: true,
      execute: async (items: ListItem[]) => {
        let locations = items.map(o => o.location)
        await commands.executeCommand('editor.action.showRefactor', locations)
      }
    })
    this.addLocationActions()
  }

  public async loadItems(context: ListContext, _token: CancellationToken): Promise<ListItem[]> {
    // filename, lnum, col, text, type
    let locs = await this.nvim.getVar('coc_jump_locations') as QuickfixItem[]
    locs = toArray(locs)
    let bufnr = context.buffer.id
    let ignoreFilepath = locs.every(o => o.bufnr == bufnr)
    let items: ListItem[] = locs.map(loc => {
      let filename = ignoreFilepath ? '' : loc.filename
      if (filename.length > 0 && path.isAbsolute(filename)) {
        filename = isParentFolder(context.cwd, filename) ? path.relative(context.cwd, filename) : filename
      }
      return createItem(filename, loc)
    })
    return items
  }
}

function createItem(filename: string, loc: QuickfixItem): ListItem {
  let uri = loc.uri ?? URI.file(loc.filename).toString()
  let label = ''
  const ansiHighlights: AnsiHighlight[] = []
  let start = 0
  if (filename.length > 0) {
    label = filename + ' '
    ansiHighlights.push({ span: [start, start + byteLength(filename)], hlGroup: 'Directory' })
  }
  start = byteLength(label)
  let lnum = loc.lnum ?? loc.range.start.line + 1
  let col = loc.col ?? byteLength(loc.text.slice(0, loc.range.start.character)) + 1
  let position = `|${loc.type ? loc.type + ' ' : ''}${lnum} Col ${col}|`
  label += position
  ansiHighlights.push({ span: [start, start + byteLength(position)], hlGroup: 'LineNr' })
  if (loc.type) {
    let hl = loc.type.toLowerCase() === 'error' ? 'Error' : 'WarningMsg'
    ansiHighlights.push({ span: [start + 1, start + byteLength(loc.type)], hlGroup: hl })
  }
  if (loc.range && loc.range.start.line == loc.range.end.line) {
    let len = byteLength(label) + 1
    let start = len + byteLength(loc.text.slice(0, loc.range.start.character))
    let end = len + byteLength(loc.text.slice(0, loc.range.end.character))
    ansiHighlights.push({ span: [start, end], hlGroup: 'Search' })
  }
  label += ' ' + loc.text
  let filterText = `${filename}${loc.text.trim()}`
  let location: LocationWithTarget
  if (loc.range) {
    location = Location.create(uri, loc.range)
  } else {
    let start = Position.create(loc.lnum - 1, loc.col - 1)
    let end = Position.create((loc.end_lnum ?? loc.lnum) - 1, (loc.end_col ?? loc.col) - 1)
    location = Location.create(uri, Range.create(start, end))
  }
  location.targetRange = loc.targetRange ? loc.targetRange : Range.create(lnum - 1, 0, lnum - 1, 99)
  return {
    label,
    location,
    filterText,
    ansiHighlights,
  }
}
