import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationToken, CancellationTokenSource, Color, ColorInformation, Disposable, Position, Range } from 'vscode-languageserver-protocol'
import Document from '../model/document'
import { wait } from '../util'
import { group } from '../util/array'
import { equals } from '../util/object'
import { positionInRange } from '../util/position'
import workspace from '../workspace'
import languages from '../languages'
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
  constructor(private nvim: Neovim, private bufnr: number, private srcId) {
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
    this.cancel()
    let doc = workspace.getDocument(this.bufnr)
    if (!doc) return
    this.tokenSource = new CancellationTokenSource()
    let { token } = this.tokenSource
    await synchronizeDocument(doc)
    if (workspace.insertMode) return
    if (token.isCancellationRequested) return
    if (this.version && doc.version == this.version) return
    let colors: ColorInformation[]
    try {
      colors = await languages.provideDocumentColors(doc.textDocument, token)
      colors = colors || []
      if (token.isCancellationRequested) return
      this.version = doc.version
    } catch (e) {
      logger.error('Error on request colors:', e)
    }
    await this.addHighlight(doc, colors, token)
  }

  private async addHighlight(doc: Document, colors: ColorInformation[], token: CancellationToken): Promise<void> {
    colors = colors || []
    if (equals(this._colors, colors) || !doc) return
    this._colors = colors
    // improve performance
    let groups = group(colors, 100)
    let cleared = false
    for (let colors of groups) {
      if (token.isCancellationRequested) {
        this._colors = []
        return
      }
      this.nvim.pauseNotification()
      if (!cleared) {
        this.buffer.clearHighlight({ srcId: this.srcId })
        cleared = true
      }
      let colorRanges = this.getColorRanges(colors)
      this.addColors(colors.map(o => o.color))
      for (let o of colorRanges) {
        this.highlightColor(doc, o.ranges, o.color)
      }
      this.nvim.command('redraw', true)
      await this.nvim.resumeNotification()
    }
  }

  private highlightColor(doc: Document, ranges: Range[], color: Color): void {
    let { red, green, blue } = toHexColor(color)
    let hlGroup = `BG${toHexString(color)}`
    doc.highlightRanges(ranges, hlGroup, this.srcId)
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
    this.buffer.clearHighlight({ srcId: this.srcId })
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
      this.tokenSource.cancel()
      this.tokenSource.dispose()
    }
  }
}

export function toHexString(color: Color): string {
  let c = toHexColor(color)
  return `${pad(c.red.toString(16))}${pad(c.green.toString(16))}${pad(c.blue.toString(16))}`
}

function pad(str: string): string {
  return str.length == 1 ? `0${str}` : str
}

function toHexColor(color: Color): { red: number; green: number; blue: number } {
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

async function synchronizeDocument(doc: Document): Promise<void> {
  let { changedtick } = doc
  await doc.patchChange()
  if (changedtick != doc.changedtick) {
    await wait(50)
  }
}
