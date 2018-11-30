import { Neovim } from '@chemzqm/neovim'
import { Color, ColorInformation, Disposable, Range } from 'vscode-languageserver-protocol'
import events from './events'
import languages from './languages'
import Document from './model/document'
import { disposeAll, wait } from './util'
import { equals } from './util/object'
import workspace from './workspace'
import services from './services'

const logger = require('./util/logger')('colors')

export interface ColorRanges {
  color: Color
  ranges: Range[]
}

export default class Colors {
  private _enabled: boolean
  private maxColorCount: number
  private colors: Set<string> = new Set()
  private disposables: Disposable[] = []
  private colorInfomation: Map<number, ColorInformation[]> = new Map()
  private matchIds: Map<number, number[]> = new Map()
  private documentVersions: Map<number, number> = new Map()

  constructor(private nvim: Neovim) {
    let config = workspace.getConfiguration('coc.preferences')
    this._enabled = config.get<boolean>('colorSupport', true)
    this.maxColorCount = config.get<number>('maxColorCount', 300)

    events.on('BufEnter', async bufnr => {
      await wait(100)
      let doc = workspace.getDocument(bufnr)
      if (doc) this.highlightColors(doc) // tslint:disable-line
    }, null, this.disposables)

    events.on('BufUnload', async bufnr => {
      this.colorInfomation.delete(bufnr)
      this.matchIds.delete(bufnr)
      this.documentVersions.delete(bufnr)
    }, null, this.disposables)

    events.on(['InsertLeave'], async () => {
      let doc = await workspace.document
      if (!doc || !this.enabled) return
      await this.highlightColors(doc)
    }, null, this.disposables)

    let timer: NodeJS.Timer = null
    services.on('ready', async id => {
      let service = services.getService(id)
      let doc = await workspace.document
      if (!doc) return
      if (workspace.match(service.selector, doc.textDocument)) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          this.highlightColors(doc, true) // tslint:disable-line
        }, 100)
      }
    })

    workspace.onDidChangeTextDocument(async change => {
      let { mode } = await nvim.mode
      if (mode.startsWith('i')) return
      await wait(100)
      let doc = workspace.getDocument(change.textDocument.uri)
      if (doc) this.highlightColors(doc) // tslint:disable-line
    })

    workspace.onDidChangeConfiguration(async e => {
      if (e.affectsConfiguration('coc.preferences.maxColorCount')) {
        let config = workspace.getConfiguration('coc.preferences')
        this.maxColorCount = config.get<number>('maxColorCount', 300)
      }
      if (e.affectsConfiguration('coc.preferences.colorSupport')) {
        let config = workspace.getConfiguration('coc.preferences')
        this._enabled = config.get<boolean>('colorSupport', true)
      }
    })
  }

  public async highlightColors(document: Document, force = false): Promise<void> {
    if (['help', 'terminal', 'quickfix'].indexOf(document.buftype) !== -1) return
    let { bufnr, version } = document
    try {
      let curr = this.documentVersions.get(bufnr)
      if (curr == version && !force) return
      this.documentVersions.set(bufnr, version)
      let colors: ColorInformation[] = await languages.provideDocumentColors(document.textDocument)
      let old = this.colorInfomation.get(document.bufnr)
      if (!colors || colors.length == 0) {
        this.colorInfomation.delete(document.bufnr)
        await this.clearHighlight(document.bufnr)
        return
      }
      if (old && equals(old, colors)) return
      colors = colors.slice(0, this.maxColorCount)
      await this.clearHighlight(bufnr)
      this.colorInfomation.set(bufnr, colors)
      let colorRanges = this.getColorRanges(colors)
      await this.addColors(colors.map(o => o.color))
      for (let o of colorRanges) {
        await this.addHighlight(bufnr, o.ranges, o.color)
      }
    } catch (e) {
      this.colorInfomation.delete(bufnr)
      this.documentVersions.delete(bufnr)
      logger.error('error on highlight:', e.stack)
    }
  }

  private isDark(color: Color): boolean {
    let { red, green, blue } = toHexColor(color)
    let luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    return luma < 40
  }

  private async addColors(colors: Color[]): Promise<void> {
    let commands: string[] = []
    for (let color of colors) {
      let hex = this.toHexString(color)
      if (!this.colors.has(hex)) {
        commands.push(`hi BG${hex} guibg=#${hex} guifg=#${this.isDark(color) ? 'ffffff' : '000000'}`)
        this.colors.add(hex)
      }
    }
    this.nvim.command(commands.join('|'), true)
  }

  public async clearHighlight(bufnr: number): Promise<void> {
    this.colorInfomation.delete(bufnr)
    let ids = this.matchIds.get(bufnr)
    if (!ids || ids.length == 0) return
    let doc = this.getDocument(bufnr)
    if (!doc) return
    await doc.clearMatchIds(ids)
    this.matchIds.set(bufnr, [])
  }

  private async addHighlight(bufnr: number, ranges: Range[], color: Color): Promise<void> {
    let doc = this.getDocument(bufnr)
    if (!doc) return
    let { red, green, blue } = toHexColor(color)
    let hlGroup = `BG${this.toHexString(color)}`
    let matchIds: number[] = this.matchIds.get(bufnr) || []
    let ids = await doc.highlightRanges(ranges, hlGroup)
    matchIds.push(...ids)
    if (!this.matchIds.has(bufnr)) {
      this.matchIds.set(bufnr, matchIds)
    }
  }

  // for vim, only highlight current buffer
  private getDocument(bufnr: number): Document | null {
    if (workspace.isNvim || workspace.bufnr == bufnr) {
      let document = workspace.getDocument(bufnr)
      return document
    }
    return null
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

  public toHexString(color: Color): string {
    let c = toHexColor(color)
    return `${pad(c.red.toString(16))}${pad(c.green.toString(16))}${pad(c.blue.toString(16))}`
  }

  private async currentColorInfomation(): Promise<ColorInformation | null> {
    let { document, position } = await workspace.getCurrentState()
    let doc = workspace.getDocument(document.uri)
    if (!doc) return
    let colorInfos = this.colorInfomation.get(doc.bufnr)
    for (let info of colorInfos) {
      let { range } = info
      let { start, end } = range
      if (position.line == start.line
        && position.character >= start.character
        && position.character <= end.character) {
        return info
      }
    }
    return null
  }

  public async pickPresentation(): Promise<void> {
    let info = await this.currentColorInfomation()
    if (!info) return workspace.showMessage('Color not found at current position', 'warning')
    let document = await workspace.document
    let presentations = await languages.provideColorPresentations(info, document.textDocument)
    if (!presentations || presentations.length == 0) return
    let res = await workspace.showQuickpick(presentations.map(o => o.label), 'choose a color presentation:')
    if (res == -1) return
    let presentation = presentations[res]
    let { textEdit, additionalTextEdits, label } = presentation
    if (!textEdit) textEdit = { range: info.range, newText: label }
    await document.applyEdits(this.nvim, [textEdit])
    if (additionalTextEdits) {
      await document.applyEdits(this.nvim, additionalTextEdits)
    }
  }

  public async pickColor(): Promise<void> {
    let info = await this.currentColorInfomation()
    if (!info) return workspace.showMessage('Color not found at current position', 'warning')
    let { color } = info
    let colorArr = [(color.red * 256).toFixed(0), (color.green * 256).toFixed(0), (color.blue * 256).toFixed(0)]
    let res = await this.nvim.call('coc#util#pick_color', [colorArr])
    if (!res || res.length != 3) {
      workspace.showMessage('Failed to get color', 'warning')
      return
    }
    let hex = this.toHexString({
      red: (res[0] / 65536),
      green: (res[1] / 65536),
      blue: (res[2] / 65536),
      alpha: 1
    })
    let document = await workspace.document
    await document.applyEdits(this.nvim, [{
      range: info.range,
      newText: `#${hex}`
    }])
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }

  public get enabled(): boolean {
    return this._enabled
  }

  public hasColor(bufnr: number): boolean {
    return this.colorInfomation.has(bufnr)
  }
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
