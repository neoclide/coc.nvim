import { Neovim } from '@chemzqm/neovim'
import { HighlightItem } from '../types'
import { defaultValue } from '../util'
import { equals } from '../util/object'
import { CancellationToken } from '../util/protocol'

export type HighlightItemResult = [string, number, number, number, number?]
export type HighlightItemDef = [string, number, number, number, number?, number?, number?]

export interface HighlightDiff {
  remove: number[]
  removeMarkers: number[]
  add: HighlightItemDef[]
}

export function convertHighlightItem(item: HighlightItem): HighlightItemDef {
  return [item.hlGroup, item.lnum, item.colStart, item.colEnd, item.combine ? 1 : 0, item.start_incl ? 1 : 0, item.end_incl ? 1 : 0]
}

function isSame(item: HighlightItem, curr: HighlightItemResult): boolean {
  let arr = [item.hlGroup, item.lnum, item.colStart, item.colEnd]
  return equals(arr, curr.slice(0, 4))
}

export class Highlights {
  public nvim: Neovim
  public checkMarkers: boolean

  public async diffHighlights(bufnr: number, ns: string, items: HighlightItem[], region?: [number, number] | undefined, token?: CancellationToken): Promise<HighlightDiff | null> {
    let args = [bufnr, ns]
    if (Array.isArray(region)) args.push(region[0], region[1] - 1)
    let curr = await this.nvim.call('coc#highlight#get_highlights', args) as HighlightItemResult[]
    if (!curr || token?.isCancellationRequested) return null
    items.sort((a, b) => a.lnum - b.lnum)
    let linesToRemove = []
    // let checkMarkers = this.workspace.has('nvim-0.5.1') || this.workspace.isVim
    let removeMarkers = []
    let newItems: HighlightItemDef[] = []
    let itemIndex = 0
    let maxIndex = items.length - 1
    let maxLnum = 0
    // highlights on vim
    let map: Map<number, HighlightItemResult[]> = new Map()
    curr.forEach(o => {
      maxLnum = Math.max(maxLnum, o[1])
      let arr = map.get(o[1])
      if (arr) {
        arr.push(o)
      } else {
        map.set(o[1], [o])
      }
    })
    if (curr.length > 0) {
      let start = Array.isArray(region) ? region[0] : 0
      for (let i = start; i <= maxLnum; i++) {
        let exists = defaultValue(map.get(i), [])
        let added: HighlightItem[] = []
        for (let j = itemIndex; j <= maxIndex; j++) {
          let o = items[j]
          if (o.lnum == i) {
            itemIndex = j + 1
            added.push(o)
          } else {
            itemIndex = j
            break
          }
        }
        if (added.length == 0) {
          if (exists.length > 0) {
            if (this.checkMarkers) {
              removeMarkers.push(...exists.map(o => o[4]))
            } else {
              linesToRemove.push(i)
            }
          }
        } else {
          if (exists.length == 0) {
            newItems.push(...added.map(o => convertHighlightItem(o)))
          } else {
            if (this.checkMarkers) {
              // skip same markers at beginning of exists and removeMarkers
              let skip = 0
              let min = Math.min(exists.length, added.length)
              while (skip < min) {
                if (isSame(added[skip], exists[skip])) {
                  skip++
                } else {
                  break
                }
              }
              removeMarkers.push(...exists.slice(skip).map(o => o[4]))
              newItems.push(...added.slice(skip).map(o => convertHighlightItem(o)))
            } else if (added.length != exists.length || !(added.every((o, i) => isSame(o, exists[i])))) {
              linesToRemove.push(i)
              newItems.push(...added.map(o => convertHighlightItem(o)))
            }
          }
        }
      }
    }
    for (let i = itemIndex; i <= maxIndex; i++) {
      newItems.push(convertHighlightItem(items[i]))
    }
    return { remove: linesToRemove, add: newItems, removeMarkers }
  }

  public async applyDiffHighlights(bufnr: number, ns: string, priority: number, diff: HighlightDiff, notify: boolean): Promise<void> {
    let { nvim } = this
    let { remove, add, removeMarkers } = diff
    if (remove.length === 0 && add.length === 0 && removeMarkers.length === 0) return
    nvim.pauseNotification()
    if (removeMarkers.length) {
      nvim.call('coc#highlight#del_markers', [bufnr, ns, removeMarkers], true)
    }
    if (remove.length) {
      nvim.call('coc#highlight#clear', [bufnr, ns, remove], true)
    }
    if (add.length) {
      nvim.call('coc#highlight#set', [bufnr, ns, add, priority], true)
    }
    if (notify) {
      nvim.resumeNotification(true, true)
    } else {
      await nvim.resumeNotification(true)
    }
  }
}
