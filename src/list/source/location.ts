'use strict'
import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import { CancellationToken } from 'vscode-languageserver-protocol'
import { Location, Position, Range } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import commands from '../../commands'
import { AnsiHighlight, ListContext, ListItem, LocationWithTarget, QuickfixItem } from '../../types'
import { isParentFolder } from '../../util/fs'
import { byteLength } from '../../util/string'
import BasicList from '../basic'
const logger = require('../../util/logger')('list-location')

export default class LocationList extends BasicList {
  public defaultAction = 'open'
  public description = 'show locations saved by g:coc_jump_locations variable'
  public name = 'location'

  constructor(nvim: Neovim) {
    super(nvim)
    this.createAction({
      name: 'refactor',
      multiple: true,
      execute: async (items: ListItem[]) => {
        let locations = items.map(o => o.location)
        await commands.executeCommand('workspace.refactor', locations)
      }
    })
    this.addLocationActions()
  }

  public async loadItems(context: ListContext, token: CancellationToken): Promise<ListItem[]> {
    // filename, lnum, col, text, type
    let locs = await this.nvim.getVar('coc_jump_locations') as QuickfixItem[]
    if (token.isCancellationRequested) return []
    locs = locs || []
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
  if (loc.targetRange) location.targetRange = loc.targetRange
  return {
    label,
    location,
    filterText,
    ansiHighlights,
  }
}
