import workspace from './workspace'
import events from './events'
import Document from './model/document'
import languages from './languages'
import { Range, ColorInformation, Color, Disposable } from 'vscode-languageserver-protocol'
import { Neovim } from '@chemzqm/neovim'
import { equals } from './util/object'
import { disposeAll, wait } from './util'
import services from './services'
const logger = require('./util/logger')('colors')

export interface ColorRanges {
  color: Color
  ranges: Range[]
}

export default class Colors {
  private enabled: boolean
  private colors: Set<string> = new Set()
  private insertMode = false
  private disposables: Disposable[] = []
  private colorInfomation: Map<number, ColorInformation[]> = new Map()
  private matchIds: Map<number, number[]> = new Map()

  constructor(private nvim: Neovim) {
    let config = workspace.getConfiguration('coc.preferences')
    this.enabled = config.get<boolean>('colorSupport', true)
    events.on('InsertEnter', () => {
      this.insertMode = true
    }, null, this.disposables)

    events.on('InsertLeave', async () => {
      this.insertMode = false
      if (!this.enabled) return
      let doc = await workspace.document
      await this.highlightColors(doc)
    }, null, this.disposables)

    events.on('BufUnload', async bufnr => {
      this.colorInfomation.delete(bufnr)
      this.matchIds.delete(bufnr)
    }, null, this.disposables)

    events.on('BufEnter', async bufnr => {
      if (workspace.isVim) {
        let doc = workspace.getDocument(bufnr)
        if (doc) await this.highlightColors(doc)
      }
    }, null, this.disposables)

    services.on('ready', async () => {
      // wait for synchronize document
      await wait(200)
      workspace.documents.forEach(async document => {
        await this.highlightColors(document)
      })
    })

    workspace.onDidOpenTextDocument(async document => {
      await wait(200)
      let doc = workspace.getDocument(document.uri)
      if (doc) await this.highlightColors(doc)
    }, null, this.disposables)

    workspace.onDidChangeTextDocument(async e => {
      await wait(100)
      let doc = workspace.getDocument(e.textDocument.uri)
      if (!doc || this.insertMode) return
      await this.highlightColors(doc)
    }, null, this.disposables)

    workspace.onDidChangeConfiguration(async e => {
      if (e.affectsConfiguration('coc.preferences.colorSupport')) {
        let config = workspace.getConfiguration('coc.preferences')
        this.enabled = config.get<boolean>('colorSupport', true)
        if (this.enabled) {
          workspace.documents.forEach(async document => {
            await this.highlightColors(document)
          })
        } else {
          workspace.documents.forEach(async document => {
            await this.clearHighlight(document.bufnr)
          })
        }
      }
    })
  }

  private async highlightColors(document: Document): Promise<void> {
    if (['help', 'terminal', 'quickfix'].indexOf(document.buftype) !== -1) return
    if (!this.enabled) return
    try {
      let colors: ColorInformation[] = await languages.provideDocumentColors(document.textDocument)
      let old = this.colorInfomation.get(document.bufnr)
      if (!colors || colors.length == 0) {
        await this.clearHighlight(document.bufnr)
        return
      }
      if (old && equals(old, colors)) return
      await this.clearHighlight(document.bufnr)
      this.colorInfomation.set(document.bufnr, colors)
      let colorRanges = this.getColorRanges(colors)
      for (let o of colorRanges) {
        await this.addHighlight(document.bufnr, o.ranges, o.color)
      }
    } catch (e) {
      // tslint:disable-next-line:no-console
      console.error(`error on highlight: ${e.message}`)
      logger.error('error on highlight:', e.stack)
    }
  }

  private isDark(color: Color): boolean {
    let { red, green, blue } = toHexColor(color)
    let luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    return luma < 40
  }

  private async addColor(color: Color): Promise<void> {
    let hex = this.toHexString(color)
    if (this.colors.has(hex)) return
    this.colors.add(hex)
    await this.nvim.command(`hi BG${hex} guibg=#${hex} guifg=#${this.isDark(color) ? 'ffffff' : '000000'}`)
  }

  private async clearHighlight(bufnr: number): Promise<void> {
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
    await this.addColor(color)
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

  private toHexString(color: Color): string {
    let red = Math.round(color.red * 255).toString(16)
    let green = Math.round(color.green * 255).toString(16)
    let blue = Math.round(color.blue * 255).toString(16)
    return `${pad(red)}${pad(green)}${pad(blue)}`
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
    if (!presentations || presentations.length == 0) {
      workspace.showMessage('Language server failed to get color presentations', 'warning')
      return
    }
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
