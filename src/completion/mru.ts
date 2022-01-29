import Mru from '../model/mru'
import { ExtendedCompleteItem } from '../types'
import type { MruItem } from './complete'

export default class MruLoader {
  private mru: Mru
  constructor() {
    this.mru = new Mru(`suggest${globalThis.__TEST__ ? process.pid : ''}.txt`, process.env.COC_DATA_HOME, 1000)
  }

  public add(input: string, item: ExtendedCompleteItem): void {
    let line = `${input}|${item.filterText}|${item.source}`
    void this.mru.add(line)
  }

  public async getRecentItems(): Promise<MruItem[]> {
    let lines = await this.mru.load()
    let items: MruItem[] = []
    for (let line of lines) {
      let arr = line.split('|')
      if (arr.length >= 3) {
        items.push({
          prefix: arr[0],
          label: arr[1],
          source: arr[2]
        })
      }
    }
    return items
  }
}
