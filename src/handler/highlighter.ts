import { Neovim } from '@chemzqm/neovim'
import { Color, ColorInformation, Disposable, Position, Range } from 'vscode-languageserver-protocol'
import Document from '../model/document'
import { group } from '../util/array'
import { equals } from '../util/object'
import { positionInRange } from '../util/position'
import workspace from '../workspace'
const logger = require('../util/logger')('highlighter')

export interface ColorRanges {
  color: Color
  ranges: Range[]
}

const usedColors: Set<string> = new Set()

export default class Highlighter implements Disposable {
  private matchIds: Set<number> = new Set()
  private _colors: ColorInformation[] = []
  // last highlight version
  private _version: number
  constructor(private nvim: Neovim, private document: Document, private srcId) {
  }

  public get version(): number {
    return this._version
  }

  public get bufnr(): number {
    return this.document.bufnr
  }

  public get colors(): ColorInformation[] {
    return this._colors
  }

  public hasColor(): boolean {
    return this._colors.length > 0
  }

  public async highlight(colors: ColorInformation[]): Promise<void> {
    colors = colors || []
    this._version = this.document.version
    if (workspace.isVim
      && !workspace.env.textprop
      && workspace.bufnr != this.document.bufnr) return
    if (colors.length == 0) return this.clearHighlight()
    this._colors = colors
    let groups = group(colors, 100)
    let cleared = false
    for (let colors of groups) {
      this.nvim.pauseNotification()
      if (!cleared) {
        cleared = true
        this.document.clearMatchIds(this.matchIds)
        this.matchIds.clear()
      }
      let colorRanges = this.getColorRanges(colors)
      this.addColors(colors.map(o => o.color))
      for (let o of colorRanges) {
        this.addHighlight(o.ranges, o.color)
      }
      this.nvim.command('redraw', true)
      await this.nvim.resumeNotification()
    }
  }

  private addHighlight(ranges: Range[], color: Color): void {
    let { red, green, blue } = toHexColor(color)
    let hlGroup = `BG${toHexString(color)}`
    let ids = this.document.highlightRanges(ranges, hlGroup, this.srcId)
    for (let id of ids) {
      this.matchIds.add(id)
    }
  }

  private addColors(colors: Color[]): void {
    let commands: string[] = []
    for (let color of colors) {
      let hex = toHexString(color)
      if (!usedColors.has(hex)) {
        commands.push(`hi BG${hex} guibg=#${hex} guifg=#${isDark(color) ? 'ffffff' : '000000'}`)
        usedColors.add(hex)
      }
    }
    this.nvim.command(commands.join('|'), true)
  }

  public clearHighlight(): void {
    let { matchIds } = this
    if (!this.document) return
    this.matchIds.clear()
    this.document.clearMatchIds(matchIds)
    this._colors = []
  }

  private getColorRanges(infos: ColorInformation[]): ColorRanges[] {
    let res: ColorRanges[] = []
    for (let info of infos) {
      let { color, range } = info
      let idx = res.findIndex(o => {
        return equals(toHexColor(o.color), toHexColor(color))
      })
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

  public hasColorAtPostion(position: Position): boolean {
    let { colors } = this
    return colors.some(o => positionInRange(position, o.range) == 0)
  }

  public dispose(): void {
    this.clearHighlight()
    this.document = null
  }
}

export function toHexString(color: Color): string {
  let c = toHexColor(color)
  return `${pad(c.red.toString(16))}${pad(c.green.toString(16))}${pad(c.blue.toString(16))}`
}

function pad(str: string): string {
  return str.length == 1 ? `0${str}` : str
}

function toHexColor(color: Color): { red: number, green: number, blue: number } {
  let { red, green, blue } = color
  return {
    red: Math.round(red * 255),
    green: Math.round(green * 255),
    blue: Math.round(blue * 255)
  }
}

function isDark(color: Color): boolean {
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
