'use strict'
import { Neovim, VirtualTextOption } from '@chemzqm/neovim'
import { InlayHintKind, Range } from 'vscode-languageserver-types'
import events from '../../events'
import languages, { ProviderName } from '../../languages'
import { createLogger } from '../../logger'
import { SyncItem } from '../../model/bufferSync'
import Document from '../../model/document'
import Regions from '../../model/regions'
import { getLabel, InlayHintWithProvider } from '../../provider/inlayHintManager'
import { getConditionValue, waitWithToken } from '../../util'
import { CancellationError, onUnexpectedError } from '../../util/errors'
import { positionInRange } from '../../util/position'
import { CancellationToken, CancellationTokenSource, Emitter, Event } from '../../util/protocol'
import { byteIndex } from '../../util/string'
import window from '../../window'
import workspace from '../../workspace'
const logger = createLogger('inlayHint-buffer')

export interface InlayHintConfig {
  enable: boolean
  position: InlayHintPosition,
  display: boolean
  filetypes: string[]
  refreshOnInsertMode: boolean
  enableParameter: boolean
  maximumLength: number
}

export interface VirtualTextItem extends VirtualTextOption {
  /**
   * Zero based line number
   */
  line: number
  /**
   * List with [text, hl_group]
   */
  blocks: [string, string][]
}

export enum InlayHintPosition {
  Inline = "inline",
  Eol = "eol",
}

export interface RenderConfig {
  winid: number
  region: [number, number]
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

/**
 * Full Virtual text render when first render.
 * Update visible regions on TextChange and visible lines change.
 */
export default class InlayHintBuffer implements SyncItem {
  private tokenSource: CancellationTokenSource
  private regions = new Regions()
  private _config: InlayHintConfig | undefined
  private _dirty = false
  private _changedtick: number
  // Saved for resolve and TextEdits in the future.
  private currentHints: InlayHintWithProvider[] = []
  private readonly _onDidRefresh = new Emitter<void>()
  public readonly onDidRefresh: Event<void> = this._onDidRefresh.event
  constructor(
    private readonly nvim: Neovim,
    public readonly doc: Document
  ) {
    this.render().catch(onUnexpectedError)
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
      maximumLength: config.get<number>('maximumLength', 0),
    }
    if (changeEnable || changeDisplay) {
      let { enable, display } = this._config
      if (enable && display) {
        this.render(undefined, 0).catch(onUnexpectedError)
      } else {
        this.clearCache()
        this.clearVirtualText()
      }
    }
  }

  public onInsertLeave(): void {
    if (this.config.refreshOnInsertMode || this.doc.changedtick === this._changedtick) return
    this.render().catch(onUnexpectedError)
  }

  public onInsertEnter(): void {
    this._changedtick = this.doc.changedtick
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
    this.render(undefined, 0).catch(onUnexpectedError)
  }

  public disable() {
    this.checkState()
    this.config.display = false
    this.clearCache()
    this.clearVirtualText()
  }

  private checkState(): void {
    if (!languages.hasProvider(ProviderName.InlayHint, this.doc.textDocument)) throw new Error('Inlay hint provider not found for current document')
    if (!this.configEnabled) throw new Error(`Filetype "${this.doc.filetype}" not enabled by inlayHint configuration, see ':h coc-config-inlayHint'`)
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
    this.render().catch(onUnexpectedError)
  }

  public cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = null
    }
  }

  public onVisible(winid: number, region: Readonly<[number, number]>): void {
    // Ensure rendered once before range render.
    if (!this._dirty) return
    // already debounced
    this.render({
      winid,
      region: [region[0], region[1]]
    }, 0).catch(onUnexpectedError)
  }

  public async render(config?: RenderConfig, delay?: number): Promise<void> {
    if (!this.enabled) return
    if (!this.config.refreshOnInsertMode && events.bufnr === this.doc.bufnr && events.insertMode) return
    this.cancel()
    this.tokenSource = new CancellationTokenSource()
    let token = this.tokenSource.token
    await waitWithToken(typeof delay === 'number' ? delay : debounceInterval, token)
    if (!srcId) srcId = await this.nvim.createNamespace('coc-inlayHint')
    if (token.isCancellationRequested || this.doc.dirty) return
    if (!this._dirty) {
      await this.renderAll(token)
    } else if (config) {
      let region = config.region
      await this.renderRange([region[0] - 1, region[1] - 1], token)
    } else {
      // Could be text change or provider change.
      const spans = await window.getVisibleRanges(this.doc.bufnr)
      for (const [topline, botline] of spans) {
        if (token.isCancellationRequested) break
        await this.renderRange([topline - 1, botline - 1], token)
      }
    }
  }

  private async renderAll(token: CancellationToken): Promise<void> {
    const lineCount = this.doc.lineCount
    const range = Range.create(0, 0, lineCount, 0)
    const inlayHints = await this.request(range, token)
    if (!inlayHints) return
    this.currentHints = inlayHints
    this.setVirtualText(range, inlayHints)
    this.regions.add(0, lineCount)
    this._dirty = true
  }

  /**
   * 0 based startLine and endLine
   */
  public async renderRange(lines: [number, number], token: CancellationToken): Promise<void> {
    let span = this.regions.toUncoveredSpan(lines, workspace.env.lines, this.doc.lineCount)
    if (!span) return
    const [startLine, endLine] = span
    const range = this.doc.textDocument.intersectWith(Range.create(startLine, 0, endLine + 1, 0))
    const inlayHints = await this.request(range, token)
    if (!inlayHints) return
    this.currentHints = this.currentHints.filter(o => positionInRange(o.position, range) !== 0)
    this.currentHints.push(...inlayHints)
    this.setVirtualText(range, inlayHints)
    this.regions.add(startLine, endLine)
  }

  private async request(range: Range, token: CancellationToken): Promise<InlayHintWithProvider[] | undefined> {
    let inlayHints: InlayHintWithProvider[]
    try {
      inlayHints = await languages.provideInlayHints(this.doc.textDocument, range, token)
    } catch (e) {
      if (!token.isCancellationRequested && e instanceof CancellationError) {
        // server cancel, wait for more time
        this.render(undefined, requestDelay).catch(onUnexpectedError)
        return
      }
    }
    if (inlayHints == null || token.isCancellationRequested) return
    if (!this.config.enableParameter) {
      inlayHints = inlayHints.filter(o => o.kind !== InlayHintKind.Parameter)
    }
    return inlayHints
  }

  public setVirtualText(range: Range, inlayHints: InlayHintWithProvider[]): void {
    let { nvim, doc } = this
    let buffer = doc.buffer
    const { maximumLength } = this.config
    nvim.pauseNotification()
    const end = range.end.line >= doc.lineCount ? -1 : range.end.line + 1
    buffer.clearNamespace(srcId, range.start.line, end)
    let lineInfo = { lineNum: 0, totalLineLen: 0 }
    const vitems: VirtualTextItem[] = []
    for (const item of inlayHints) {
      const blocks = []
      let { position } = item
      if (lineInfo.lineNum !== position.line) {
        lineInfo = { lineNum: position.line, totalLineLen: 0 }
      }
      if (maximumLength > 0 && lineInfo.totalLineLen > maximumLength) {
        logger.warn(`Inlay hint of ${lineInfo.lineNum} too long, max length: ${maximumLength}, current line total length: ${lineInfo.totalLineLen}`)
        continue
      }

      let line = this.doc.getline(position.line)
      let col = byteIndex(line, position.character) + 1

      let label = getLabel(item)
      lineInfo.totalLineLen += label.length
      const over = maximumLength > 0 ? lineInfo.totalLineLen - maximumLength : 0
      if (over > 0) {
        label = label.slice(0, -over) + '…'
      }

      if (item.paddingLeft) blocks.push([' ', 'Normal'])
      blocks.push([label, getHighlightGroup(item.kind)])
      if (item.paddingRight) blocks.push([' ', 'Normal'])
      if (this.config.position == InlayHintPosition.Eol) {
        col = 0
      }
      let opts: VirtualTextItem = { line: position.line, blocks, col, hl_mode: 'replace' }
      if (item.kind == InlayHintKind.Parameter) {
        opts.right_gravity = false
      }
      vitems.push(opts)
    }
    nvim.call('coc#vtext#set', [buffer.id, srcId, vitems, false, 200], true)
    nvim.resumeNotification(true, true)
    this._onDidRefresh.fire()
  }

  public clearVirtualText(): void {
    if (srcId) this.doc.buffer.clearNamespace(srcId)
  }

  public dispose(): void {
    this.clearCache()
  }
}
