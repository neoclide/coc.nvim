import { Neovim } from '@chemzqm/neovim'
import stringWidth from '@chemzqm/string-width'
import sources from '../sources'
import { CompleteOption, ExtendedCompleteItem, HighlightItem } from '../types'
import { byteIndex, byteLength } from '../util/string'
import { CompleteConfig } from './complete'
import MruLoader from './mru'
import { getFollowPart } from './util'
const logger = require('../util/logger')('completion-pum')

export interface PumDimension {
  readonly height: number
  readonly width: number
  readonly row: number
  readonly col: number
  readonly scrollbar: boolean
}

// 0 based col start & end
export interface HighlightRange {
  start: number
  end: number
  hlGroup: string
}

export interface LabelWithDetail {
  text: string
  highlights: HighlightRange[]
}

export interface BuildConfig {
  border: boolean
  abbrWidth: number
  menuWidth: number
  kindWidth: number
  shortcutWidth: number
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
  reverse?: boolean
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
    let { floatConfig, pumFloatConfig, reversePumAboveCursor } = this.config
    if (!pumFloatConfig) pumFloatConfig = floatConfig
    let obj: PumConfig = {}
    if (typeof pumFloatConfig.highlight === 'string') obj.highlight = pumFloatConfig.highlight
    if (typeof pumFloatConfig.winblend === 'number') obj.winblend = pumFloatConfig.winblend
    if (pumFloatConfig.shadow) obj.shadow = pumFloatConfig.shadow
    if (pumFloatConfig.border) {
      obj.border = [1, 1, 1, 1]
      obj.rounded = pumFloatConfig.rounded ? 1 : 0
      obj.borderhighlight = pumFloatConfig.borderhighlight ?? 'CocFloating'
    }
    obj.reverse = reversePumAboveCursor === true
    return obj
  }

  private stringWidth(text: string): number {
    return stringWidth(text, { ambiguousIsNarrow: this.config.ambiguousIsNarrow })
  }

  public show(items: ExtendedCompleteItem[], search: string, option: CompleteOption): void {
    this._search = search
    let { noselect, fixInsertedWord, enablePreselect, selection, virtualText } = this.config
    let followPart = getFollowPart(option)
    if (followPart.length === 0) fixInsertedWord = false
    let selectedIndex = enablePreselect ? items.findIndex(o => o.preselect) : -1
    let maxMru = -1
    let abbrWidth = 0
    let menuWidth = 0
    let kindWidth = 0
    let shortcutWidth = 0
    let checkMru = selectedIndex == -1 && selection != 'first'
    let labels: LabelWithDetail[] = []
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
      let shortcut = sources.getShortcut(item.source)
      let label = this.getLabel(item)
      labels.push(label)
      abbrWidth = Math.max(this.stringWidth(label.text), abbrWidth)
      if (item.kind) kindWidth = 1
      if (item.menu) menuWidth = Math.max(this.stringWidth(item.menu), menuWidth)
      if (shortcut) shortcutWidth = Math.max(this.stringWidth(shortcut) + 2, shortcutWidth)
    }
    if (selectedIndex !== -1 && search.length > 0) {
      let item = items[selectedIndex]
      if (!item.word?.startsWith(search)) {
        selectedIndex = -1
      }
    }
    if (!noselect) {
      selectedIndex = selectedIndex == -1 ? 0 : selectedIndex
    } else {
      if (selectedIndex > 0) {
        let [item] = items.splice(selectedIndex, 1)
        items.unshift(item)
      }
      selectedIndex == -1
    }
    let opt = {
      input: search,
      index: selectedIndex,
      bufnr: option.bufnr,
      line: option.linenr,
      col: option.col,
      virtualText,
      words: items.map(o => getWord(fixInsertedWord, search, o.word, followPart))
    }
    let pumConfig = this.pumConfig
    let lines: string[] = []
    let highlights: HighlightItem[] = []
    // create lines and highlights
    let width = 0
    let buildConfig: BuildConfig = { border: !!pumConfig.border, menuWidth, abbrWidth, kindWidth, shortcutWidth }
    this.adjustAbbrWidth(buildConfig)
    for (let index = 0; index < items.length; index++) {
      let text = this.buildItem(items[index], labels[index], highlights, index, buildConfig)
      width = Math.max(width, this.stringWidth(text))
      lines.push(text)
    }
    let config: PumConfig = Object.assign({ width, highlights }, pumConfig)
    this.nvim.call('coc#pum#create', [lines, opt, config], true)
    this.nvim.redrawVim()
  }

  private getLabel(item: ExtendedCompleteItem): LabelWithDetail {
    let { labelDetails } = item
    let { snippetIndicator, labelMaxLength } = this.config
    let abbr = item.abbr ?? ''
    let label = item.abbr ?? item.word
    let hls: HighlightRange[] = []
    if (labelDetails) {
      let added = (labelDetails.detail ?? '') + (labelDetails.description ? ` ${labelDetails.description}` : '')
      if (label.length + added.length <= labelMaxLength) {
        let start = byteLength(label)
        hls.push({
          start,
          end: start + byteLength(added),
          hlGroup: 'CocPumDetail'
        })
        label = label + added
        item.detailRendered = true
      }
    }
    if (item.isSnippet && !abbr.endsWith(snippetIndicator)) {
      label = label + snippetIndicator
    }
    if (label.length > labelMaxLength) {
      label = label.slice(0, labelMaxLength - 1) + '.'
    }
    return { text: label, highlights: hls }
  }

  private adjustAbbrWidth(config: BuildConfig): void {
    let { formatItems, pumwidth } = this.config
    let len = 0
    for (const item of formatItems) {
      if (item == 'abbr') {
        len += config.abbrWidth + 1
      } else if (item == 'menu' && config.menuWidth) {
        len += config.menuWidth + 1
      } else if (item == 'kind' && config.kindWidth) {
        len += config.kindWidth + 1
      } else if (item == 'shortcut' && config.shortcutWidth) {
        len += config.shortcutWidth + 1
      }
    }
    if (len < pumwidth) {
      config.abbrWidth = config.abbrWidth + pumwidth - len
    }
  }

  private buildItem(item: ExtendedCompleteItem, label: LabelWithDetail, hls: HighlightItem[], index: number, config: BuildConfig): string {
    // abbr menu kind shortcut
    let { labelMaxLength, formatItems } = this.config
    let text = config.border ? '' : ' '
    for (const name of formatItems) {
      switch (name) {
        case 'abbr': {
          let pre = byteLength(text)
          if (item.positions?.length > 0) {
            let positions = item.positions.filter(i => i < labelMaxLength)
            let highlights = positionHighlights(item.abbr, positions, pre, index)
            hls.push(...highlights)
          }
          let abbr = label.text
          text += this.fillWidth(abbr, config.abbrWidth + 1)
          label.highlights.forEach(hl => {
            hls.push({
              hlGroup: hl.hlGroup,
              lnum: index,
              colStart: pre + hl.start,
              colEnd: pre + hl.end
            })
          })
          if (item.deprecated) {
            hls.push({
              hlGroup: 'CocPumDeprecated',
              lnum: index,
              colStart: pre,
              colEnd: pre + byteLength(abbr)
            })
          }
          break
        }
        case 'menu': {
          if (config.menuWidth > 0) {
            let pre = byteLength(text)
            text += this.fillWidth(item.menu ?? '', config.menuWidth + 1)
            if (item.menu) {
              hls.push({
                hlGroup: 'CocPumMenu',
                lnum: index,
                colStart: pre,
                colEnd: pre + byteLength(item.menu)
              })
            }
          }
          break
        }
        case 'kind':
          if (config.kindWidth > 0) {
            let pre = byteLength(text)
            text += this.fillWidth(item.kind ?? '', config.kindWidth + 1)
            if (item.kind && item.kindHighlight) {
              hls.push({
                hlGroup: item.kindHighlight,
                lnum: index,
                colStart: pre,
                colEnd: pre + byteLength(item.kind)
              })
            }
          }
          break
        case 'shortcut':
          if (config.shortcutWidth > 0) {
            let pre = byteLength(text)
            let shortcut = sources.getShortcut(item.source)
            text += this.fillWidth(shortcut ? `[${shortcut}]` : '', config.shortcutWidth + 1)
            if (shortcut) {
              hls.push({
                hlGroup: 'CocPumShortcut',
                lnum: index,
                colStart: pre,
                colEnd: pre + byteLength(shortcut) + 2
              })
            }
          }
          break
      }
    }
    return text
  }

  private fillWidth(text: string, width: number): string {
    let n = width - this.stringWidth(text)
    return n <= 0 ? text : text + ' '.repeat(n)
  }
}

export function getWord(fixInsertedWord: boolean, search: string, word: string, followPart: string): string {
  if (!fixInsertedWord || word.length <= followPart.length || !word.endsWith(followPart)) return word
  if (word.length < search.length + followPart.length) return word
  return word.slice(0, word.length - followPart.length)
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
