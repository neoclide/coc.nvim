import { AnsiHighlight } from '../types'
import { byteIndex, byteLength } from '../util/string'

interface NestedHighlight {
  offset: number
  length: number
  hlGroup: string
}

/**
 * Build line with content and highlights.
 */
export default class LineBuilder {
  private _label = ''
  private _len = 0
  private _highlights: AnsiHighlight[] = []
  constructor(private addSpace = false) {
  }

  public append(text: string, hlGroup?: string, nested?: NestedHighlight[]): void {
    if (text.length == 0) return
    let space = this._len > 0 && this.addSpace ? ' ' : ''
    let start = this._len + space.length
    this._label = this._label + space + text
    this._len = this._len + byteLength(text) + space.length
    if (hlGroup) {
      this._highlights.push({
        hlGroup,
        span: [start, start + byteLength(text)]
      })
    }
    if (nested) {
      for (let item of nested) {
        let s = start + byteIndex(text, item.offset)
        let e = start + byteIndex(text, item.offset + item.length)
        this._highlights.push({
          hlGroup: item.hlGroup,
          span: [s, e]
        })
      }
    }
  }

  public appendBuilder(builder: LineBuilder): void {
    let space = this._len > 0 && this.addSpace ? ' ' : ''
    let curr = this._len + space.length
    this._label = this._label + space + builder.label
    this._len = this._len + byteLength(builder.label) + space.length
    this._highlights.push(...builder.highlights.map(item => {
      return {
        hlGroup: item.hlGroup,
        span: item.span.map(v => {
          return curr + v
        }) as [number, number]
      }
    }))
  }

  public get label(): string {
    return this._label
  }

  public get highlights(): AnsiHighlight[] {
    return this._highlights
  }
}
