import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationToken, CancellationTokenSource, Color, ColorInformation, Disposable, Position, Range } from 'vscode-languageserver-protocol'
import languages from '../languages'
import { group } from '../util/array'
import { equals } from '../util/object'
import { positionInRange } from '../util/position'
import workspace from '../workspace'
import { isDark, toHexColor, toHexString } from './helper'
const logger = require('../util/logger')('highlighter')

export interface ColorRanges {
  color: Color
  ranges: Range[]
}

const usedColors: Set<string> = new Set()

export default class Highlighter implements Disposable {
  private _colors: ColorInformation[] = []
  private tokenSource: CancellationTokenSource
  private version: number
  public highlight: Function & { clear(): void }
  // last highlight version
  constructor(private nvim: Neovim, private bufnr: number) {
    this.highlight = debounce(() => {
      this.doHighlight().catch(e => {
        logger.error('Error on color highlight:', e.stack)
      })
    }, 500)
  }

  public get buffer(): Buffer {
    return this.nvim.createBuffer(this.bufnr)
  }

  public get colors(): ColorInformation[] {
    return this._colors
  }

  public hasColor(): boolean {
    return this._colors.length > 0
  }

  public async doHighlight(): Promise<void> {
    let doc = workspace.getDocument(this.bufnr)
    if (!doc) return
    try {
      this.tokenSource = new CancellationTokenSource()
      let { token } = this.tokenSource
      if (workspace.insertMode) return
      if (token.isCancellationRequested) return
      if (this.version && doc.version == this.version) return
      let { version } = doc
      let colors: ColorInformation[]
      colors = await languages.provideDocumentColors(doc.textDocument, token)
      colors = colors || []
      if (token.isCancellationRequested) return
      this.version = version
      await this.addHighlight(colors, token)
    } catch (e) {
      logger.error('Error on highlight:', e)
    }
  }

  private async addHighlight(colors: ColorInformation[], token: CancellationToken): Promise<void> {
    colors = colors || []
    if (equals(this._colors, colors)) return
    let { nvim } = this
    this._colors = colors
    // improve performance
    let groups = group(colors, 100)
    nvim.pauseNotification()
    this.buffer.clearNamespace('color')
    this.defineColors(colors)
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
    for (let colors of groups) {
      if (token.isCancellationRequested) {
        this._colors = []
        return
      }
      nvim.pauseNotification()
      let colorRanges = this.getColorRanges(colors)
      for (let o of colorRanges) {
        this.highlightColor(o.ranges, o.color)
      }
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      nvim.resumeNotification(false, true)
    }
    if (workspace.isVim) {
      this.nvim.command('redraw', true)
    }
  }

  private highlightColor(ranges: Range[], color: Color): void {
    let { red, green, blue } = toHexColor(color)
    let hlGroup = `BG${toHexString(color)}`
    this.buffer.highlightRanges('color', hlGroup, ranges)
  }

  private defineColors(colors: ColorInformation[]): void {
    for (let color of colors) {
      let hex = toHexString(color.color)
      if (!usedColors.has(hex)) {
        this.nvim.command(`hi BG${hex} guibg=#${hex} guifg=#${isDark(color.color) ? 'ffffff' : '000000'}`, true)
        usedColors.add(hex)
      }
    }
  }

  private getColorRanges(infos: ColorInformation[]): ColorRanges[] {
    let res: ColorRanges[] = []
    for (let info of infos) {
      let { color, range } = info
      let idx = res.findIndex(o => equals(toHexColor(o.color), toHexColor(color)))
      if (idx == -1) {
        res.push({
          color,
          ranges: [range]
        })
      } else {
        let r = res[idx]
        r.ranges.push(range)
      }
    }
    return res
  }

  public clearHighlight(): void {
    this._colors = []
    this.version = null
    this.buffer.clearNamespace('color')
  }

  public hasColorAtPostion(position: Position): boolean {
    let { colors } = this
    return colors.some(o => positionInRange(position, o.range) == 0)
  }

  public cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = null
    }
  }

  public dispose(): void {
    this.highlight.clear()
    if (this.tokenSource) {
      this.tokenSource.dispose()
      this.tokenSource = null
    }
  }
}
