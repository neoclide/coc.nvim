'use strict'
import { Neovim } from '@chemzqm/neovim'
import { InlayHintKind, Range } from 'vscode-languageserver-types'
import events from '../../events'
import languages, { ProviderName } from '../../languages'
import { SyncItem } from '../../model/bufferSync'
import Document from '../../model/document'
import Regions from '../../model/regions'
import { getLabel, InlayHintWithProvider } from '../../provider/inlayHintManager'
import { delay, getConditionValue } from '../../util'
import { CancellationError } from '../../util/errors'
import { positionInRange } from '../../util/position'
import { CancellationToken, CancellationTokenSource, Emitter, Event } from '../../util/protocol'
import { byteIndex } from '../../util/string'
import workspace from '../../workspace'

export interface InlayHintConfig {
  enable: boolean
  display: boolean
  filetypes: string[]
  refreshOnInsertMode: boolean
  enableParameter: boolean
}

let srcId: number | undefined
const debounceInterval = getConditionValue(100, 10)
const requestDelay = getConditionValue(500, 10)

// Extend the rendering range for better experience when scrolling
const RenderRangeExtendSize = 10

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
  public render: ((ms?: number) => void) & { clear: () => void }
  constructor(
    private readonly nvim: Neovim,
    public readonly doc: Document
  ) {
    this.render = delay(() => {
      void this.renderRange()
    }, debounceInterval)
    if (this.hasProvider) this.render()
  }

  public get config(): InlayHintConfig {
    if (this._config) return this._config
    this.loadConfiguration()
    return this._config
  }

  public loadConfiguration(): void {
    let config = workspace.getConfiguration('inlayHint', this.doc)
    let changed = this._config && this._config.enable != config.enable
    this._config = {
      enable: config.get<boolean>('enable'),
      display: config.get<boolean>('display', true),
      filetypes: config.get<string[]>('filetypes'),
      refreshOnInsertMode: config.get<boolean>('refreshOnInsertMode'),
      enableParameter: config.get<boolean>('enableParameter'),
    }
    if (changed) {
      let { enable, display } = this._config
      if (enable) {
        this.clearCache()
        this.clearVirtualText()
      } else if (display) {
        void this.renderRange()
      }
    }
  }

  public onInsertLeave(): void {
    if (this.config.refreshOnInsertMode) return
    this.render()
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
    if (workspace.isNvim && !workspace.has('nvim-0.10.0') && !global.__TEST__) return false
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

  public toggle(): void {
    if (!languages.hasProvider(ProviderName.InlayHint, this.doc.textDocument)) throw new Error('Inlay hint provider not found for current document')
    if (!this.configEnabled) throw new Error(`Filetype "${this.doc.filetype}" not enabled by inlayHint configuration`)
    if (this.config.display) {
      this.config.display = false
      this.clearCache()
      this.clearVirtualText()
    } else {
      this.config.display = true
      void this.renderRange()
    }
  }

  public clearCache(): void {
    this.currentHints = []
    this.regions.clear()
    this.render.clear()
  }

  public onTextChange(): void {
    this.clearCache()
    this.cancel()
  }

  public onChange(): void {
    this.cancel()
    this.render()
  }

  public cancel(): void {
    this.render.clear()
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
        // wait for more time
        this.render(requestDelay)
      }
    }
  }

  public async renderRange(): Promise<void> {
    this.cancel()
    if ((events.insertMode && !this.config.refreshOnInsertMode) || !this.enabled) return
    this.tokenSource = new CancellationTokenSource()
    let token = this.tokenSource.token
    let res = await this.nvim.call('coc#window#visible_range', [this.doc.bufnr]) as [number, number]
    if (!Array.isArray(res) || res[1] <= 0 || token.isCancellationRequested) return
    if (!srcId) srcId = await this.nvim.createNamespace('coc-inlayHint')
    if (token.isCancellationRequested || this.regions.has(res[0], res[1])) return
    const startLine = Math.max(0, res[0] - RenderRangeExtendSize)
    const endLine = Math.min(this.doc.lineCount, res[1] + RenderRangeExtendSize)
    let range = Range.create(startLine, 0, endLine, 0)
    let inlayHints = await this.requestInlayHints(range, token)
    if (inlayHints == null || token.isCancellationRequested) return
    this.regions.add(res[0], res[1])
    if (!this.config.enableParameter) {
      inlayHints = inlayHints.filter(o => o.kind !== InlayHintKind.Parameter)
    }
    this.currentHints = this.currentHints.filter(o => positionInRange(o.position, range) !== 0)
    this.currentHints.push(...inlayHints)
    this.setVirtualText(range, inlayHints)
  }

  public setVirtualText(range: Range, inlayHints: InlayHintWithProvider[]): void {
    let { nvim, doc } = this
    let buffer = doc.buffer

    nvim.pauseNotification()
    buffer.clearNamespace(srcId, range.start.line, range.end.line + 1)
    for (const item of inlayHints) {
      const chunks: [string, string][] = []
      let { position } = item
      let line = this.doc.getline(position.line)
      let col = byteIndex(line, position.character) + 1
      if (item.paddingLeft) {
        chunks.push([' ', 'Normal'])
      }
      chunks.push([getLabel(item), getHighlightGroup(item.kind)])
      if (item.paddingRight) {
        chunks.push([' ', 'Normal'])
      }
      buffer.setVirtualText(srcId, position.line, chunks, { col })
    }
    nvim.resumeNotification(true, true)
    this._onDidRefresh.fire()
  }

  public clearVirtualText(): void {
    if (srcId) this.doc.buffer.clearNamespace(srcId)
  }

  public dispose(): void {
    this.cancel()
  }
}
