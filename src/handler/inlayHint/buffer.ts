'use strict'
import { Neovim, VirtualTextOption } from '@chemzqm/neovim'
import { InlayHintKind, Range } from 'vscode-languageserver-types'
import events from '../../events'
import languages, { ProviderName } from '../../languages'
import { SyncItem } from '../../model/bufferSync'
import Document from '../../model/document'
import Regions from '../../model/regions'
import { getLabel, InlayHintWithProvider } from '../../provider/inlayHintManager'
import { getConditionValue, waitWithToken } from '../../util'
import { CancellationError } from '../../util/errors'
import { positionInRange } from '../../util/position'
import { CancellationToken, CancellationTokenSource, Emitter, Event } from '../../util/protocol'
import { byteIndex } from '../../util/string'
import window from '../../window'
import workspace from '../../workspace'

export interface InlayHintConfig {
  enable: boolean
  position: InlayHintPosition,
  display: boolean
  filetypes: string[]
  refreshOnInsertMode: boolean
  enableParameter: boolean
}

export enum InlayHintPosition {
  Inline = "inline",
  Eol = "eol",
}

let srcId: number | undefined
const debounceInterval = getConditionValue(150, 10)
const requestDelay = getConditionValue(500, 10)

function getHighlightGroup(kind: InlayHintKind): string {
  switch (kind) {
    case InlayHintKind.Parameter:
      return 'CocInlayHintParameter'
    case InlayHintKind.Type:
      return 'CocInlayHintType'
    default:
      return 'CocInlayHint'
  }
}

export default class InlayHintBuffer implements SyncItem {
  private tokenSource: CancellationTokenSource
  private regions = new Regions()
  private _config: InlayHintConfig | undefined
  // Saved for resolve and TextEdits in the future.
  private currentHints: InlayHintWithProvider[] = []
  private readonly _onDidRefresh = new Emitter<void>()
  public readonly onDidRefresh: Event<void> = this._onDidRefresh.event
  constructor(
    private readonly nvim: Neovim,
    public readonly doc: Document
  ) {
    void this.render()
  }

  public get config(): InlayHintConfig {
    if (this._config) return this._config
    this.loadConfiguration()
    return this._config
  }

  public loadConfiguration(): void {
    let config = workspace.getConfiguration('inlayHint', this.doc)
    let changeEnable = this._config && this._config.enable !== config.enable
    let changeDisplay = this._config && this._config.display !== config.display
    this._config = {
      enable: config.get<boolean>('enable'),
      position: config.get<InlayHintPosition>('position'),
      display: config.get<boolean>('display', true),
      filetypes: config.get<string[]>('filetypes'),
      refreshOnInsertMode: config.get<boolean>('refreshOnInsertMode'),
      enableParameter: config.get<boolean>('enableParameter'),
    }
    if (changeEnable || changeDisplay) {
      let { enable, display } = this._config
      if (enable && display) {
        void this.render(0)
      } else {
        this.clearCache()
        this.clearVirtualText()
      }
    }
  }

  public onInsertLeave(): void {
    if (this.config.refreshOnInsertMode) return
    void this.render()
  }

  public onInsertEnter(): void {
    if (this.config.refreshOnInsertMode) return
    this.cancel()
  }

  public get current(): ReadonlyArray<InlayHintWithProvider> {
    return this.currentHints
  }

  public get enabled(): boolean {
    if (!this.config.display || !this.configEnabled) return false
    return this.hasProvider
  }

  private get hasProvider(): boolean {
    return languages.hasProvider(ProviderName.InlayHint, this.doc)
  }

  public get configEnabled(): boolean {
    let { filetypes, enable } = this.config
    if (Array.isArray(filetypes)) return filetypes.includes('*') || filetypes.includes(this.doc.filetype)
    return enable === true
  }

  public enable() {
    this.checkState()
    this.config.display = true
    void this.render()
  }

  public disable() {
    this.checkState()
    this.config.display = false
    this.clearCache()
    this.clearVirtualText()
  }

  private checkState(): void {
    if (!languages.hasProvider(ProviderName.InlayHint, this.doc.textDocument)) throw new Error('Inlay hint provider not found for current document')
    if (!this.configEnabled) throw new Error(`Filetype "${this.doc.filetype}" not enabled by inlayHint configuration`)
  }

  public toggle(): void {
    if (this.config.display) {
      this.disable()
    } else {
      this.enable()
    }
  }

  public clearCache(): void {
    this.cancel()
    this.currentHints = []
    this.regions.clear()
  }

  public onTextChange(): void {
    this.clearCache()
  }

  public onChange(): void {
    void this.render()
  }

  public cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = null
    }
  }

  private async requestInlayHints(range: Range, token: CancellationToken): Promise<InlayHintWithProvider[] | null> {
    try {
      return await languages.provideInlayHints(this.doc.textDocument, range, token)
    } catch (e) {
      if (!token.isCancellationRequested && e instanceof CancellationError) {
        // server cancel, wait for more time
        void this.render(undefined, requestDelay)
      }
    }
  }

  public async render(winid?: number, delay?: number): Promise<void> {
    this.cancel()
    if ((events.insertMode && !this.config.refreshOnInsertMode) || !this.enabled) return
    this.tokenSource = new CancellationTokenSource()
    let token = this.tokenSource.token
    await waitWithToken(typeof delay === 'number' ? delay : debounceInterval, token)
    if (token.isCancellationRequested) return
    const { doc } = this
    const spans = await window.getVisibleRanges(doc.bufnr, winid)
    if (!srcId) srcId = await this.nvim.createNamespace('coc-inlayHint')
    for (const [topline, botline] of spans) {
      if (token.isCancellationRequested) break
      await this.renderRange([topline - 1, botline - 1], token)
    }
  }

  /**
   * 0 based startLine and endLine
   */
  private async renderRange(lines: [number, number], token: CancellationToken): Promise<void> {
    let span = this.regions.toUncoveredSpan(lines, workspace.env.lines, this.doc.lineCount)
    if (!span) return
    const [startLine, endLine] = span
    const range = this.doc.textDocument.intersectWith(Range.create(startLine, 0, endLine + 1, 0))
    let inlayHints = await this.requestInlayHints(range, token)
    if (inlayHints == null || token.isCancellationRequested) return
    if (!this.config.enableParameter) {
      inlayHints = inlayHints.filter(o => o.kind !== InlayHintKind.Parameter)
    }
    this.currentHints = this.currentHints.filter(o => positionInRange(o.position, range) !== 0)
    this.currentHints.push(...inlayHints)
    this.setVirtualText(range, inlayHints)
    this.regions.add(startLine, endLine)
  }

  public setVirtualText(range: Range, inlayHints: InlayHintWithProvider[]): void {
    let { nvim, doc } = this
    let buffer = doc.buffer
    nvim.pauseNotification()
    buffer.clearNamespace(srcId, range.start.line, range.end.line + 1)
    for (const item of inlayHints) {
      const chunks = []
      let { position } = item
      let line = this.doc.getline(position.line)
      let col = byteIndex(line, position.character) + 1
      if (item.paddingLeft) {
        chunks.push(nvim.isVim ? [' ', 'Normal'] : [' '])
      }
      chunks.push([getLabel(item), getHighlightGroup(item.kind)])
      if (item.paddingRight) {
        chunks.push(nvim.isVim ? [' ', 'Normal'] : [' '])
      }
      if (this.config.position == InlayHintPosition.Eol) {
        col = 0
      }
      let opts: VirtualTextOption = { col, hl_mode: 'replace' }
      if (item.kind == InlayHintKind.Parameter) {
        opts.right_gravity = false
      }
      buffer.setVirtualText(srcId, position.line, chunks, opts)
    }
    nvim.resumeNotification(false, true)
    this._onDidRefresh.fire()
  }

  public clearVirtualText(): void {
    if (srcId) this.doc.buffer.clearNamespace(srcId)
  }

  public dispose(): void {
    this.cancel()
    this.regions.clear()
  }
}
