import Mru from '../model/mru'
import { ExtendedCompleteItem } from '../types'

export type Selection = 'none' | 'recentlyUsed' | 'recentlyUsedByPrefix'

export default class MruLoader {
  private mru: Mru
  private items: Map<string, number> = new Map()
  private max = 0
  constructor(
    private selection: Selection
  ) {
    this.mru = new Mru(`suggest${globalThis.__TEST__ ? process.pid : ''}.txt`, process.env.COC_DATA_HOME, 1000)
  }

  public async load(): Promise<void> {
    let { selection } = this
    if (selection == 'none') return
    let lines = await this.mru.load()
    let total = lines.length
    for (let i = total - 1; i >= 0; i--) {
      let line = lines[i]
      if (!line.includes('|')) continue
      let [prefix, label, source, kind] = line.split('|')
      let key = this.toKey(prefix, label, source, kind)
      this.items.set(key, total - 1 - i)
    }
    this.max = total - 1
  }

  private toKey(prefix: string, label: string, source: string, kind?: string): string {
    let { selection } = this
    return selection == 'recentlyUsed' ? `${label}|${source}|${kind || ''}` : `${prefix}|${label}|${source}|${kind || ''}`
  }

  public getScore(input: string, item: ExtendedCompleteItem): number {
    let key = this.toKey(input, item.filterText, item.source, item.kind)
    return this.items.get(key) ?? -1
  }

  public add(prefix: string, item: ExtendedCompleteItem): void {
    let label = item.filterText
    let source = item.source
    let kind = item.kind ?? ''
    let line = `${prefix}|${label}|${source}|${kind}`
    let key = this.toKey(prefix, label, source, kind)
    this.max += 1
    this.items.set(key, this.max)
    void this.mru.add(line)
  }
}
