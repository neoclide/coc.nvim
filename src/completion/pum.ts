import { Neovim } from '@chemzqm/neovim'
import { CompletionItemKind } from 'vscode-languageserver-protocol'
import { matchSpansReverse } from '../model/fuzzyMatch'
import sources from '../sources'
import { CompleteOption, DurationCompleteItem, Env, FloatConfig, HighlightItem } from '../types'
import { isFalsyOrEmpty } from '../util/array'
import { byteLength } from '../util/string'
import workspace from '../workspace'
import { anyScore } from '../util/filter'
import MruLoader, { Selection } from './mru'
import { getKindHighlight, getKindText, getValidWord, highlightOffert } from './util'

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

  private stringWidth(text: string, cache = false): number {
    return workspace.getDisplayWidth(text, cache)
  }

  public show(items: DurationCompleteItem[], search: string, option: CompleteOption): void {
    this._search = search
    let { noselect, enablePreselect, selection, virtualText, kindMap, defaultKindText } = this.config
    let followWord = option.followWord
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
      abbrWidth = Math.max(this.stringWidth(label.text, true), abbrWidth)
      if (item.kind) kindWidth = Math.max(this.stringWidth(getKindText(item.kind, kindMap, defaultKindText), true), kindWidth)
      if (item.menu) menuWidth = Math.max(this.stringWidth(item.menu, true), menuWidth)
      if (shortcut) shortcutWidth = Math.max(this.stringWidth(shortcut, true) + 2, shortcutWidth)
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
      selectedIndex = -1
    }
    let opt = {
      input: search,
      index: selectedIndex,
      bufnr: option.bufnr,
      line: option.linenr,
      col: option.col,
      virtualText,
      words: items.map(o => this.getInsertWord(o, search, followWord))
    }
    let pumConfig = this.pumConfig
    let lines: string[] = []
    let highlights: HighlightItem[] = []
    // create lines and highlights
    let width = 0
    let buildConfig: BuildConfig = { border: !!pumConfig.border, menuWidth, abbrWidth, kindWidth, shortcutWidth }
    this.adjustAbbrWidth(buildConfig)
    let lowInput = search.toLowerCase()
    for (let index = 0; index < items.length; index++) {
      let [displayWidth, text] = this.buildItem(search, lowInput, items[index], labels[index], highlights, index, buildConfig)
      width = Math.max(width, displayWidth)
      lines.push(text)
    }
    let config: PumConfig = Object.assign({ width, highlights }, pumConfig)
    this.nvim.call('coc#pum#create', [lines, opt, config], true)
    this.nvim.redrawVim()
  }

  private getInsertWord(item: DurationCompleteItem, search: string, followPart: string): string {
    let { fixInsertedWord, invalidInsertCharacters } = this.config
    let word = item.isSnippet ? getValidWord(item.word, invalidInsertCharacters) : item.word
    return fixInsertedWord ? fixFollow(word, search, followPart) : word
  }

  private getLabel(item: DurationCompleteItem): LabelWithDetail {
    let { labelDetails, detail } = item
    let { snippetIndicator, labelMaxLength, detailField, detailMaxLength } = this.config
    let label = item.abbr!
    let hls: HighlightRange[] = []
    if (item.isSnippet && !label.endsWith(snippetIndicator)) {
      label = label + snippetIndicator
    }
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

  private buildItem(input: string, lowInput: string, item: DurationCompleteItem, label: LabelWithDetail, hls: HighlightItem[], index: number, config: BuildConfig): [number, string] {
    // abbr menu kind shortcut
    let { labelMaxLength, formatItems, kindMap, defaultKindText } = this.config
    let text = config.border ? '' : ' '
    let len = byteLength(text)
    let displayWidth = text.length
    let append = (str: string, width: number): void => {
      let s = this.fillWidth(str, width)
      displayWidth += width
      len += byteLength(s)
      text += s
    }
    for (const name of formatItems) {
      switch (name) {
        case 'abbr': {
          if (!isFalsyOrEmpty(item.positions)) {
            let pre = highlightOffert(len, item)
            if (pre != -1) {
              positionHighlights(hls, item.abbr, item.positions, pre, index, labelMaxLength)
            } else {
              let score = anyScore(input, lowInput, 0, item.abbr, item.abbr.toLowerCase(), 0)
              if (score[0]) positionHighlights(hls, item.abbr, score, 0, index, labelMaxLength)
            }
          }
          let abbr = label.text
          let start = len
          append(abbr, config.abbrWidth + 1)
          label.highlights.forEach(hl => {
            hls.push({
              hlGroup: hl.hlGroup,
              lnum: index,
              colStart: start + hl.start,
              colEnd: start + hl.end
            })
          })
          if (item.deprecated) {
            hls.push({
              hlGroup: 'CocPumDeprecated',
              lnum: index,
              colStart: start,
              colEnd: len - 1,
            })
          }
          break
        }
        case 'menu': {
          if (config.menuWidth > 0) {
            let colStart = len
            append(item.menu ?? '', config.menuWidth + 1)
            if (item.menu) {
              hls.push({
                hlGroup: 'CocPumMenu',
                lnum: index,
                colStart,
                colEnd: colStart + byteLength(item.menu)
              })
            }
          }
          break
        }
        case 'kind':
          if (config.kindWidth > 0) {
            let { kind } = item
            let kindText = getKindText(kind, kindMap, defaultKindText)
            let colStart = len
            append(kindText ?? '', config.kindWidth + 1)
            if (kindText) {
              hls.push({
                hlGroup: getKindHighlight(kind),
                lnum: index,
                colStart,
                colEnd: colStart + byteLength(kindText)
              })
            }
          }
          break
        case 'shortcut':
          if (config.shortcutWidth > 0) {
            let colStart = len
            let shortcut = sources.getShortcut(item.source)
            append(shortcut ? `[${shortcut}]` : '', config.shortcutWidth + 1)
            if (shortcut) {
              hls.push({
                hlGroup: 'CocPumShortcut',
                lnum: index,
                colStart,
                colEnd: colStart + byteLength(shortcut) + 2
              })
            }
          }
          break
      }
    }
    return [displayWidth, text]
  }

  public fillWidth(text: string, width: number): string {
    let n = width - this.stringWidth(text)
    return text + ' '.repeat(Math.max(n, 0))
  }
}

export function fixFollow(word: string, search: string, follow: string): string {
  if (follow.length === 0) return word
  if (search.length + follow.length <= word.length && word.endsWith(follow)) {
    return word.slice(0, word.length - follow.length)
  }
  return word
}

/**
 * positions is FuzzyScore
 */
function positionHighlights(hls: HighlightItem[], label: string, positions: ArrayLike<number>, pre: number, line: number, max: number): void {
  for (let span of matchSpansReverse(label, positions, 2, max)) {
    hls.push({
      hlGroup: 'CocPumSearch',
      lnum: line,
      colStart: pre + span[0],
      colEnd: pre + span[1],
    })
  }
}
