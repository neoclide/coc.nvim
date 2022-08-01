'use strict'
import { ExtendedCompleteItem } from '../types'
const logger = require('../util/logger')('completion-mru')

export type Selection = 'first' | 'recentlyUsed' | 'recentlyUsedByPrefix'

export default class MruLoader {
  private max = 0
  private items: Map<string, number> = new Map()
  private itemsNoPrefex: Map<string, number> = new Map()
  constructor(private selection: Selection) {
  }

  public getScore(input: string, item: ExtendedCompleteItem): number {
    let key = toItemKey(item)
    if (input.length == 0) return this.itemsNoPrefex.get(key) ?? -1
    if (this.selection === 'recentlyUsedByPrefix') key = `${input}|${key}`
    let map = this.selection === 'recentlyUsed' ? this.itemsNoPrefex : this.items
    return map.get(key) ?? -1
  }

  public add(prefix: string, item: ExtendedCompleteItem): void {
    if (this.selection == 'first' || ['around', 'buffer', 'word'].includes(item.source)) return
    let key = toItemKey(item)
    if (!item.word.toLowerCase().startsWith(prefix.toLowerCase())) {
      prefix = ''
    }
    let line = `${prefix}|${key}`
    this.items.set(line, this.max)
    this.itemsNoPrefex.set(key, this.max)
    this.max += 1
  }
}

function toItemKey(item: ExtendedCompleteItem): string {
  let label = item.filterText
  let source = item.source
  let kind = item.kind ?? ''
  return `${label}|${source}|${kind}`
}
