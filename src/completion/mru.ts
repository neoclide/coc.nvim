'use strict'
import { DurationCompleteItem } from '../types'
import * as Is from '../util/is'

export type Selection = 'first' | 'recentlyUsed' | 'recentlyUsedByPrefix'

export default class MruLoader {
  private max = 0
  private items: Map<string, number> = new Map()
  private itemsNoPrefex: Map<string, number> = new Map()
  constructor() {
  }

  public getScore(input: string, item: DurationCompleteItem, selection: Selection): number {
    let key = toItemKey(item)
    if (input.length == 0) return this.itemsNoPrefex.get(key) ?? -1
    if (selection === 'recentlyUsedByPrefix') key = `${input}|${key}`
    let map = selection === 'recentlyUsed' ? this.itemsNoPrefex : this.items
    return map.get(key) ?? -1
  }

  public add(prefix: string, item: DurationCompleteItem): void {
    if (!Is.number(item.kind)) return
    let key = toItemKey(item)
    if (!item.word.toLowerCase().startsWith(prefix.toLowerCase())) {
      prefix = ''
    }
    let line = `${prefix}|${key}`
    this.items.set(line, this.max)
    this.itemsNoPrefex.set(key, this.max)
    this.max += 1
  }

  public clear(): void {
    this.items.clear()
    this.itemsNoPrefex.clear()
  }
}

function toItemKey(item: DurationCompleteItem): string {
  let label = item.filterText
  let source = item.source
  let kind = item.kind ?? ''
  return `${label}|${source}|${kind}`
}
