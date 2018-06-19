import {
  SnippetParser,
  TextmateSnippet,
  Marker,
  Text,
  Placeholder,
} from './parser'
import {
  Position,
  TextDocument,
} from 'vscode-languageserver-protocol'
import diff = require('diff')

export interface Change {
  offset: number
  added?: string
  removed?: string
}

export type FindResult = [Placeholder, number]

export default class Snippet {
  public textmateSnippet: TextmateSnippet
  public readonly maxIndex: number

  constructor(content: string) {
    this.textmateSnippet = new SnippetParser().parse(content, true, true)
    let max = 0
    let {placeholders} = this.textmateSnippet
    for (let o of placeholders) {
      max = Math.max(max, o.index)
    }
    this.maxIndex = max
  }

  public toString():string {
    return this.textmateSnippet.toString()
  }

  public offset(marker:Marker):number {
    return this.textmateSnippet.offset(marker)
  }

  public get marks():Marker[] {
    return this.textmateSnippet.children
  }

  public get fiistPlaceholder():Placeholder|null {
    let {textmateSnippet} = this
    let items = textmateSnippet.placeholders
    if (items.length == 0) return null
    let item = items.find(o => o.index == 1)
    return item ? item : items[0]
  }

  public replaceWith(mark:Marker, str:string):void {
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
   * @param {Change} change
   * @param {number} offset - character offset from snippet beginning
   * @returns {FindResult} - placeholder and start offset of change
   */
  public findPlaceholder(change:Change, offset:number):FindResult {
    let marker:Marker = null
    let start = 0
    let pos = 0
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
   * Get change from new content of snippet
   *
   * @public
   * @param {string} text
   * @returns {Change | null}
   */
  public getChange(text:string):Change | null {
    let orig = this.textmateSnippet.toString()
    let changes = diff.diffChars(orig, text)
    let character = 0
    let valid = true
    let change:Change = null
    for (let o of changes) {
      if (o.added || o.removed) {
        if (change && character != change.offset) {
          valid = false
          break
        }
        change = change ? change : {offset: character}
        if (o.added) change.added = o.value
        if (o.removed) change.removed = o.value
      }
      if (!o.removed) character = character + o.count
    }
    if (!valid || !change) return null
    return change
  }

  /**
   * Create new text from change
   *
   * @public
   * @param {Change} change
   * @param {string} text - original text
   * @param {number} start
   * @returns {string}
   */
  public getNewText(change:Change, placeholder:Placeholder, start:number):string {
    let text = placeholder.toString()
    let pre = text.slice(0, start)
    let {added, removed} = change
    let newText = text.slice(start)
    if (removed) newText = newText.slice(removed.length)
    if (added) newText = added + newText
    return pre + newText
  }
}
