import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Emitter, Event } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { IList, ListContext, ListHighlights, ListItem, ListItemsEvent, ListOptions, ListTask } from '../types'
import { parseAnsiHighlights } from '../util/ansiparse'
import { patchLine } from '../util/diff'
import { hasMatch, positions, score } from '../util/fzy'
import { getMatchResult } from '../util/score'
import { byteIndex, byteLength } from '../util/string'
import workspace from '../workspace'
import Prompt from './prompt'
const logger = require('../util/logger')('list-worker')
const controlCode = '\x1b'

export interface ExtendedItem extends ListItem {
  score: number
  matches: number[]
  filterLabel: string
}

export interface WorkerConfiguration {
  interactiveDebounceTime: number
  extendedSearchMode: boolean
}

// perform loading task
export default class Worker {
  private recentFiles: string[] = []
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
    let mru = workspace.createMru('mru')
    mru.load().then(files => {
      this.recentFiles = files
    }).logError()
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
      let highlights: ListHighlights[] = []
      if (!interactive) {
        let res = this.filterItems(items)
        items = res.items
        highlights = res.highlights
      } else {
        highlights = this.getItemsHighlight(items)
      }
      this._onDidChangeItems.fire({
        items,
        highlights,
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
          let highlights: ListHighlights[] = []
          if (interactive) {
            items = totalItems.slice()
            highlights = this.getItemsHighlight(items)
          } else {
            let res = this.filterItems(totalItems)
            items = res.items
            highlights = res.highlights
          }
          this._onDidChangeItems.fire({ items, highlights, reload, append: false, finished })
        } else {
          let remain = totalItems.slice(count)
          count = totalItems.length
          let items: ListItem[]
          let highlights: ListHighlights[] = []
          if (!interactive) {
            let res = this.filterItems(remain)
            items = res.items
            highlights = res.highlights
          } else {
            items = remain
            highlights = this.getItemsHighlight(remain)
          }
          this._onDidChangeItems.fire({ items, highlights, append: true, finished })
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
          this._onDidChangeItems.fire({ items: [], highlights: [], finished: true })
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
        this.nvim.call('coc#list#stop_prompt', [], true)
        workspace.showMessage(`Task error: ${error.toString()}`, 'error')
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
    let items = totalItems
    let highlights: ListHighlights[] = []
    if (!listOptions.interactive) {
      let res = this.filterItems(totalItems)
      items = res.items
      highlights = res.highlights
    } else {
      highlights = this.getItemsHighlight(items)
    }
    this._onDidChangeItems.fire({ items, highlights, finished: true })
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

  private getItemsHighlight(items: ListItem[]): ListHighlights[] {
    let { input } = this
    if (!input) return []
    return items.map(item => {
      let filterLabel = getFilterLabel(item)
      if (filterLabel == '') return null
      let res = getMatchResult(filterLabel, input)
      if (!res || !res.score) return null
      return this.getHighlights(filterLabel, res.matches)
    })
  }

  private filterItems(items: ListItem[]): { items: ListItem[]; highlights: ListHighlights[] } {
    let { input } = this
    let highlights: ListHighlights[] = []
    let { sort, matcher, ignorecase } = this.listOptions
    if (input.length == 0) {
      let filtered = items.slice()
      let sort = filtered.length && typeof filtered[0].recentScore == 'number'
      return {
        items: sort ? filtered.sort((a, b) => b.recentScore - a.recentScore) : filtered,
        highlights
      }
    }
    let filtered: ListItem[] | ExtendedItem[]
    if (input.length > 0) {
      let inputs = this.config.extendedSearchMode ? input.split(/\s+/) : [input]
      if (matcher == 'strict') {
        filtered = items.filter(item => {
          let spans: [number, number][] = []
          let filterLabel = getFilterLabel(item)
          for (let input of inputs) {
            let idx = ignorecase ? filterLabel.toLowerCase().indexOf(input.toLowerCase()) : filterLabel.indexOf(input)
            if (idx == -1) return false
            spans.push([byteIndex(filterLabel, idx), byteIndex(filterLabel, idx + byteLength(input))])
          }
          highlights.push({ spans })
          return true
        })
      } else if (matcher == 'regex') {
        let flags = ignorecase ? 'iu' : 'u'
        let regexes = inputs.reduce((p, c) => {
          try {
            let regex = new RegExp(c, flags)
            p.push(regex)
          } catch (e) { }
          return p
        }, [])
        filtered = items.filter(item => {
          let spans: [number, number][] = []
          let filterLabel = getFilterLabel(item)
          for (let regex of regexes) {
            let ms = filterLabel.match(regex)
            if (ms == null) return false
            spans.push([byteIndex(filterLabel, ms.index), byteIndex(filterLabel, ms.index + byteLength(ms[0]))])
          }
          highlights.push({ spans })
          return true
        })
      } else {
        filtered = items.filter(item => {
          let filterText = item.filterText || item.label
          return inputs.every(s => hasMatch(s, filterText))
        })
        filtered = filtered.map(item => {
          let filterLabel = getFilterLabel(item)
          let matchScore = 0
          let matches: number[] = []
          for (let input of inputs) {
            matches.push(...positions(input, filterLabel))
            matchScore += score(input, filterLabel)
          }
          let { recentScore } = item
          if (!recentScore && item.location) {
            let uri = getItemUri(item)
            if (uri.startsWith('file')) {
              let fsPath = URI.parse(uri).fsPath
              recentScore = - this.recentFiles.indexOf(fsPath)
            }
          }
          return Object.assign({}, item, {
            filterLabel,
            score: matchScore,
            recentScore,
            matches
          })
        }) as ExtendedItem[]
        if (sort && items.length) {
          (filtered as ExtendedItem[]).sort((a, b) => {
            if (a.score != b.score) return b.score - a.score
            if (input.length && a.recentScore != b.recentScore) {
              return (a.recentScore || -Infinity) - (b.recentScore || -Infinity)
            }
            if (a.location && b.location) {
              let au = getItemUri(a)
              let bu = getItemUri(b)
              return au > bu ? 1 : -1
            }
            return a.label > b.label ? 1 : -1
          })
        }
        for (let item of filtered as ExtendedItem[]) {
          if (!item.matches) continue
          let hi = this.getHighlights(item.filterLabel, item.matches)
          highlights.push(hi)
        }
      }
    }
    return {
      items: filtered,
      highlights
    }
  }

  private getHighlights(text: string, matches: number[]): ListHighlights {
    let spans: [number, number][] = []
    if (matches.length) {
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
    this._onDidChangeLoading.dispose()
    this._onDidChangeItems.dispose()
    this.stop()
  }
}

function getFilterLabel(item: ListItem): string {
  return item.filterText != null ? patchLine(item.filterText, item.label) : item.label
}

function getItemUri(item: ListItem): string {
  let { location } = item
  if (typeof location == 'string') return location
  return location.uri
}
