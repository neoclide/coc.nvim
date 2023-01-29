'use strict'
import { Buffer, Neovim } from '@chemzqm/neovim'
import events from '../events'
import { createLogger } from '../logger'
import { HighlightItem, QuickPickItem } from '../types'
import { defaultValue, disposeAll } from '../util'
import { isFalsyOrEmpty, toArray } from '../util/array'
import { anyScore, fuzzyScoreGracefulAggressive, FuzzyScorer } from '../util/filter'
import { Disposable, Emitter, Event } from '../util/protocol'
import { byteLength, toText } from '../util/string'
import { DialogPreferences } from './dialog'
import { toSpans } from './fuzzyMatch'
import InputBox from './input'
import Popup from './popup'
import { StrWidth } from './strwidth'
const logger = createLogger('quickpick')

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
  public items: readonly T[]
  public activeItems: readonly T[]
  public selectedItems: T[]
  public value: string
  public canSelectMany = false
  public matchOnDescription = false
  public maxHeight = 30
  public width: number | undefined
  public placeholder: string | undefined
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
  constructor(private nvim: Neovim, private preferences: DialogPreferences = {}) {
    let items = []
    let input = this.input = new InputBox(this.nvim, '')
    if (preferences.maxHeight) this.maxHeight = preferences.maxHeight
    Object.defineProperty(this, 'items', {
      set: (list: T[]) => {
        items = toArray(list)
        this.selectedItems = items.filter(o => o.picked)
        this.filterItems('')
      },
      get: () => items
    })
    Object.defineProperty(this, 'activeItems', {
      set: (list: T[]) => {
        items = toArray(list)
        this.filteredItems = items
        this.showFilteredItems()
      },
      get: () => this.filteredItems
    })
    Object.defineProperty(this, 'value', {
      set: (value: string) => {
        this.input.value = value
      },
      get: () => this.input.value
    })
    Object.defineProperty(this, 'title', {
      set: (newTitle: string) => {
        input.title = toText(newTitle)
      },
      get: () => input.title ?? ''
    })
    Object.defineProperty(this, 'loading', {
      set: (loading: boolean) => {
        input.loading = loading
      },
      get: () => input.loading
    })
    input.onDidChange(value => {
      this._changed = false
      this._onDidChangeValue.fire(value)
      // List already update by change items or activeItems
      if (this._changed) {
        this._changed = false
        return
      }
      this.filterItems(value)
    }, this)
    input.onDidFinish(this.onFinish, this)
  }

  public get maxWidth(): number {
    return this.preferences.maxWidth ?? 80
  }

  public get currIndex(): number {
    return this.win ? this.win.currIndex : 0
  }

  public get buffer(): Buffer {
    return this.bufnr ? this.nvim.createBuffer(this.bufnr) : undefined
  }

  public get winid(): number | undefined {
    return this.win?.winid
  }

  public setCursor(index: number): void {
    this.win?.setCursor(index, true)
  }

  private attachEvents(inputBufnr: number): void {
    events.on('BufWinLeave', bufnr => {
      if (bufnr == this.bufnr) {
        this.bufnr = undefined
        this.win = undefined
      }
    }, null, this.disposables)
    events.on('PromptKeyPress', async (bufnr, key) => {
      if (bufnr == inputBufnr) {
        if (key == '<C-f>') {
          await this.win.scrollForward()
        } else if (key == '<C-b>') {
          await this.win.scrollBackward()
        } else if (['<C-j>', '<C-n>', '<down>'].includes(key)) {
          this.setCursor(this.currIndex + 1)
        } else if (['<C-k>', '<C-p>', '<up>'].includes(key)) {
          this.setCursor(this.currIndex - 1)
        } else if (this.canSelectMany && key == '<C-@>') {
          this.toggePicked(this.currIndex)
        }
      }
    }, null, this.disposables)
  }

  public async show(): Promise<void> {
    let { nvim, items, input, width, preferences, maxHeight } = this
    let { lines, highlights } = this.buildList(items, input.value)
    let minWidth: number | undefined
    let lincount = 0
    const sw = await StrWidth.create()
    if (typeof width === 'number') minWidth = Math.min(width, this.maxWidth)
    let max = 40
    lines.forEach(line => {
      let w = sw.getWidth(line)
      if (typeof minWidth === 'number') {
        lincount += Math.ceil(w / minWidth)
      } else {
        if (w >= 80) {
          minWidth = 80
          lincount += Math.ceil(w / minWidth)
        } else {
          max = Math.max(max, w)
          lincount += 1
        }
      }
    })
    if (minWidth === undefined) minWidth = max
    let rounded = !!preferences.rounded
    await input.show(this.title, {
      position: 'center',
      placeHolder: this.placeholder,
      marginTop: 10,
      border: [1, 1, 0, 1],
      list: true,
      rounded,
      minWidth,
      maxWidth: this.maxWidth,
      highlight: preferences.floatHighlight,
      borderhighlight: preferences.floatBorderHighlight
    })
    let opts: any = { lines, rounded, maxHeight, highlights, linecount: Math.max(1, lincount) }
    opts.highlight = defaultValue(preferences.floatHighlight, undefined)
    opts.borderhighlight = defaultValue(preferences.floatBorderHighlight, undefined)
    let res = await nvim.call('coc#dialog#create_list', [input.winid, input.dimension, opts])
    if (!res) throw new Error('Unable to open list window.')
    // let height
    this.win = new Popup(nvim, res[0], res[1], lines.length)
    this.win.refreshScrollbar()
    this.bufnr = res[1]
    this.setCursor(0)
    this.attachEvents(input.bufnr)
  }

  private buildList(items: ReadonlyArray<T>, input: string, loose = false): { lines: string[], highlights: HighlightItem[] } {
    let { selectedItems, canSelectMany } = this
    let filteredItems: T[] = []
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
        if (!res) continue
        // keep the order for loose match
        score = loose ? 0 : res[0]
        spans = toSpans(filterText, res)
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
    this.filteredItems = filteredItems
    return { lines, highlights }
  }

  /**
   * Filter items, does highlight only when loose is true
   */
  private _filter(items: ReadonlyArray<T>, input: string, loose = false): void {
    if (!this.win) return
    this._changed = true
    let { lines, highlights } = this.buildList(items, input, loose)
    this.nvim.call('coc#dialog#update_list', [this.win.winid, this.win.bufnr, lines, highlights], true)
    this.win.linecount = lines.length
    this.setCursor(0)
  }

  /**
   * Filter items with input
   */
  public filterItems(input: string): void {
    this._filter(this.items, input)
  }

  public showFilteredItems(): void {
    let { input, filteredItems } = this
    this._filter(filteredItems, input.value, true)
  }

  private onFinish(input: string | undefined): void {
    let items = input == null ? null : this.getSelectedItems()
    if (!this.canSelectMany && input !== undefined && !isFalsyOrEmpty(items)) {
      this._onDidChangeSelection.fire(items)
    }
    this.nvim.call('coc#float#close', [this.winid], true)
    // needed to make sure window closed
    setTimeout(() => {
      this._onDidFinish.fire(items)
      this.dispose()
    }, 30)
  }

  private getSelectedItems(): T[] {
    let { canSelectMany } = this
    if (canSelectMany) return this.selectedItems
    return toArray(this.filteredItems[this.currIndex])
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
    let { canSelectMany } = this
    let line = `${canSelectMany ? '    ' : ''}${label.replace(/\r?\n/, '')}`
    return this.matchOnDescription ? line + ' ' + (description ?? '') : line
  }

  public dispose(): void {
    this.bufnr = undefined
    this.input.dispose()
    this.win?.close()
    this._onDidFinish.dispose()
    this._onDidChangeSelection.dispose()
    disposeAll(this.disposables)
  }
}
