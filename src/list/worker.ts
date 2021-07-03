import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Emitter, Event } from 'vscode-languageserver-protocol'
import { IList, ListContext, ListHighlights, ListItem, ListItemsEvent, ListItemWithHighlights, ListOptions, ListTask } from '../types'
import { parseAnsiHighlights } from '../util/ansiparse'
import { patchLine } from '../util/diff'
import { hasMatch, positions, score } from '../util/fzy'
import { getMatchResult } from '../util/score'
import { byteIndex, byteLength } from '../util/string'
import window from '../window'
import workspace from '../workspace'
import Prompt from './prompt'
const logger = require('../util/logger')('list-worker')
const controlCode = '\x1b'

export interface ExtendedItem extends ListItem {
  score: number
}

export interface WorkerConfiguration {
  interactiveDebounceTime: number
  extendedSearchMode: boolean
}

// perform loading task
export default class Worker {
  private _loading = false
  private totalItems: ListItem[] = []
  private tokenSource: CancellationTokenSource
  private _onDidChangeItems = new Emitter<ListItemsEvent>()
  private _onDidChangeLoading = new Emitter<boolean>()
  public readonly onDidChangeItems: Event<ListItemsEvent> = this._onDidChangeItems.event
  public readonly onDidChangeLoading: Event<boolean> = this._onDidChangeLoading.event

  constructor(
    private nvim: Neovim,
    private list: IList,
    private prompt: Prompt,
    private listOptions: ListOptions,
    private config: WorkerConfiguration
  ) {
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
    let { list, listOptions } = this
    this.loading = true
    let { interactive } = listOptions
    this.tokenSource = new CancellationTokenSource()
    let token = this.tokenSource.token
    let items = await list.loadItems(context, token)
    if (token.isCancellationRequested) return
    if (!items || Array.isArray(items)) {
      this.tokenSource = null
      items = (items || []) as ListItem[]
      this.totalItems = items.map(item => {
        item.label = this.fixLabel(item.label)
        this.parseListItemAnsi(item)
        return item
      })
      this.loading = false
      let filtered: ListItemWithHighlights[]
      if (!interactive) {
        filtered = this.filterItems(items)
      } else {
        filtered = this.convertToHighlightItems(items)
      }
      this._onDidChangeItems.fire({
        items: filtered,
        reload,
        finished: true
      })
    } else {
      let task = items as ListTask
      let totalItems = this.totalItems = []
      let count = 0
      let currInput = context.input
      let timer: NodeJS.Timer
      let lastTs: number
      let _onData = (finished?: boolean) => {
        lastTs = Date.now()
        if (count >= totalItems.length) return
        let inputChanged = this.input != currInput
        if (interactive && inputChanged) return
        if (count == 0 || inputChanged) {
          currInput = this.input
          count = totalItems.length
          let items: ListItem[]
          if (interactive) {
            items = this.convertToHighlightItems(totalItems)
          } else {
            items = this.filterItems(totalItems)
          }
          this._onDidChangeItems.fire({ items, reload, append: false, finished })
        } else {
          let remain = totalItems.slice(count)
          count = totalItems.length
          let items: ListItem[]
          if (!interactive) {
            items = this.filterItems(remain)
          } else {
            items = this.convertToHighlightItems(remain)
          }
          this._onDidChangeItems.fire({ items, append: true, finished })
        }
      }
      task.on('data', item => {
        if (timer) clearTimeout(timer)
        if (token.isCancellationRequested) return
        if (interactive && this.input != currInput) return
        item.label = this.fixLabel(item.label)
        this.parseListItemAnsi(item)
        totalItems.push(item)
        if ((!lastTs && totalItems.length == 500)
          || Date.now() - lastTs > 200) {
          _onData()
        } else {
          timer = setTimeout(() => _onData(), 50)
        }
      })
      let onEnd = () => {
        if (task == null) return
        this.tokenSource = null
        task = null
        this.loading = false
        disposable.dispose()
        if (timer) clearTimeout(timer)
        if (totalItems.length == 0) {
          this._onDidChangeItems.fire({ items: [], finished: true })
        } else {
          _onData(true)
        }
      }
      let disposable = token.onCancellationRequested(() => {
        if (task) {
          task.dispose()
          onEnd()
        }
      })
      task.on('error', async (error: Error | string) => {
        if (task == null) return
        task = null
        this.tokenSource = null
        this.loading = false
        disposable.dispose()
        if (timer) clearTimeout(timer)
        this.nvim.call('coc#prompt#stop_prompt', ['list'], true)
        window.showMessage(`Task error: ${error.toString()}`, 'error')
        logger.error(error)
      })
      task.on('end', onEnd)
    }
  }

  /*
   * Draw all items with filter if necessary
   */
  public drawItems(): void {
    let { totalItems, listOptions } = this
    let items: ListItemWithHighlights[]
    if (listOptions.interactive) {
      items = this.convertToHighlightItems(totalItems)
    } else {
      items = this.filterItems(totalItems)
    }
    this._onDidChangeItems.fire({ items, finished: true })
  }

  public stop(): void {
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
  private convertToHighlightItems(items: ListItem[]): ListItemWithHighlights[] {
    let { input } = this
    if (!input) return []
    return items.map(item => {
      let filterLabel = getFilterLabel(item)
      if (filterLabel == '') return item
      let res = getMatchResult(filterLabel, input)
      if (!res || !res.score) return item
      let highlights = this.getHighlights(filterLabel, res.matches)
      return Object.assign({}, item, { highlights })
    })
  }

  private filterItems(items: ListItem[]): ListItemWithHighlights[] {
    let { input } = this
    let { sort, matcher, ignorecase } = this.listOptions
    let inputs = this.config.extendedSearchMode ? parseInput(input) : [input]
    if (input.length == 0 || inputs.length == 0) return items
    if (matcher == 'strict') {
      let filtered: ListItemWithHighlights[] = []
      for (let item of items) {
        let spans: [number, number][] = []
        let filterLabel = getFilterLabel(item)
        let match = true
        for (let input of inputs) {
          let idx = ignorecase ? filterLabel.toLowerCase().indexOf(input.toLowerCase()) : filterLabel.indexOf(input)
          if (idx == -1) {
            match = false
            break
          }
          spans.push([byteIndex(filterLabel, idx), byteIndex(filterLabel, idx + byteLength(input))])
        }
        if (match) {
          filtered.push(Object.assign({}, item, {
            highlights: { spans }
          }))
        }
      }
      return filtered
    }
    if (matcher == 'regex') {
      let filtered: ListItemWithHighlights[] = []
      let flags = ignorecase ? 'iu' : 'u'
      let regexes = inputs.reduce((p, c) => {
        try {
          let regex = new RegExp(c, flags)
          p.push(regex)
        } catch (e) {}
        return p
      }, [])
      for (let item of items) {
        let spans: [number, number][] = []
        let filterLabel = getFilterLabel(item)
        let match = true
        for (let regex of regexes) {
          let ms = filterLabel.match(regex)
          if (ms == null) {
            match = false
            break
          }
          spans.push([byteIndex(filterLabel, ms.index), byteIndex(filterLabel, ms.index + byteLength(ms[0]))])
        }
        if (match) {
          filtered.push(Object.assign({}, item, {
            highlights: { spans }
          }))
        }
      }
      return filtered
    }
    let filtered: ExtendedItem[] = []
    let idx = 0
    for (let item of items) {
      let filterText = item.filterText || item.label
      let matchScore = 0
      let matches: number[] = []
      let filterLabel = getFilterLabel(item)
      let match = true
      for (let input of inputs) {
        if (!hasMatch(input, filterText)) {
          match = false
          break
        }
        matches.push(...positions(input, filterLabel))
        if (sort) matchScore += score(input, filterText)
      }
      if (!match) continue
      let obj = Object.assign({}, item, {
        sortText: typeof item.sortText === 'string' ? item.sortText : String.fromCharCode(idx),
        score: matchScore,
        highlights: this.getHighlights(filterLabel, matches)
      })
      filtered.push(obj)
      idx = idx + 1
    }
    if (sort && filtered.length) {
      filtered.sort((a, b) => {
        if (a.score != b.score) return b.score - a.score
        if (a.sortText > b.sortText) return 1
        return -1
      })
    }
    return filtered
  }

  private getHighlights(text: string, matches?: number[]): ListHighlights {
    let spans: [number, number][] = []
    if (matches && matches.length) {
      let start = matches.shift()
      let next = matches.shift()
      let curr = start
      while (next) {
        if (next == curr + 1) {
          curr = next
          next = matches.shift()
          continue
        }
        spans.push([byteIndex(text, start), byteIndex(text, curr) + 1])
        start = next
        curr = start
        next = matches.shift()
      }
      spans.push([byteIndex(text, start), byteIndex(text, curr) + 1])
    }
    return { spans }
  }

  // set correct label, add ansi highlights
  private parseListItemAnsi(item: ListItem): void {
    let { label } = item
    if (item.ansiHighlights || !label.includes(controlCode)) return
    let { line, highlights } = parseAnsiHighlights(label)
    item.label = line
    item.ansiHighlights = highlights
  }

  private fixLabel(label: string): string {
    let { columns } = workspace.env
    label = label.split('\n').join(' ')
    return label.slice(0, columns * 2)
  }

  public dispose(): void {
    this.stop()
  }
}

function getFilterLabel(item: ListItem): string {
  return item.filterText != null ? patchLine(item.filterText, item.label) : item.label
}

/**
 * `a\ b` => [`a b`]
 * `a b` =>  ['a', 'b']
 */
export function parseInput(input): string[] {
  let res = []
  let startIdx = 0
  let currIdx = 0
  let prev = ''
  for (; currIdx < input.length; currIdx++) {
    let ch = input[currIdx]
    if (ch.charCodeAt(0) === 32) {
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
