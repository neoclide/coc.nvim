import { Neovim } from '@chemzqm/neovim'
import stringWidth from '@chemzqm/string-width'
import { CompleteOption, ExtendedCompleteItem, HighlightItem } from '../types'
import { byteIndex, byteLength } from '../util/string'
import { CompleteConfig } from './complete'
import MruLoader from './mru'
const logger = require('../util/logger')('completion-pum')

export interface PumDimension {
  readonly height: number
  readonly width: number
  readonly row: number
  readonly col: number
  readonly scrollbar: boolean
}

export interface BuildConfig {
  readonly border: boolean
  readonly abbrWidth: number
  readonly menuWidth: number
  readonly kindWidth: number
}

export interface PumConfig {
  width?: number
  highlights?: HighlightItem[]
  highlight?: string
  borderhighlight?: string
  winblend?: number
  shadow?: boolean
  border?: [number, number, number, number] | undefined
  rounded?: number
}

export default class PopupMenu {
  private _search = ''
  constructor(
    private nvim: Neovim,
    private config: CompleteConfig,
    private mruLoader: MruLoader
  ) {
  }

  public get search(): string {
    return this._search
  }

  public get pumConfig(): PumConfig {
    let { floatConfig } = this.config
    let obj: PumConfig = {}
    for (let key of ['highlight', 'winblend', 'shadow']) {
      if (floatConfig[key]) obj[key] = floatConfig[key]
    }
    if (floatConfig.border) {
      obj.border = [1, 1, 1, 1]
      obj.rounded = floatConfig.rounded ? 1 : 0
      obj.borderhighlight = floatConfig.borderhighlight ?? 'CocFloating'
    }
    return obj
  }

  private stringWidth(text: string): number {
    return stringWidth(text, { ambiguousIsNarrow: this.config.ambiguousIsNarrow })
  }

  public show(items: ExtendedCompleteItem[], search: string, option: CompleteOption): void {
    this._search = search
    let { labelMaxLength, noselect, selection, floatConfig, disableMenuShortcut, virtualText } = this.config
    let selectedIndex = noselect ? -1 : items.findIndex(o => o.preselect)
    if (selectedIndex !== -1 && search.length > 0) {
      let item = items[selectedIndex]
      if (!item.filterText?.startsWith(search)) {
        selectedIndex = -1
      }
    }
    let maxMru = -1
    let abbrWidth = 0
    let menuWidth = 0
    let kindWidth = 0
    let checkMru = !noselect && selectedIndex == -1 && selection != 'none'
    // abbr kind, menu
    for (let i = 0; i < items.length; i++) {
      let item = items[i]
      if (checkMru) {
        let n = this.mruLoader.getScore(search, item)
        if (n > maxMru) {
          maxMru = n
          selectedIndex = i
        }
      }
      delete item.preselect
      let menu = item.menu ?? ''
      if (item.abbr.length > labelMaxLength) {
        item.abbr = item.abbr.slice(0, labelMaxLength)
      }
      if (disableMenuShortcut && menu.length) {
        menu = menu.replace(/\[\w+\]$/, '')
        item.menu = menu
      }
      abbrWidth = Math.max(this.stringWidth(item.abbr), abbrWidth)
      if (item.kind) kindWidth = Math.max(this.stringWidth(item.kind), kindWidth)
      if (menu.length > 0) menuWidth = Math.max(this.stringWidth(menu), menuWidth)
    }
    if (!noselect && selectedIndex == -1) selectedIndex = 0
    let opt = {
      input: search,
      index: selectedIndex,
      bufnr: option.bufnr,
      line: option.linenr,
      col: option.col,
      virtualText,
      words: items.map(o => o.word)
    }
    let lines: string[] = []
    let highlights: HighlightItem[] = []
    // create lines and highlights
    let width = 0
    let cfg: BuildConfig = { border: !!floatConfig.border, menuWidth, abbrWidth, kindWidth }
    for (let index = 0; index < items.length; index++) {
      let text = this.buildItem(items[index], highlights, index, cfg)
      width = Math.max(width, this.stringWidth(text))
      lines.push(text)
    }
    let config: PumConfig = Object.assign({ width, highlights }, this.pumConfig)
    this.nvim.call('coc#pum#create', [lines, opt, config], true)
    this.nvim.redrawVim()
  }

  private buildItem(item: ExtendedCompleteItem, hls: HighlightItem[], index: number, config: BuildConfig): string {
    let text = config.border ? '' : ' '
    text += this.fillWidth(item.abbr, config.abbrWidth)
    if (item.positions?.length > 0) {
      let highlights = positionHighlights(item.abbr, item.positions.slice(), config.border ? 0 : 1, index)
      hls.push(...highlights)
      if (item.deprecated) {
        let start = config.border ? 0 : 1
        hls.push({
          hlGroup: 'CocPumDeprecated',
          lnum: index,
          colStart: start,
          colEnd: byteLength(text)
        })
      }
    }
    if (config.kindWidth > 0) {
      text += ' '
      let pre = byteLength(text)
      text += this.fillWidth(item.kind ?? '', config.kindWidth)
      if (item.kind && item.kindHighlight) {
        hls.push({
          hlGroup: item.kindHighlight,
          lnum: index,
          colStart: pre,
          colEnd: pre + byteLength(item.kind)
        })
      }
    }
    if (config.menuWidth > 0) {
      text += ' '
      let pre = byteLength(text)
      text += this.fillWidth(item.menu ?? '', config.menuWidth)
      if (item.menu) {
        hls.push({
          hlGroup: 'CocPumMenu',
          lnum: index,
          colStart: pre,
          colEnd: pre + byteLength(item.menu)
        })
      }
    }
    if (!config.border) text += ' '
    return text
  }

  private fillWidth(text: string, width: number): string {
    let n = width - this.stringWidth(text)
    return n <= 0 ? text : text + ' '.repeat(n)
  }
}

export function positionHighlights(label: string, positions: number[], pre: number, line: number): HighlightItem[] {
  let hls: HighlightItem[] = []
  while (positions.length > 0) {
    let start = positions.shift()
    let end = start
    while (positions.length > 0) {
      let n = positions[0]
      if (n - end == 1) {
        end = n
        positions.shift()
      } else {
        break
      }
    }
    hls.push({
      hlGroup: 'CocPumSearch',
      lnum: line,
      colStart: pre + byteIndex(label, start),
      colEnd: pre + byteIndex(label, end + 1),
    })
  }
  return hls
}
