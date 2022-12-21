'use strict'
import { Buffer, Neovim } from '@chemzqm/neovim'
import { Color, ColorInformation, Position, Range } from 'vscode-languageserver-types'
import languages, { ProviderName } from '../../languages'
import { SyncItem } from '../../model/bufferSync'
import Document from '../../model/document'
import { HighlightItem } from '../../types'
import { getConditionValue } from '../../util'
import { isDark, toHexString } from '../../util/color'
import * as Is from '../../util/is'
import { debounce } from '../../util/node'
import { comparePosition, positionInRange } from '../../util/position'
import { CancellationTokenSource } from '../../util/protocol'
import window from '../../window'
import workspace from '../../workspace'
const NAMESPACE = 'color'

export interface ColorRanges {
  color: Color
  ranges: Range[]
}

export interface ColorConfig {
  filetypes: string[] | null
  highlightPriority: number
}

const debounceTime = getConditionValue(200, 10)

export default class ColorBuffer implements SyncItem {
  private _colors: ColorInformation[] = []
  private tokenSource: CancellationTokenSource | undefined
  public highlight: Function & { clear(): void }
  private _enable: boolean | undefined
  // last highlight version
  constructor(
    private nvim: Neovim,
    public readonly doc: Document,
    private config: ColorConfig,
    private usedColors: Set<string>) {
    this.highlight = debounce(() => {
      void this.doHighlight()
    }, debounceTime)
    if (this.hasProvider) this.highlight()
  }

  public get enable(): boolean {
    if (Is.boolean(this._enable)) return this._enable
    this._enable = workspace.getConfiguration('colors', this.doc).get('enable', false)
    return this._enable
  }

  public updateDocumentConfig(): void {
    let enable = this.enabled
    this._enable = workspace.getConfiguration('colors', this.doc).get('enable', false)
    if (enable != this.enabled) {
      if (enable) {
        this.clearHighlight()
      } else {
        void this.doHighlight()
      }
    }
  }

  public toggle(): void {
    if (this._enable) {
      this._enable = false
      this.clearHighlight()
    } else {
      this._enable = true
      void this.doHighlight()
    }
  }

  private get hasProvider(): boolean {
    return languages.hasProvider(ProviderName.DocumentColor, this.doc)
  }

  public get enabled(): boolean {
    let { filetypes } = this.config
    let { filetype } = this.doc
    if (!workspace.env.updateHighlight || !this.hasProvider) return false
    if (Array.isArray(filetypes) && (filetypes.includes('*') || filetypes.includes(filetype))) return true
    return this.enable
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
