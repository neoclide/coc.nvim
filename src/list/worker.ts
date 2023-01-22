'use strict'
import { createLogger } from '../logger'
import { FuzzyMatch } from '../model/fuzzyMatch'
import { defaultValue } from '../util'
import { parseAnsiHighlights } from '../util/ansiparse'
import { toArray } from '../util/array'
import { filter } from '../util/async'
import { patchLine } from '../util/diff'
import { fuzzyMatch, getCharCodes } from '../util/fuzzy'
import { Mutex } from '../util/mutex'
import { CancellationToken, CancellationTokenSource, Emitter, Event } from '../util/protocol'
import { bytes, smartcaseIndex, toText } from '../util/string'
import workspace from '../workspace'
import listConfiguration from './configuration'
import Prompt from './prompt'
import { IList, ListContext, ListItem, ListItemsEvent, ListItemWithScore, ListOptions, ListTask } from './types'
const logger = createLogger('list-worker')
const controlCode = '\x1b'
const WHITE_SPACE_CHARS = [32, 9]
const SERCH_HL_GROUP = 'CocListSearch'

export interface FilterOption {
  append?: boolean
  reload?: boolean
}

export type OnFilter = (arr: ListItem[], finished: boolean, sort?: boolean) => void

// perform loading task
export default class Worker {
  private _loading = false
  private _finished = false
  private mutex: Mutex = new Mutex()
  private filteredCount: number
  private totalItems: ListItem[] = []
  private tokenSource: CancellationTokenSource
  private filterTokenSource: CancellationTokenSource
  private _onDidChangeItems = new Emitter<ListItemsEvent>()
  private _onDidChangeLoading = new Emitter<boolean>()
  private fuzzyMatch: FuzzyMatch
  public readonly onDidChangeItems: Event<ListItemsEvent> = this._onDidChangeItems.event
  public readonly onDidChangeLoading: Event<boolean> = this._onDidChangeLoading.event

  constructor(
    private list: IList,
    private prompt: Prompt,
    private listOptions: ListOptions
  ) {
    this.fuzzyMatch = workspace.createFuzzyMatch()
  }

  private set loading(loading: boolean) {
    if (this._loading == loading) return
    this._loading = loading
    this._onDidChangeLoading.fire(loading)
  }

  public get isLoading(): boolean {
    return this._loading
  }

  public async loadItems(context: ListContext, reload = false): Promise<void> {
    this.cancelFilter()
    this.filteredCount = 0
    this._finished = false
    let { list, listOptions } = this
    this.loading = true
    let { interactive } = listOptions
    this.tokenSource = new CancellationTokenSource()
    let token = this.tokenSource.token
    let items = await list.loadItems(context, token)
    if (token.isCancellationRequested) return
    items = items ?? []
    if (Array.isArray(items)) {
      this.tokenSource = null
      this.totalItems = items
      this.loading = false
      this._finished = true
      let filtered: ListItem[]
      if (!interactive) {
        this.filterTokenSource = new CancellationTokenSource()
        await this.mutex.use(async () => {
          await this.filterItems(items as ListItem[], { reload }, token)
        })
      } else {
        filtered = this.convertToHighlightItems(items)
        this._onDidChangeItems.fire({
          sorted: true,
          items: filtered,
          reload,
          finished: true
        })
      }
    } else {
      let task = items as ListTask
      let totalItems = this.totalItems = []
      let taken = 0
      let currInput = context.input
      this.filterTokenSource = new CancellationTokenSource()
      let _onData = async (finished?: boolean) => {
        await this.mutex.use(async () => {
          let inputChanged = this.input != currInput
          if (inputChanged) {
            currInput = this.input
            taken = defaultValue(this.filteredCount, 0)
          }
          if (taken >= totalItems.length) return
          let append = taken > 0
          let remain = totalItems.slice(taken)
          taken = totalItems.length
          if (!interactive) {
            let tokenSource = this.filterTokenSource
            await this.filterItems(remain, { append, reload }, tokenSource.token)
          } else {
            let items = this.convertToHighlightItems(remain)
            this._onDidChangeItems.fire({ items, append, reload, sorted: true, finished })
          }
        })
      }
      let interval = setInterval(async () => {
        await _onData()
      }, 50)
      task.on('data', item => {
        totalItems.push(item)
      })
      let onEnd = async () => {
        if (task == null) return
        clearInterval(interval)
        this.tokenSource = null
        task = null
        this.loading = false
        this._finished = true
        disposable.dispose()
        if (token.isCancellationRequested) return
        if (totalItems.length == 0) {
          this._onDidChangeItems.fire({ items: [], append: false, sorted: true, reload, finished: true })
          return
        }
        await _onData(true)
      }
      let disposable = token.onCancellationRequested(() => {
        this.mutex.reset()
        task?.dispose()
        void onEnd()
      })
      let toDispose = task
      task.on('error', async (error: Error | string) => {
        if (task == null) return
        task = null
        toDispose.dispose()
        this.tokenSource = null
        this.loading = false
        disposable.dispose()
        clearInterval(interval)
        workspace.nvim.call('coc#prompt#stop_prompt', ['list'], true)
        workspace.nvim.echoError(`Task error: ${error.toString()}`)
        logger.error('List task error:', error)
      })
      task.on('end', onEnd)
    }
  }

  /*
   * Draw all items with filter if necessary
   */
  public async drawItems(): Promise<void> {
    let { totalItems } = this
    if (totalItems.length === 0) return
    this.cancelFilter()
    let tokenSource = this.filterTokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    await this.mutex.use(async () => {
      if (token.isCancellationRequested) return
      let { totalItems } = this
      this.filteredCount = totalItems.length
      await this.filterItems(totalItems, {}, tokenSource.token)
    })
  }

  public cancelFilter(): void {
    if (this.filterTokenSource) {
      this.filterTokenSource.cancel()
      this.filterTokenSource = null
    }
  }

  public stop(): void {
    this.cancelFilter()
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = null
    }
    this.loading = false
  }

  public get length(): number {
    return this.totalItems.length
  }

  private get input(): string {
    return this.prompt.input
  }

  /**
   * Add highlights for interactive list
   */
  private convertToHighlightItems(items: ListItem[]): ListItem[] {
    let input = toText(this.input)
    if (input.length > 0) this.fuzzyMatch.setPattern(input)
    let res = items.map(item => {
      convertItemLabel(item)
      let search = input.length > 0 && item.filterText !== ''
      if (search) {
        let filterLabel = getFilterLabel(item)
        let results = this.fuzzyMatch.matchHighlights(filterLabel, SERCH_HL_GROUP)
        item.ansiHighlights = Array.isArray(item.ansiHighlights) ? item.ansiHighlights.filter(o => o.hlGroup !== SERCH_HL_GROUP) : []
        if (results) item.ansiHighlights.push(...results.highlights)
      }
      return item
    })
    this.fuzzyMatch.free()
    return res
  }

  private async filterItemsByInclude(input: string, items: ListItem[], token: CancellationToken, onFilter: OnFilter): Promise<void> {
    let { ignorecase } = this.listOptions
    const smartcase = listConfiguration.smartcase
    let inputs = toInputs(input, listConfiguration.extendedSearchMode)
    if (ignorecase) inputs = inputs.map(s => s.toLowerCase())
    await filter(items, item => {
      convertItemLabel(item)
      let spans: [number, number][] = []
      let filterLabel = getFilterLabel(item)
      let byteIndex = bytes(filterLabel)
      let curr = 0
      item.ansiHighlights = toArray(item.ansiHighlights).filter(o => o.hlGroup !== SERCH_HL_GROUP)
      for (let input of inputs) {
        let label = filterLabel.slice(curr)
        let idx = indexOf(label, input, smartcase, ignorecase)
        if (idx === -1) break
        let end = idx + curr + input.length
        spans.push([byteIndex(idx + curr), byteIndex(end)])
        curr = end
      }
      if (spans.length !== inputs.length) return false
      item.ansiHighlights.push(...spans.map(s => {
        return { span: s, hlGroup: SERCH_HL_GROUP }
      }))
      return true
    }, onFilter, token)
  }

  private async filterItemsByRegex(input: string, items: ListItem[], token: CancellationToken, onFilter: OnFilter): Promise<void> {
    let { ignorecase } = this.listOptions
    let flags = ignorecase ? 'iu' : 'u'
    let inputs = toInputs(input, listConfiguration.extendedSearchMode)
    let regexes = inputs.reduce((p, c) => {
      try { p.push(new RegExp(c, flags)) } catch (e) {}
      return p
    }, [])
    await filter(items, item => {
      convertItemLabel(item)
      item.ansiHighlights = toArray(item.ansiHighlights).filter(o => o.hlGroup !== SERCH_HL_GROUP)
      let spans: [number, number][] = []
      let filterLabel = getFilterLabel(item)
      let byteIndex = bytes(filterLabel)
      let curr = 0
      for (let regex of regexes) {
        let ms = filterLabel.slice(curr).match(regex)
        if (ms == null) break
        let end = ms.index + curr + ms[0].length
        spans.push([byteIndex(ms.index + curr), byteIndex(end)])
        curr = end
      }
      if (spans.length !== inputs.length) return false
      item.ansiHighlights.push(...spans.map(s => {
        return { span: s, hlGroup: SERCH_HL_GROUP }
      }))
      return true
    }, onFilter, token)
  }

  private async filterItemsByFuzzyMatch(input: string, items: ListItem[], token: CancellationToken, onFilter: OnFilter): Promise<void> {
    let { extendedSearchMode, smartcase } = listConfiguration
    let { sort } = this.listOptions
    let idx = 0
    this.fuzzyMatch.setPattern(input, !extendedSearchMode)
    let codes = getCharCodes(input)
    if (extendedSearchMode) codes = codes.filter(c => !WHITE_SPACE_CHARS.includes(c))
    await filter(items, item => {
      convertItemLabel(item)
      let filterLabel = getFilterLabel(item)
      let match = this.fuzzyMatch.matchHighlights(filterLabel, SERCH_HL_GROUP)
      if (!match || (smartcase && !fuzzyMatch(codes, filterLabel))) return false
      let ansiHighlights = Array.isArray(item.ansiHighlights) ? item.ansiHighlights.filter(o => o.hlGroup != SERCH_HL_GROUP) : []
      ansiHighlights.push(...match.highlights)
      return {
        sortText: typeof item.sortText === 'string' ? item.sortText : String.fromCharCode(idx),
        score: match.score,
        ansiHighlights
      }
    }, (items, done) => {
      onFilter(items, done, sort)
    }, token)
  }

  private async filterItems(arr: ListItem[], opts: FilterOption, token: CancellationToken): Promise<void> {
    let { input } = this
    if (input.length === 0) {
      let items = arr.map(item => {
        return convertItemLabel(item)
      })
      this._onDidChangeItems.fire({ items, sorted: true, finished: this._finished, ...opts })
      return
    }
    let called = false
    let itemsToSort: ListItemWithScore[] = []
    const onFilter = (items: ListItemWithScore[], done: boolean, sort?: boolean) => {
      let finished = done && this._finished
      if (token.isCancellationRequested || (!finished && items.length == 0)) return
      if (sort) {
        itemsToSort.push(...items)
        if (done) this._onDidChangeItems.fire({ items: itemsToSort, append: false, sorted: false, reload: opts.reload, finished })
      } else {
        let append = opts.append === true || called
        called = true
        this._onDidChangeItems.fire({ items, append, sorted: true, reload: opts.reload, finished })
      }
    }
    switch (this.listOptions.matcher) {
      case 'strict':
        await this.filterItemsByInclude(input, arr, token, onFilter)
        break
      case 'regex':
        await this.filterItemsByRegex(input, arr, token, onFilter)
        break
      default:
        await this.filterItemsByFuzzyMatch(input, arr, token, onFilter)
    }
  }

  public dispose(): void {
    this.stop()
  }
}

function getFilterLabel(item: ListItem): string {
  return item.filterText != null ? patchLine(item.filterText, item.label) : item.label
}

export function toInputs(input: string, extendedSearchMode: boolean): string[] {
  return extendedSearchMode ? parseInput(input) : [input]
}

export function convertItemLabel(item: ListItem): ListItem {
  let { label, converted } = item
  if (converted) return item
  if (label.includes('\n')) {
    label = item.label = label.replace(/\r?\n.*/gm, '')
  }
  if (label.includes(controlCode)) {
    let { line, highlights } = parseAnsiHighlights(label)
    item.label = line
    if (!Array.isArray(item.ansiHighlights)) item.ansiHighlights = highlights
  }
  item.converted = true
  return item
}

export function indexOf(label: string, input: string, smartcase: boolean, ignorecase: boolean): number {
  if (smartcase) return smartcaseIndex(input, label)
  return ignorecase ? label.toLowerCase().indexOf(input.toLowerCase()) : label.indexOf(input)
}

/**
 * `a\ b` => [`a b`]
 * `a b` =>  ['a', 'b']
 */
export function parseInput(input: string): string[] {
  let res: string[] = []
  let startIdx = 0
  let currIdx = 0
  let prev = ''
  for (; currIdx < input.length; currIdx++) {
    let ch = input[currIdx]
    if (WHITE_SPACE_CHARS.includes(ch.charCodeAt(0))) {
      // find space
      if (prev && prev != '\\' && startIdx != currIdx) {
        res.push(input.slice(startIdx, currIdx))
        startIdx = currIdx + 1
      }
    } else {
    }
    prev = ch
  }
  if (startIdx != input.length) {
    res.push(input.slice(startIdx, input.length))
  }
  return res.map(s => s.replace(/\\\s/g, ' ').trim()).filter(s => s.length > 0)
}
