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
  // used colors
  private colors: Color[] = []
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

  private colorExists(color: Color): boolean {
    return this.colors.findIndex(c => {
      return c.red == color.red && c.green == color.green && c.blue == color.blue
    }) != -1
  }

  private isDark(color: Color): boolean {
    let { red, green, blue } = color
    let luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    return luma < 40
  }

  private async addColor(color: Color): Promise<void> {
    let hex = this.toHexString(color)
    if (this.colorExists(color)) return
    this.colors.push(color)
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
