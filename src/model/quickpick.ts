'use strict'
import { Buffer, Neovim } from '@chemzqm/neovim'
import { Disposable, Emitter, Event } from 'vscode-languageserver-protocol'
import events from '../events'
import { HighlightItem, QuickPickItem } from '../types'
import { disposeAll } from '../util'
import { toArray } from '../util/array'
import { anyScore, fuzzyScoreGracefulAggressive, FuzzyScorer } from '../util/filter'
import { byteLength } from '../util/string'
import { DialogPreferences } from './dialog'
import { toSpans } from './fuzzyMatch'
import InputBox from './input'
import Popup from './popup'
import { StrWidth } from './strwidth'
const logger = require('../util/logger')('model-quickpick')

export interface QuickPickConfig<T extends QuickPickItem> {
  title?: string
  items: readonly T[]
  value?: string
  canSelectMany?: boolean
  maxHeight?: number
}

interface FilteredLine {
  line: string
  score: number
  index: number
  spans: [number, number][]
  descriptionSpan?: [number, number]
}

/**
 * Pick single/multiple items from prompt list.
 */
export default class QuickPick<T extends QuickPickItem> {
  public title: string
  public loading: boolean
  public matchOnDescription: boolean
  public items: readonly T[]
  public activeItems: readonly T[]
  public selectedItems: T[]
  private bufnr: number
  private win: Popup
  private filteredItems: readonly T[] = []
  private disposables: Disposable[] = []
  private input: InputBox | undefined
  private _changed = false
  // emitted with selected items or undefined when cancelled.
  private readonly _onDidFinish = new Emitter<T[] | null>()
  private readonly _onDidChangeSelection = new Emitter<ReadonlyArray<T>>()
  private readonly _onDidChangeValue = new Emitter<string>()
  public readonly onDidFinish: Event<T[] | null> = this._onDidFinish.event
  public readonly onDidChangeSelection: Event<ReadonlyArray<T>> = this._onDidChangeSelection.event
  public readonly onDidChangeValue: Event<string> = this._onDidChangeValue.event
  constructor(private nvim: Neovim, private config: QuickPickConfig<T>) {
    let items = config.items ?? []
    Object.defineProperty(this, 'items', {
      set: (list: T[]) => {
        this._changed = true
        items = list
        this.filterItems('')
      },
      get: () => {
        return items
      }
    })
    Object.defineProperty(this, 'activeItems', {
      set: (list: T[]) => {
        this._changed = true
        this.filteredItems = list
        this.selectedItems = list.filter(o => o.picked)
        this.showFilteredItems()
      },
      get: () => {
        return this.filteredItems
      }
    })
    Object.defineProperty(this, 'title', {
      set: (newTitle: string) => {
        if (this.input) this.input.title = newTitle
      },
      get: () => {
        return this.input ? this.input.title : config.title
      }
    })
    Object.defineProperty(this, 'loading', {
      set: (loading: boolean) => {
        if (this.input) this.input.loading = loading
      },
      get: () => {
        return this.input ? this.input.loading : false
      }
    })
  }

  /**
   * Current input value
   */
  public get value(): string {
    return this.input ? this.input.value : this.config.value ?? ''
  }

  public get currIndex(): number {
    return this.win ? this.win.currIndex : 0
  }

  public get buffer(): Buffer {
    return this.bufnr ? this.nvim.createBuffer(this.bufnr) : undefined
  }

  public setCursor(index: number): void {
    if (this.win) this.win.setCursor(index, true)
  }

  private attachEvents(inputBufnr: number): void {
    events.on('BufWinLeave', bufnr => {
      if (bufnr == this.bufnr) {
        this.dispose()
      }
    }, null, this.disposables)
    events.on('PromptKeyPress', async (bufnr, key) => {
      if (bufnr == inputBufnr) {
        if (key == 'C-f') {
          await this.win.scrollForward()
        } else if (key == 'C-b') {
          await this.win.scrollBackward()
        } else if (['C-j', 'C-n', 'down'].includes(key)) {
          this.setCursor(this.currIndex + 1)
        } else if (['C-k', 'C-p', 'up'].includes(key)) {
          this.setCursor(this.currIndex - 1)
        } else if (this.config.canSelectMany && key == 'C-@') {
          this.toggePicked(this.currIndex)
        }
      }
    }, null, this.disposables)
  }

  public async show(preferences: DialogPreferences = {}): Promise<void> {
    let { nvim, items } = this
    let { title, canSelectMany, value } = this.config
    let lines: string[] = []
    let highlights: HighlightItem[] = []
    let selectedItems: T[] = []
    for (let i = 0; i < items.length; i++) {
      let item = items[i]
      let line = canSelectMany ? `[${item.picked ? 'x' : ' '}] ${item.label}` : item.label
      if (item.picked) selectedItems.push(item)
      if (item.description) {
        let start = byteLength(line)
        line = line + ` ${item.description}`
        highlights.push({ hlGroup: 'Comment', lnum: i, colStart: start, colEnd: byteLength(line) })
      }
      lines.push(line)
    }
    let input = this.input = new InputBox(this.nvim, value ?? '')
    input.onDidChange(value => {
      this._onDidChangeValue.fire(value)
      // Updated by extension
      if (this._changed) {
        this._changed = false
        return
      }
      this.filterItems(value)
    }, this)
    input.onDidFinish(this.onFinish, this)
    let sw = await StrWidth.create()
    let minWidth = Math.max(40, Math.min(80, lines.reduce<number>((p, c) => Math.max(p, sw.getWidth(c)), 0)))
    await input.show(title ?? '', {
      position: 'center',
      marginTop: 10,
      border: [1, 1, 0, 1],
      list: true,
      minWidth,
      maxWidth: preferences.maxWidth || 80,
      rounded: !!preferences.rounded,
      highlight: preferences.floatHighlight,
      borderhighlight: preferences.floatBorderHighlight
    })
    this.selectedItems = selectedItems
    let opts: any = { lines, rounded: !!preferences.rounded }
    opts.highlights = highlights
    if (preferences.floatHighlight) opts.highlight = preferences.floatHighlight
    if (preferences.floatBorderHighlight) opts.borderhighlight = preferences.floatBorderHighlight
    let maxHeight = this.config.maxHeight || preferences.maxHeight
    if (maxHeight) opts.maxHeight = maxHeight
    let res = await nvim.call('coc#dialog#create_list', [input.winid, input.dimension, opts])
    if (!res) throw new Error('Unable to open list window.')
    this.filteredItems = items
    // let height
    this.win = new Popup(nvim, res[0], res[1], lines.length)
    this.win.refreshScrollbar()
    this.bufnr = res[1]
    let idx = canSelectMany || selectedItems.length == 0 ? 0 : items.indexOf(selectedItems[0])
    this.setCursor(idx)
    this.attachEvents(input.bufnr)
  }

  /**
   * Filter items, does highlight only when loose is true
   */
  private _filter(items: ReadonlyArray<T>, input: string, loose = false): void {
    let { selectedItems } = this
    let filteredItems: T[] = []
    let { canSelectMany } = this.config
    let filtered: FilteredLine[] = []
    let emptyInput = input.length === 0
    let lowInput = input.toLowerCase()
    const scoreFn: FuzzyScorer = loose ? anyScore : fuzzyScoreGracefulAggressive
    const wordPos = canSelectMany ? 4 : 0
    for (let index = 0; index < items.length; index++) {
      const item = items[index]
      let filterText = this.toFilterText(item)
      let spans: [number, number][] = []
      let score = 0
      let descriptionSpan: [number, number] | undefined
      if (!emptyInput) {
        let res = scoreFn(input, lowInput, 0, filterText, filterText.toLowerCase(), wordPos, { boostFullMatch: false, firstMatchCanBeWeak: true })
        if (!res && !loose) continue
        // keep the order for loose match
        score = loose ? 0 : res[0]
        if (res) spans = toSpans(filterText, res)
      }
      let picked = selectedItems.includes(item)
      let line = canSelectMany ? `[${picked ? 'x' : ' '}] ${item.label}` : item.label
      if (item.description) {
        let start = byteLength(line)
        line = line + ` ${item.description}`
        descriptionSpan = [start, start + 1 + byteLength(item.description)]
      }
      let lineItem: FilteredLine = { line, descriptionSpan, index, score, spans }
      filtered.push(lineItem)
    }
    let lines: string[] = []
    let highlights: HighlightItem[] = []
    filtered.sort((a, b) => {
      if (a.score != b.score) return b.score - a.score
      return a.index - b.index
    })
    const toHighlight = (lnum: number, span: [number, number], hlGroup: string, pre: number) => {
      return { lnum, colStart: span[0] + pre, colEnd: span[1] + pre, hlGroup }
    }
    filtered.forEach((item, index) => {
      lines.push(item.line)
      item.spans.forEach(span => {
        highlights.push(toHighlight(index, span, 'CocSearch', wordPos))
      })
      if (item.descriptionSpan) {
        highlights.push(toHighlight(index, item.descriptionSpan, 'Comment', 0))
      }
      filteredItems.push(items[item.index])
    })
    this.win.linecount = lines.length
    this.nvim.call('coc#dialog#update_list', [this.win.winid, this.win.bufnr, lines, highlights], true)
    this.setCursor(0)
    this.filteredItems = filteredItems
  }
  /**
   * Filter items with input
   */
  public filterItems(input: string): void {
    let { items, win } = this
    if (!win) return
    this._filter(items, input)
  }

  public showFilteredItems(): void {
    let { win, input, filteredItems } = this
    if (!win) return
    this._filter(filteredItems, input.value, true)
  }

  private onFinish(input: string | undefined): void {
    if (input == null) {
      this._onDidChangeSelection.fire([])
      this._onDidFinish.fire(null)
      return
    }
    let selected = this.getSelectedItems()
    if (!this.config.canSelectMany) {
      this._onDidChangeSelection.fire(selected)
    }
    this._onDidFinish.fire(selected)
  }

  private getSelectedItems(): T[] {
    let { win } = this
    let { canSelectMany } = this.config
    if (canSelectMany) return this.selectedItems
    let item = this.filteredItems[win.currIndex]
    return toArray(item)
  }

  public toggePicked(index: number): void {
    let { nvim, filteredItems, selectedItems } = this
    let item = filteredItems[index]
    if (!item) return
    let idx = selectedItems.indexOf(item)
    if (idx != -1) {
      selectedItems.splice(idx, 1)
    } else {
      selectedItems.push(item)
    }
    let text = idx == -1 ? 'x' : ' '
    nvim.pauseNotification()
    this.win.execute(`normal! ^1lr${text}`)
    this.win.setCursor(this.win.currIndex + 1)
    nvim.resumeNotification(true, true)
    this._onDidChangeSelection.fire(selectedItems)
  }

  private toFilterText(item: T): string {
    let { label, description } = item
    let { canSelectMany } = this.config
    let line = `${canSelectMany ? '    ' : ''}${label.replace(/\r?\n/, '')}`
    return this.matchOnDescription ? line + ' ' + (description ?? '') : line
  }

  public dispose(): void {
    this.bufnr = undefined
    this.input?.dispose()
    this.win?.close()
    this._onDidFinish.dispose()
    this._onDidChangeSelection.dispose()
    disposeAll(this.disposables)
  }
}
