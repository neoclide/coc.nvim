'use strict'
import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationTokenSource, Color, ColorInformation, Position, Range } from 'vscode-languageserver-protocol'
import languages from '../../languages'
import { SyncItem } from '../../model/bufferSync'
import Document from '../../model/document'
import { HighlightItem } from '../../types'
import { isDark, toHexString } from '../../util/color'
import { comparePosition, positionInRange } from '../../util/position'
import window from '../../window'
import workspace from '../../workspace'
const logger = require('../../util/logger')('colors-buffer')
const NAMESPACE = 'color'

export interface ColorRanges {
  color: Color
  ranges: Range[]
}

export interface ColorConfig {
  filetypes: string[]
  highlightPriority: number
}

export default class ColorBuffer implements SyncItem {
  private _colors: ColorInformation[] = []
  private tokenSource: CancellationTokenSource | undefined
  public highlight: Function & { clear(): void }
  public enable: boolean
  // last highlight version
  constructor(
    private nvim: Neovim,
    private doc: Document,
    private config: ColorConfig,
    private usedColors: Set<string>) {
    this.updateDocumentConfig()
    this.highlight = debounce(() => {
      this.doHighlight().logError()
    }, global.__TEST__ ? 10 : 300)
    this.highlight()
  }

  public updateDocumentConfig(update = false): void {
    let enable = this.enabled
    this.enable = workspace.getConfiguration('colors', this.doc).get('enable', false)
    if (update && enable != this.enabled) {
      if (enable) {
        this.clearHighlight()
      } else {
        void this.doHighlight()
      }
    }
  }

  public get enabled(): boolean {
    let { filetypes } = this.config
    let { textDocument, filetype } = this.doc
    if (!languages.hasProvider('documentColor', textDocument)) return false
    if (filetypes.includes('*') || this.enable) return true
    return filetypes.includes(filetype)
  }

  public onChange(): void {
    this.cancel()
    this.highlight()
  }

  public get buffer(): Buffer {
    return this.doc.buffer
  }

  public get colors(): ColorInformation[] {
    return this._colors
  }

  public hasColor(): boolean {
    return this._colors.length > 0
  }

  public async doHighlight(): Promise<void> {
    if (!this.enabled) return
    this.enable = true
    let { nvim, doc } = this
    this.tokenSource = new CancellationTokenSource()
    let { token } = this.tokenSource
    let colors: ColorInformation[]
    colors = await languages.provideDocumentColors(doc.textDocument, token)
    if (token.isCancellationRequested) return
    colors = colors || []
    colors.sort((a, b) => comparePosition(a.range.start, b.range.start))
    this._colors = colors
    let items: HighlightItem[] = []
    colors.forEach(o => {
      let hlGroup = getHighlightGroup(o.color)
      doc.addHighlights(items, hlGroup, o.range, { combine: false })
    })
    let diff = await window.diffHighlights(doc.bufnr, NAMESPACE, items)
    if (token.isCancellationRequested || !diff) return
    nvim.pauseNotification()
    this.defineColors(colors)
    nvim.resumeNotification(false, true)
    await window.applyDiffHighlights(doc.bufnr, NAMESPACE, this.config.highlightPriority, diff, true)
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

  public hasColorAtPosition(position: Position): boolean {
    return this.colors.some(o => positionInRange(position, o.range) == 0)
  }

  public clearHighlight(): void {
    this.highlight.clear()
    this._colors = []
    this.buffer.clearNamespace('color')
  }

  public cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource.dispose()
      this.tokenSource = null
    }
  }

  public dispose(): void {
    this._colors = []
    this.highlight.clear()
    this.cancel()
  }
}

function getHighlightGroup(color: Color): string {
  return `BG${toHexString(color)}`
}
