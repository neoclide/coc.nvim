import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import path from 'path'
import os from 'os'
import util from 'util'
import { ListItem, ListTask, ListHighlights, ListItemsEvent } from '../types'
import { patchLine } from '../util/diff'
import { fuzzyMatch, getCharCodes } from '../util/fuzzy'
import { getMatchResult } from '../util/score'
import { byteIndex } from '../util/string'
import throttle from '../util/throttle'
import { ListManager } from './manager'
import Uri from 'vscode-uri'
import uuidv1 = require('uuid/v1')
import { Emitter, Event } from 'vscode-languageserver-protocol'
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const maxLength = 1000
const isWindows = process.platform == 'win32'
const root = isWindows ? path.join(os.homedir(), 'AppData/Local/coc') : path.join(os.homedir(), '.config/coc')
const mruFile = path.join(root, 'mru')
const logger = require('../util/logger')('list-worker')

export interface ExtendedItem extends ListItem {
  score: number
  matches: number[]
  filterLabel: string
  recentIndex: number
}

// perform loading task
export default class Worker {
  private _loading = false
  private taskId: string
  private task: ListTask = null
  private mruList: string[] = []
  private timer: NodeJS.Timer
  private interval: NodeJS.Timer
  private totalItems: ListItem[] = []
  private _onDidChangeItems = new Emitter<ListItemsEvent>()
  public readonly onDidChangeItems: Event<ListItemsEvent> = this._onDidChangeItems.event

  constructor(private nvim: Neovim, private manager: ListManager) {
    let { prompt } = manager
    prompt.onDidChangeInput(async () => {
      let { listOptions } = manager
      let { interactive } = listOptions
      if (this.timer) clearTimeout(this.timer)
      if (interactive) {
        this.stop()
        this.timer = setTimeout(async () => {
          await this.loadItems()
        }, 100)
      } else if (!this._loading && this.length) {
        let wait = Math.max(Math.floor(this.length / 200), 50)
        this.timer = setTimeout(async () => {
          if (this._loading) return
          await this.drawItems()
        }, wait)
      }
    })
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
        await nvim.resumeNotification()
      }, 100)
    } else {
      if (this.interval) {
        clearInterval(this.interval)
        nvim.pauseNotification()
        nvim.setVar('coc_list_loading_status', '', true)
        nvim.command('redraws', true)
        nvim.resumeNotification()
      }
    }
  }

  public async loadItems(reload = false): Promise<void> {
    let { context, list, listOptions } = this.manager
    if (!list) return
    let id = this.taskId = uuidv1()
    this.loading = true
    let { interactive } = listOptions
    await this.loadMruList(context.cwd)
    let items = await list.loadItems(context)
    if (!items || Array.isArray(items)) {
      items = (items || []) as ListItem[]
      this.totalItems = items.map(item => {
        return Object.assign({}, item, {
          recentScore: this.recentScore(item)
        })
      })
      this.loading = false
      let highlights: ListHighlights[]
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
      let task = this.task = items as ListTask
      let totalItems = this.totalItems = []
      let count = 0
      let currInput = context.input
      let _onData = async () => {
        if (this.taskId != id || !this.manager.isActivated) return
        let inputChanged = this.input != currInput
        if (interactive && inputChanged) return
        if (count == 0 || inputChanged || (currInput.length == 0 && list.name == 'files')) {
          currInput = this.input
          count = totalItems.length
          let arr: ListItem[]
          let highlights: ListHighlights[] = []
          if (interactive) {
            arr = totalItems
            highlights = this.getItemsHighlight(arr)
          } else {
            let res = this.filterItems(totalItems)
            arr = res.items
            highlights = res.highlights
          }
          this._onDidChangeItems.fire({ items: arr, highlights, reload })
        } else {
          let remain = totalItems.slice(count)
          let arr: ListItem[] = remain
          let highlights: ListHighlights[] = []
          if (!interactive) {
            let res = this.filterItems(remain, count)
            arr = res.items
            highlights = res.highlights
          } else {
            highlights = this.getItemsHighlight(arr, count)
          }
          count = count + remain.length
          this._onDidChangeItems.fire({ items: arr, highlights, append: true })
        }
      }
      let onData = throttle(_onData, 50)
      task.on('data', async (item) => {
        if (this.taskId != id || !this._loading) return
        if (interactive && this.input != currInput) return
        item.recentScore = this.recentScore(item)
        totalItems.push(item)
        onData()
      })
      await new Promise(resolve => {
        task.on('end', async () => {
          this.loading = false
          setTimeout(() => {
            resolve()
          }, 100)
        })
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
    this.loading = false
    if (this.timer) {
      clearTimeout(this.timer)
    }
    if (this.task) {
      this.task.dispose()
      this.task = null
      this.taskId = null
    }
  }

  public get length(): number {
    return this.totalItems.length
  }

  private get input(): string {
    return this.manager.prompt.input
  }

  private getItemsHighlight(items: ListItem[], lnum = 0): ListHighlights[] {
    let { input } = this
    if (!input) return []
    return items.map((item, i) => {
      let filterLabel = getFilterLabel(item)
      let res = getMatchResult(filterLabel, input)
      if (!res || !res.score) return null
      return this.getHighlights(filterLabel, lnum + i, res.matches)
    })
  }

  private filterItems(items: ListItem[], lnum = 0): { items: ListItem[], highlights: ListHighlights[] } {
    let { input } = this.manager.prompt
    let highlights: ListHighlights[] = []
    let { sort, matcher, ignorecase } = this.manager.listOptions
    if (input.length == 0) {
      return {
        items: items.sort((a, b) => {
          return b.recentScore - a.recentScore
        }),
        highlights
      }
    }
    if (input.length > 0) {
      if (matcher == 'strict') {
        items = items.filter(item => {
          let text = item.filterText || item.label
          if (!ignorecase) return text.indexOf(input) !== -1
          return text.toLowerCase().indexOf(input.toLowerCase()) !== -1
        })
        if (lnum < maxLength) {
          for (let item of items) {
            let filterLabel = getFilterLabel(item)
            let idx = ignorecase ? filterLabel.toLocaleLowerCase().indexOf(input.toLowerCase()) : filterLabel.indexOf(input)
            if (idx != -1) {
              highlights.push({
                lnum,
                spans: [[byteIndex(filterLabel, idx), byteIndex(filterLabel, idx + input.length)]]
              })
            }
            if (lnum == maxLength) break
            lnum++
          }
        }
      } else if (matcher == 'regex') {
        let regex = new RegExp(input, ignorecase ? 'i' : '')
        items = items.filter(item => regex.test(item.filterText || item.label))
        if (lnum < maxLength) {
          for (let item of items) {
            let filterLabel = getFilterLabel(item)
            let ms = filterLabel.match(regex)
            if (ms && ms.length) {
              highlights.push({
                lnum,
                spans: [[byteIndex(filterLabel, ms.index), byteIndex(filterLabel, ms.index + ms[0].length)]]
              })
            }
            if (lnum == maxLength) break
            lnum++
          }
        }
      } else {
        let codes = getCharCodes(input)
        items = items.filter(item => fuzzyMatch(codes, item.filterText || item.label))
        let arr = items.map(item => {
          let filename = item.location ? path.basename(item.location.uri) : null
          let filterLabel = getFilterLabel(item)
          let res = getMatchResult(filterLabel, input, filename)
          return Object.assign({}, item, {
            filterLabel,
            score: res ? res.score : 0,
            matches: res ? res.matches : []
          })
        }) as ExtendedItem[]
        if (sort && items.length) {
          arr.sort((a, b) => {
            if (a.score != b.score) return b.score - a.score
            if (a.recentScore != b.recentScore) return b.recentScore - a.recentScore
            return a.label.length - b.label.length
          })
        }
        if (lnum < maxLength) {
          for (let item of arr) {
            if (!item.matches) continue
            let hi = this.getHighlights(item.filterLabel, lnum, item.matches)
            highlights.push(hi)
            if (lnum == maxLength) break
            lnum++
          }
        }
        items = arr
      }
    }
    return {
      items: items.slice(),
      highlights
    }
  }

  private getHighlights(text: string, lnum: number, matches: number[]): ListHighlights {
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
    return { lnum, spans }
  }

  private async loadMruList(cwd: string): Promise<void> {
    try {
      let content = await util.promisify(fs.readFile)(mruFile, 'utf8')
      let files = content.trim().split('\n')
      this.mruList = files.filter(s => s.startsWith(cwd))
    } catch (e) {
      this.mruList = []
      // noop
    }
  }

  private recentScore(item: ListItem): number {
    let { location } = item
    if (!location) return -1
    let list = this.mruList
    let len = list.length
    let idx = list.indexOf(Uri.parse(location.uri).fsPath)
    return idx == -1 ? -1 : len - idx
  }
}

function getFilterLabel(item: ListItem): string {
  return item.filterText ? patchLine(item.filterText, item.label) : item.label
}
