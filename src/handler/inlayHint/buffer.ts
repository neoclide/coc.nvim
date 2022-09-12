'use strict'
import { Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationTokenSource, Emitter, Event, InlayHintKind, Range } from 'vscode-languageserver-protocol'
import events from '../../events'
import languages from '../../languages'
import { SyncItem } from '../../model/bufferSync'
import Document from '../../model/document'
import Regions from '../../model/regions'
import { getLabel, InlayHintWithProvider } from '../../provider/inlayHintManager'
import { positionInRange } from '../../util/position'
import { byteIndex } from '../../util/string'
import workspace from '../../workspace'
const logger = require('../../util/logger')('inlayHint-buffer')

export interface InlayHintConfig {
  enable: boolean
  filetypes: string[]
  refreshOnInsertMode: boolean
  enableParameter: boolean
  typeSeparator: string
  parameterSeparator: string
  subSeparator: string
}

let srcId: number | undefined
const debounceInterval = global.__TEST__ ? 10 : 100
const highlightGroup = 'CocInlayHint'

export default class InlayHintBuffer implements SyncItem {
  private _enabled = true
  private tokenSource: CancellationTokenSource
  private regions = new Regions()
  private config: InlayHintConfig
  // Saved for resolve and TextEdits in the future.
  private currentHints: InlayHintWithProvider[] = []
  private readonly _onDidRefresh = new Emitter<void>()
  public readonly onDidRefresh: Event<void> = this._onDidRefresh.event
  public render: Function & { clear(): void }
  constructor(
    private readonly nvim: Neovim,
    public readonly doc: Document
  ) {
    this.loadConfiguration()
    this.render = debounce(() => {
      void this.renderRange()
    }, debounceInterval)
    this.render()
  }

  public loadConfiguration(): void {
    let config = workspace.getConfiguration('inlayHint', this.doc)
    let changed = this.config && this.config.enable != config.enable
    this.config = {
      enable: config.get<boolean>('enable'),
      filetypes: config.get<string[]>('filetypes'),
      refreshOnInsertMode: config.get<boolean>('refreshOnInsertMode'),
      enableParameter: config.get<boolean>('enableParameter'),
      typeSeparator: config.get<string>('typeSeparator', ''),
      parameterSeparator: config.get<string>('parameterSeparator', ''),
      subSeparator: config.get<string>('subSeparator', ' ')
    }
    if (changed) {
      if (this.config.enable) {
        this.clearCache()
        this.clearVirtualText()
      } else {
        void this.renderRange()
      }

    }
  }

  public async onInsertLeave(): Promise<void> {
    if (this.config.refreshOnInsertMode) return
    await this.renderRange()
  }

  public onInsertEnter(): void {
    if (this.config.refreshOnInsertMode) return
    this.cancel()
  }

  public get current(): ReadonlyArray<InlayHintWithProvider> {
    return this.currentHints
  }

  public get enabled(): boolean {
    if (!this._enabled) return false
    if (!this.configEnabled) return false
    return languages.hasProvider('inlayHint', this.doc.textDocument)
  }

  public get configEnabled(): boolean {
    let { filetypes, enable } = this.config
    if (Array.isArray(filetypes)) return filetypes.includes('*') || filetypes.includes(this.doc.filetype)
    return enable === true
  }

  public toggle(): void {
    if (!languages.hasProvider('inlayHint', this.doc.textDocument)) throw new Error('Inlay hint provider not found for current document')
    if (!this.configEnabled) throw new Error(`Filetype "${this.doc.filetype}" not enabled by inlayHint configuration`)
    if (this._enabled) {
      this._enabled = false
      this.clearCache()
      this.clearVirtualText()
    } else {
      this._enabled = true
      void this.renderRange()
    }
  }

  public clearCache(): void {
    this.currentHints = []
    this.regions.clear()
    this.render.clear()
  }

  public onTextChange(): void {
    this.regions.clear()
    this.cancel()
  }

  public onChange(): void {
    this.clearCache()
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

  public async renderRange(): Promise<void> {
    this.cancel()
    if (events.insertMode && !this.config.refreshOnInsertMode) return
    if (!this.enabled) return
    this.tokenSource = new CancellationTokenSource()
    let token = this.tokenSource.token
    let res = await this.nvim.call('coc#window#visible_range', [this.doc.bufnr]) as [number, number]
    if (!Array.isArray(res) || res[1] <= 0 || token.isCancellationRequested) return
    if (!srcId) srcId = await this.nvim.createNamespace('coc-inlayHint')
    if (this.regions.has(res[0], res[1])) return
    let range = Range.create(res[0] - 1, 0, res[1], 0)
    let inlayHints = await languages.provideInlayHints(this.doc.textDocument, range, token)
    if (inlayHints == null || token.isCancellationRequested) return
    if (!this.config.enableParameter) {
      inlayHints = inlayHints.filter(o => o.kind !== InlayHintKind.Parameter)
    }
    // Since no click available, no need to resolve.
    this.regions.add(res[0], res[1])
    this.currentHints = this.currentHints.filter(o => positionInRange(o.position, range) !== 0)
    this.currentHints.push(...inlayHints)
    this.setVirtualText(range, inlayHints, workspace.env.isVim)
  }

  public setVirtualText(range: Range, inlayHints: InlayHintWithProvider[], isVim: boolean): void {
    let { nvim, doc } = this
    let buffer = doc.buffer
    let { subSeparator, parameterSeparator, typeSeparator } = this.config
    const chunksMap: Map<number, [string, string][]> = new Map()
    if (!isVim) {
      for (const item of inlayHints) {
        let { line } = item.position
        const chunks: [string, string][] = chunksMap.get(line) ?? []
        if (chunks.length > 0) {
          chunks.push([subSeparator, subSeparator === ' ' ? 'Normal' : highlightGroup])
        }
        let sep = item.kind === InlayHintKind.Parameter ? parameterSeparator : typeSeparator
        chunks.push([sep + getLabel(item), highlightGroup])
        chunksMap.set(line, chunks)
      }
    }
    nvim.pauseNotification()
    buffer.clearNamespace(srcId, range.start.line, range.end.line + 1)
    if (isVim) {
      for (const item of inlayHints) {
        const chunks: [string, string][] = []
        let { position } = item
        let line = this.doc.getline(position.line)
        let col = byteIndex(line, position.character) + 1
        if (item.paddingLeft) {
          chunks.push([' ', 'Normal'])
        }
        chunks.push([getLabel(item), highlightGroup])
        if (item.paddingRight) {
          chunks.push([' ', 'Normal'])
        }
        buffer.setVirtualText(srcId, position.line, chunks, { col })
      }
    } else {
      for (let [line, chunks] of chunksMap.entries()) {
        buffer.setExtMark(srcId, line, 0, {
          virt_text: chunks,
          virt_text_pos: 'eol',
          hl_mode: 'combine'
        })
      }
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
