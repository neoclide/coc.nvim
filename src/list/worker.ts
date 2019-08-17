import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Emitter, Event } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { ListHighlights, ListItem, ListItemsEvent, ListTask } from '../types'
import { parseAnsiHighlights } from '../util/ansiparse'
import { patchLine } from '../util/diff'
import { hasMatch, positions, score } from '../util/fzy'
import { getMatchResult } from '../util/score'
import { byteIndex, byteLength } from '../util/string'
import workspace from '../workspace'
import { ListManager } from './manager'
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const logger = require('../util/logger')('list-worker')
const controlCode = '\x1b'

export interface ExtendedItem extends ListItem {
  score: number
  matches: number[]
  filterLabel: string
}

// perform loading task
export default class Worker {
  private recentFiles: string[] = []
  private _loading = false
  private timer: NodeJS.Timer
  private interval: NodeJS.Timer
  private totalItems: ListItem[] = []
  private tokenSource: CancellationTokenSource
  private _onDidChangeItems = new Emitter<ListItemsEvent>()
  public readonly onDidChangeItems: Event<ListItemsEvent> = this._onDidChangeItems.event

  constructor(private nvim: Neovim, private manager: ListManager) {
    let { prompt } = manager
    prompt.onDidChangeInput(async () => {
      let { listOptions } = manager
      let { interactive } = listOptions
      let time = manager.getConfig<number>('interactiveDebounceTime', 100)
      if (this.timer) clearTimeout(this.timer)
      // reload or filter items
      if (interactive) {
        this.stop()
        this.timer = setTimeout(async () => {
          await this.loadItems()
        }, time)
      } else if (this.length) {
        let wait = Math.max(Math.min(Math.floor(this.length / 200), 300), 50)
        this.timer = setTimeout(async () => {
          await this.drawItems()
        }, wait)
      }
    })
  }

  private loadMru(): void {
    let mru = workspace.createMru('mru')
    mru.load().then(files => {
      this.recentFiles = files
    }).logError()
  }

  private set loading(loading: boolean) {
    if (this._loading == loading) return
    this._loading = loading
    let { nvim } = this
    if (loading) {
      this.interval = setInterval(async () => {
        let idx = Math.floor((new Date()).getMilliseconds() / 100)
        nvim.pauseNotification()
        nvim.setVar('coc_list_loading_status', frames[idx], true)
        nvim.command('redraws', true)
        nvim.resumeNotification(false, true).logError()
      }, 100)
    } else {
      if (this.interval) {
        clearInterval(this.interval)
        nvim.pauseNotification()
        nvim.setVar('coc_list_loading_status', '', true)
        nvim.command('redraws', true)
        nvim.resumeNotification(false, true).logError()
      }
    }
  }

  public get isLoading(): boolean {
    return this._loading
  }

  public async loadItems(reload = false): Promise<void> {
    let { context, list, listOptions } = this.manager
    if (!list) return
    this.loadMru()
    if (this.timer) clearTimeout(this.timer)
    this.loading = true
    let { interactive } = listOptions
    let source = this.tokenSource = new CancellationTokenSource()
    let token = source.token
    let items = await list.loadItems(context, token)
    if (token.isCancellationRequested) return
    if (!items || Array.isArray(items)) {
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
        reload
      })
    } else {
      let task = items as ListTask
      let totalItems = this.totalItems = []
      let count = 0
      let currInput = context.input
      let timer: NodeJS.Timer
      let lastTs: number
      let _onData = () => {
        lastTs = Date.now()
        if (token.isCancellationRequested || !this.manager.isActivated) return
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
          this._onDidChangeItems.fire({ items, highlights, reload, append: false })
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
          this._onDidChangeItems.fire({ items, highlights, append: true })
        }
      }
      task.on('data', async item => {
        if (timer) clearTimeout(timer)
        if (token.isCancellationRequested) return
        if (interactive && this.input != currInput) return
        item.label = this.fixLabel(item.label)
        this.parseListItemAnsi(item)
        totalItems.push(item)
        if (this.input != currInput) return
        if ((!lastTs && totalItems.length == 500)
          || Date.now() - lastTs > 200) {
          _onData()
        } else {
          timer = setTimeout(_onData, 50)
        }
      })
      let disposable = token.onCancellationRequested(() => {
        this.loading = false
        disposable.dispose()
        if (timer) clearTimeout(timer)
        if (task) {
          task.dispose()
          task = null
        }
      })
      task.on('error', async (error: Error | string) => {
        task = null
        this.loading = false
        disposable.dispose()
        if (timer) clearTimeout(timer)
        await this.manager.cancel()
        workspace.showMessage(`Task error: ${error.toString()}`, 'error')
        logger.error(error)
      })
      task.on('end', async () => {
        task = null
        this.loading = false
        disposable.dispose()
        if (timer) clearTimeout(timer)
        if (token.isCancellationRequested) return
        if (totalItems.length == 0) {
          this._onDidChangeItems.fire({ items: [], highlights: [] })
        } else {
          _onData()
        }
      })
    }
  }

  // draw all items with filter if necessary
  public async drawItems(): Promise<void> {
    let { totalItems } = this
    let { listOptions, isActivated } = this.manager
    if (!isActivated) return
    let { interactive } = listOptions
    let items = totalItems
    let highlights: ListHighlights[] = []
    if (!interactive) {
      let res = this.filterItems(totalItems)
      items = res.items
      highlights = res.highlights
    } else {
      highlights = this.getItemsHighlight(items)
    }
    this._onDidChangeItems.fire({ items, highlights })
  }

  public stop(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = null
    }
    this.loading = false
    if (this.timer) {
      clearTimeout(this.timer)
    }
  }

  public get length(): number {
    return this.totalItems.length
  }

  private get input(): string {
    return this.manager.prompt.input
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

  private filterItems(items: ListItem[]): { items: ListItem[], highlights: ListHighlights[] } {
    let { input } = this.manager.prompt
    let highlights: ListHighlights[] = []
    let { sort, matcher, ignorecase } = this.manager.listOptions
    if (input.length == 0) {
      let filtered = items.slice()
      let sort = filtered.length && typeof filtered[0].recentScore == 'number'
      return {
        items: sort ? filtered.sort((a, b) => b.recentScore - a.recentScore) : filtered,
        highlights
      }
    }
    let extended = this.manager.getConfig<boolean>('extendedSearchMode', true)
    let filtered: ListItem[] | ExtendedItem[]
    if (input.length > 0) {
      let inputs = extended ? input.split(/\s+/) : [input]
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
            // tslint:disable-next-line: no-empty
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
    if (item.ansiHighlights || label.indexOf(controlCode) == -1) return
    let { line, highlights } = parseAnsiHighlights(label)
    item.label = line
    item.ansiHighlights = highlights
  }

  private fixLabel(label: string): string {
    let { columns } = workspace.env
    label = label.split('\n').join(' ')
    return label.slice(0, columns * 2)
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
