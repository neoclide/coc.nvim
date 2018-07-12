import {ChangeItem} from '../types'
import {Marker, Placeholder, SnippetParser, Text, TextmateSnippet} from './parser'
const logger = require('../util/logger')('snippet-snippet')

export type FindResult = [Placeholder, number]

export default class Snippet {
  public textmateSnippet: TextmateSnippet
  public readonly maxIndex: number

  constructor(content: string, private prepend = '', private append = '') {
    this.textmateSnippet = new SnippetParser().parse(content, false, false)
    let max = 0
    let {placeholders} = this.textmateSnippet
    for (let o of placeholders) {
      max = Math.max(max, o.index)
    }
    this.maxIndex = max
  }

  public toString(): string {
    return this.prepend + this.textmateSnippet.toString() + this.append
  }

  public offset(marker: Marker): number {
    return this.prepend.length + this.textmateSnippet.offset(marker)
  }

  public get marks(): Marker[] {
    return this.textmateSnippet.children
  }

  public get firstPlaceholder(): Placeholder | null {
    let {textmateSnippet} = this
    let items = textmateSnippet.placeholders
    if (items.length == 0) return null
    let item = items.find(o => o.index == 1)
    return item ? item : items[0]
  }

  public replaceWith(mark: Marker, str: string): void {
    let {placeholders} = this.textmateSnippet
    if (mark instanceof Placeholder) {
      let index = mark.index
      for (let p of placeholders) {
        if (p.index == index) {
          if (p.children.length == 0) {
            p.appendChild(new Text(str))
          } else {
            let orig = p.children[0]
            mark.replace(orig, [new Text(str)])
          }
        }
      }
    } else {
      mark.replace(mark, [new Text(str)])
    }
  }

  /**
   * Find placeholder be change and offset of change
   *
   * @public
   * @param {ChangeItem} change
   * @param {number} offset - character offset from line beginning
   * @returns {FindResult} - placeholder and start offset of change
   */
  public findPlaceholder(change: ChangeItem, offset: number): FindResult {
    let marker: Marker = null
    let start = 0
    let pos = 0
    offset = offset - this.prepend.length
    if (offset < 0) return [null, 0]
    this.textmateSnippet.walk(o => {
      pos += o.len()
      if (pos == offset && o instanceof Placeholder) {
        marker = o
        start = 0
        return false
      }
      if (pos == offset
        && o.parent instanceof Placeholder) {
        marker = o.parent
        start = o.len()
        return false
      }
      if (pos > offset) {
        marker = o
        start = offset - (pos - o.len())
        if (marker.parent instanceof Placeholder) {
          marker = marker.parent
        }
        return false
      }
      return true
    })
    if (!marker || !(marker instanceof Placeholder)) {
      return [null, 0]
    }
    let len = marker.toString().length - start
    if (change.removed
      && change.removed.length > len) {
      return [null, 0]
    }
    return [marker as Placeholder, start]
  }

  /**
   * Create new text from change
   *
   * @public
   * @param {ChangeItem} change
   * @param {string} text - original text
   * @param {number} start - start position of snippet
   * @returns {string}
   */
  public getNewText(change: ChangeItem, placeholder: Placeholder, start: number): string {
    let text = placeholder.toString()
    let pre = text.slice(0, start)
    let {added, removed} = change
    let newText = text.slice(start)
    if (removed) newText = newText.slice(removed.length)
    if (added) newText = added + newText
    return pre + newText
  }

  public get hasPlaceholder(): boolean {
    let firstPlaceholder = this.firstPlaceholder
    return firstPlaceholder && firstPlaceholder.index !== 0
  }
}
