import { Neovim } from '@chemzqm/neovim'
import stringWidth from '@chemzqm/string-width'
import { CompletionItemKind } from 'vscode-languageserver-protocol'
import sources from '../sources'
import { CompleteOption, Env, ExtendedCompleteItem, FloatConfig, HighlightItem } from '../types'
import { byteLength } from '../util/string'
import MruLoader, { Selection } from './mru'
import { getFollowPart, getValidWord, positionHighlights } from './util'
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

export interface PopupMenuConfig {
  kindMap: Map<CompletionItemKind, string>
  defaultKindText: string
  noselect: boolean
  selection: Selection
  enablePreselect: boolean
  fixInsertedWord: boolean
  floatConfig: FloatConfig
  pumFloatConfig?: FloatConfig
  formatItems: ReadonlyArray<string>
  labelMaxLength: number
  reversePumAboveCursor: boolean
  snippetIndicator: string
  virtualText: boolean
  detailMaxLength: number
  detailField: string
  invalidInsertCharacters: string[]
}

const highlightsMap = {
  [CompletionItemKind.Text]: 'CocSymbolText',
  [CompletionItemKind.Method]: 'CocSymbolMethod',
  [CompletionItemKind.Function]: 'CocSymbolFunction',
  [CompletionItemKind.Constructor]: 'CocSymbolConstructor',
  [CompletionItemKind.Field]: 'CocSymbolField',
  [CompletionItemKind.Variable]: 'CocSymbolVariable',
  [CompletionItemKind.Class]: 'CocSymbolClass',
  [CompletionItemKind.Interface]: 'CocSymbolInterface',
  [CompletionItemKind.Module]: 'CocSymbolModule',
  [CompletionItemKind.Property]: 'CocSymbolProperty',
  [CompletionItemKind.Unit]: 'CocSymbolUnit',
  [CompletionItemKind.Value]: 'CocSymbolValue',
  [CompletionItemKind.Enum]: 'CocSymbolEnum',
  [CompletionItemKind.Keyword]: 'CocSymbolKeyword',
  [CompletionItemKind.Snippet]: 'CocSymbolSnippet',
  [CompletionItemKind.Color]: 'CocSymbolColor',
  [CompletionItemKind.File]: 'CocSymbolFile',
  [CompletionItemKind.Reference]: 'CocSymbolReference',
  [CompletionItemKind.Folder]: 'CocSymbolFolder',
  [CompletionItemKind.EnumMember]: 'CocSymbolEnumMember',
  [CompletionItemKind.Constant]: 'CocSymbolConstant',
  [CompletionItemKind.Struct]: 'CocSymbolStruct',
  [CompletionItemKind.Event]: 'CocSymbolEvent',
  [CompletionItemKind.Operator]: 'CocSymbolOperator',
  [CompletionItemKind.TypeParameter]: 'CocSymbolTypeParameter',
}

export default class PopupMenu {
  private _search = ''
  private _pumConfig: PumConfig
  constructor(
    private nvim: Neovim,
    private config: PopupMenuConfig,
    private env: Env,
    private mruLoader: MruLoader
  ) {
  }

  public get search(): string {
    return this._search
  }

  public reset(): void {
    this._search = ''
    this._pumConfig = undefined
  }

  public get pumConfig(): PumConfig {
    if (this._pumConfig) return this._pumConfig
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
    this._pumConfig = obj
    return obj
  }

  private stringWidth(text: string): number {
    return stringWidth(text, { ambiguousIsNarrow: this.env.ambiguousIsNarrow })
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
    let checkMru = selectedIndex == -1 && !noselect && selection != 'first'
    let labels: LabelWithDetail[] = []
    // abbr kind, menu
    for (let i = 0; i < items.length; i++) {
      let item = items[i]
      if (checkMru) {
        let n = this.mruLoader.getScore(search, item, selection)
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
      if (!item.word.startsWith(search)) {
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
      words: items.map(o => this.getInsertWord(o, search, followPart))
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

  private getInsertWord(item: ExtendedCompleteItem, search: string, followPart: string): string {
    let { fixInsertedWord, invalidInsertCharacters } = this.config
    let { word, isSnippet } = item
    word = isSnippet ? getValidWord(word, invalidInsertCharacters) : word
    if (fixInsertedWord && followPart.length > 0 && word.slice(search.length).endsWith(followPart)) {
      word = word.slice(0, word.length - followPart.length)
    }
    return word
  }

  private getLabel(item: ExtendedCompleteItem): LabelWithDetail {
    let { labelDetails, detail } = item
    let { snippetIndicator, labelMaxLength, detailField, detailMaxLength } = this.config
    let abbr = item.abbr ?? ''
    let label = item.abbr ?? item.word
    let hls: HighlightRange[] = []
    if (detailField === 'abbr' && detail && !labelDetails && detail.length < detailMaxLength) {
      labelDetails = { detail: ' ' + detail.replace(/\r?\n\s*/g, ' ') }
    }
    if (labelDetails) {
      let added = (labelDetails.detail ?? '') + (labelDetails.description ? ` ${labelDetails.description}` : '')
      if (label.length + added.length <= labelMaxLength) {
        let start = byteLength(label)
        hls.push({ start, end: start + byteLength(added), hlGroup: 'CocPumDetail' })
        label = label + added
        item.detailRendered = true
      }
    }
    if ((item.isSnippet || item.additionalEdits) && !abbr.endsWith(snippetIndicator)) {
      label = label + snippetIndicator
    }
    if (label.length > labelMaxLength) {
      label = label.slice(0, labelMaxLength - 1) + '.'
    }
    return { text: label, highlights: hls }
  }

  private adjustAbbrWidth(config: BuildConfig): void {
    let { formatItems } = this.config
    let pumwidth = this.env.pumwidth || 15
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
    let { labelMaxLength, formatItems, kindMap, defaultKindText } = this.config
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
            let { kind } = item
            let kindText = typeof kind === 'number' ? kindMap.get(kind) ?? defaultKindText : kind
            text += this.fillWidth(kindText ?? '', config.kindWidth + 1)
            if (kindText) {
              let highlight = typeof kind === 'number' ? highlightsMap[kind] ?? 'CocSymbolDefault' : 'CocSymbolDefault'
              hls.push({
                hlGroup: highlight,
                lnum: index,
                colStart: pre,
                colEnd: pre + byteLength(kindText)
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
