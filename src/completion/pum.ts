import { Neovim } from '@chemzqm/neovim'
import { CompleteOption, ExtendedCompleteItem, HighlightItem } from '../types'
import { CompleteConfig } from './complete'
import stringWidth from '@chemzqm/string-width'
import { byteIndex, byteLength } from '../util/string'

export interface PumDimension {
  readonly height: number
  readonly width: number
  readonly row: number
  readonly col: number
  readonly scrollbar: boolean
}

export default class PopupMenu {
  constructor(private nvim: Neovim, private config: CompleteConfig) {
  }

  public show(items: ExtendedCompleteItem[], option: CompleteOption, changedtick: number): void {
    let { labelMaxLength, floatConfig, disableMenuShortcut } = this.config
    let selectedIndex = items.findIndex(o => o.preselect)
    if (selectedIndex == -1) selectedIndex = 0
    let border = !!floatConfig.border
    let opt = {
      index: selectedIndex,
      bufnr: option.bufnr,
      line: option.linenr,
      col: option.col,
      changedtick,
      words: items.map(o => o.word)
    }
    let abbrWidth = 0
    let menuWidth = 0
    let kindWidth = 0
    // abbr kind, menu
    for (let item of items) {
      let menu = item.menu ?? ''
      if (item.abbr.length > labelMaxLength) {
        item.abbr = item.abbr.slice(0, labelMaxLength)
      }
      if (disableMenuShortcut && menu.length) {
        menu = menu.replace(/\[\w+\]/, '')
        item.menu = menu
      }
      abbrWidth = Math.max(stringWidth(item.abbr), abbrWidth)
      if (item.kind) kindWidth = Math.max(stringWidth(item.kind), kindWidth)
      if (menu.length > 0) menuWidth = Math.max(stringWidth(menu), menuWidth)
    }
    let lines: string[] = []
    let highlights: HighlightItem[] = []
    // create lines and highlights
    let width = 0
    for (let index = 0; index < items.length; index++) {
      let [text, hls] = this.buildItem(items[index], border, index, abbrWidth, kindWidth, menuWidth)
      width = Math.max(width, stringWidth(text))
      lines.push(text)
      highlights.push(...hls)
    }
    let config: any = {
      width,
      highlights
    }
    if (floatConfig.highlight) config.highlight = floatConfig.highlight
    if (floatConfig.winblend) config.winblend = floatConfig.winblend
    if (floatConfig.shadow) config.shadow = floatConfig.shadow
    if (border) {
      config.border = [1, 1, 1, 1]
      config.borderhighlight = floatConfig.borderhighlight ?? 'CocFloating'
    }
    this.nvim.call('coc#pum#create_pum', [lines, opt, config], true)
    this.nvim.redrawVim()
  }

  private buildItem(item: ExtendedCompleteItem, border: boolean, index: number, abbrWidth: number, kindWidth: number, menuWidth: number): [string, HighlightItem[]] {
    let text = border ? '' : ' '
    let hls: HighlightItem[] = []
    text += fillWidth(item.abbr, abbrWidth)
    if (item.positions) {
      let highlights = positionHighlights(item.abbr, item.positions.slice(), border ? 0 : 1, index)
      hls.push(...highlights)
      if (item.deprecated) {
        let start = border ? 0 : 1
        hls.push({
          hlGroup: 'CocPumDeprecated',
          lnum: index,
          colStart: start,
          colEnd: byteLength(text)
        })
      }
    }
    if (kindWidth > 0) {
      text += ' '
      let pre = byteLength(text)
      text += fillWidth(item.kind ?? '', kindWidth)
      if (item.kind && item.kindHighlight) {
        hls.push({
          hlGroup: item.kindHighlight,
          lnum: index,
          colStart: pre,
          colEnd: pre + byteLength(item.kind)
        })
      }
    }
    if (menuWidth > 0) {
      text += ' '
      let pre = byteLength(text)
      text += fillWidth(item.menu ?? '', menuWidth)
      if (item.menu) {
        hls.push({
          hlGroup: 'CocPumMenu',
          lnum: index,
          colStart: pre,
          colEnd: pre + byteLength(item.menu)
        })
      }
    }
    if (!border) text += ' '
    return [text, hls]
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

function fillWidth(text: string, width: number): string {
  let n = width - stringWidth(text)
  return n <= 0 ? text : text + ' '.repeat(n)
}
