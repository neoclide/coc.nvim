import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationToken, CancellationTokenSource, Color, ColorInformation, Position, Range } from 'vscode-languageserver-protocol'
import languages from '../../languages'
import { SyncItem } from '../../model/bufferSync'
import { group } from '../../util/array'
import { equals } from '../../util/object'
import { positionInRange } from '../../util/position'
import workspace from '../../workspace'
const logger = require('../../util/logger')('colors-buffer')

export interface ColorRanges {
  color: Color
  ranges: Range[]
}

function pad(str: string): string {
  return str.length == 1 ? `0${str}` : str
}

export function toHexString(color: Color): string {
  let c = toHexColor(color)
  return `${pad(c.red.toString(16))}${pad(c.green.toString(16))}${pad(c.blue.toString(16))}`
}

export function toHexColor(color: Color): { red: number; green: number; blue: number } {
  let { red, green, blue } = color
  return {
    red: Math.round(red * 255),
    green: Math.round(green * 255),
    blue: Math.round(blue * 255)
  }
}

export function isDark(color: Color): boolean {
  // http://www.w3.org/TR/WCAG20/#relativeluminancedef
  let rgb = [color.red, color.green, color.blue]
  let lum = []
  for (let i = 0; i < rgb.length; i++) {
    let chan = rgb[i]
    lum[i] = (chan <= 0.03928) ? chan / 12.92 : Math.pow(((chan + 0.055) / 1.055), 2.4)
  }
  let luma = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2]
  return luma <= 0.5
}

export default class ColorBuffer implements SyncItem {
  private _colors: ColorInformation[] = []
  private tokenSource: CancellationTokenSource
  private version: number
  public highlight: Function & { clear(): void }
  // last highlight version
  constructor(
    private nvim: Neovim,
    private bufnr: number,
    private enabled: boolean,
    private usedColors: Set<string>) {
    this.highlight = debounce(() => {
      this.doHighlight().catch(e => {
        logger.error('Error on color highlight:', e.stack)
      })
    }, global.hasOwnProperty('__TEST__') ? 10 : 500)
  }

  public onChange(): void {
    this.cancel()
    this.highlight()
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

  public setState(enabled: boolean): void {
    this.enabled = enabled
    if (enabled) {
      this.highlight()
    } else {
      this.clearHighlight()
    }
  }

  public async doHighlight(): Promise<void> {
    let doc = workspace.getDocument(this.bufnr)
    if (!doc || !this.enabled) return
    try {
      this.tokenSource = new CancellationTokenSource()
      let { token } = this.tokenSource
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
      if (!this.usedColors.has(hex)) {
        this.nvim.command(`hi BG${hex} guibg=#${hex} guifg=#${isDark(color.color) ? 'ffffff' : '000000'}`, true)
        this.usedColors.add(hex)
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
    this.highlight.clear()
    this._colors = []
    this.version = null
    this.buffer.clearNamespace('color')
  }

  public hasColorAtPosition(position: Position): boolean {
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
    this.cancel()
  }
}
