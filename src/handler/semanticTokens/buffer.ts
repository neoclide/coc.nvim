import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationToken, CancellationTokenSource, Emitter, Event, Range, SemanticTokens, SemanticTokensDelta, SemanticTokensLegend, uinteger } from 'vscode-languageserver-protocol'
import events from '../../events'
import languages from '../../languages'
import { SyncItem } from '../../model/bufferSync'
import Document from '../../model/document'
import Regions from '../../model/regions'
import { HighlightItem } from '../../types'
import { wait, waitImmediate } from '../../util/index'
import { byteIndex, upperFirst } from '../../util/string'
import window from '../../window'
import workspace from '../../workspace'
const logger = require('../../util/logger')('semanticTokens-buffer')
const yieldEveryMilliseconds = 15

export const HLGROUP_PREFIX = 'CocSem'
export const NAMESPACE = 'semanticTokens'

export type TokenRange = [number, number, number] // line, startCol, endCol

export interface SemanticTokensConfig {
  filetypes: string[]
  highlightPriority: number
  incrementTypes: string[]
  combinedModifiers: string[]
  highlightGroups?: string[]
}

export interface SemanticTokenRange {
  range: TokenRange
  tokenType: string
  tokenModifiers: string[]
  hlGroup?: string
  combine: boolean
}

interface SemanticTokensPreviousResult {
  readonly version: number
  readonly resultId: string | undefined,
  readonly tokens?: uinteger[],
}

interface RangeHighlights {
  highlights: SemanticTokenRange[]
  /**
   * 0 based
   */
  start: number
  /**
   * 0 based exclusive
   */
  end: number
}

// should be higher than document debounce
const debounceInterval = global.hasOwnProperty('__TEST__') ? 30 : 300

export default class SemanticTokensBuffer implements SyncItem {
  private _highlights: [number, SemanticTokenRange[]]
  private _dirty = false
  private _version: number | undefined
  private regions: Regions | undefined
  private tokenSource: CancellationTokenSource
  private rangeTokenSource: CancellationTokenSource
  private previousResults: SemanticTokensPreviousResult | undefined
  private readonly _onDidRefresh = new Emitter<void>()
  public readonly onDidRefresh: Event<void> = this._onDidRefresh.event
  public highlight: Function & { clear(): void }
  constructor(
    private nvim: Neovim,
    public readonly bufnr: number,
    private readonly config: SemanticTokensConfig) {
    this.highlight = debounce(() => {
      this.doHighlight().catch(e => {
        logger.error(`Error on doHighlight: ${e.message}`, e)
      })
    }, debounceInterval)
    void this.doHighlight()
  }

  public onChange(): void {
    void this.doHighlight()
  }

  public onTextChange(): void {
    this.cancel()
    this.highlight()
  }

  public async forceHighlight(): Promise<void> {
    this.previousResults = undefined
    this.clearHighlight()
    this.cancel()
    await this.doHighlight(true)
  }

  public async onShown(): Promise<void> {
    // Should be refreshed by onCursorMoved
    if (this.rangeProviderOnly || this.regions) return
    const doc = workspace.getDocument(this.bufnr)
    if (!doc || doc.dirty || doc.version === this._version) return
    await this.doHighlight(false)
  }

  public get hasProvider(): boolean {
    let doc = workspace.getDocument(this.bufnr)
    if (!doc) return false
    return languages.hasProvider('semanticTokens', doc.textDocument) || languages.hasProvider('semanticTokensRange', doc.textDocument)
  }

  public get rangeProviderOnly(): boolean {
    let doc = workspace.getDocument(this.bufnr)
    if (!doc) return false
    return !languages.hasProvider('semanticTokens', doc.textDocument) && languages.hasProvider('semanticTokensRange', doc.textDocument)
  }

  public get shouldRangeHighlight(): boolean {
    let doc = workspace.getDocument(this.bufnr)
    if (!doc) return false
    return languages.hasProvider('semanticTokensRange', doc.textDocument) && this.previousResults == null
  }

  private get invalid(): boolean {
    let doc = workspace.getDocument(this.bufnr)
    return !doc || doc.dirty
  }

  private get lineCount(): number {
    let doc = workspace.getDocument(this.bufnr)
    return doc ? doc.lineCount : 0
  }

  /**
   * Get current highlight items
   */
  public get highlights(): ReadonlyArray<SemanticTokenRange> {
    return this._highlights ? this._highlights[1] : []
  }

  private get buffer(): Buffer {
    return this.nvim.createBuffer(this.bufnr)
  }

  private get hasLegend(): boolean {
    let doc = workspace.getDocument(this.bufnr)
    return languages.getLegend(doc.textDocument) != null || languages.getLegend(doc.textDocument, true) != null
  }

  public get enabled(): boolean {
    if (!this.config.filetypes.length) return false
    if (!workspace.env.updateHighlight) return false
    let doc = workspace.getDocument(this.bufnr)
    if (!doc || !doc.attached) return false
    if (!this.hasLegend) return false
    if (!this.config.filetypes.includes('*') && !this.config.filetypes.includes(doc.filetype)) return false
    return this.hasProvider
  }

  public checkState(): void {
    if (!workspace.env.updateHighlight) {
      throw new Error(`Can't perform highlight update, highlight update requires vim >= 8.1.1719 or neovim >= 0.5.0`)
    }
    let doc = workspace.getDocument(this.bufnr)
    if (!doc || !doc.attached) throw new Error('Document not attached')
    let { filetypes } = this.config
    if (!filetypes?.includes('*') && !filetypes.includes(doc.filetype)) {
      throw new Error(`Semantic tokens highlight not enabled for current filetype: ${doc.filetype}`)
    }
    if (!this.hasProvider) throw new Error('SemanticTokens provider not found, your languageserver may not support it')
    if (!this.hasLegend) throw new Error('Legend not exists.')
  }

  private async getTokenRanges(
    doc: Document,
    tokens: number[],
    legend: SemanticTokensLegend,
    token: CancellationToken): Promise<SemanticTokenRange[] | null> {
    let currentLine = 0
    let currentCharacter = 0
    let tickStart = Date.now()
    let highlights: SemanticTokenRange[] = []
    for (let i = 0; i < tokens.length; i += 5) {
      if (Date.now() - tickStart > yieldEveryMilliseconds) {
        await waitImmediate()
        if (token.isCancellationRequested) break
        tickStart = Date.now()
      }
      const deltaLine = tokens[i]
      const deltaStartCharacter = tokens[i + 1]
      const length = tokens[i + 2]
      const tokenType = legend.tokenTypes[tokens[i + 3]]
      const tokenModifiers = legend.tokenModifiers.filter((_, m) => tokens[i + 4] & (1 << m))
      const lnum = currentLine + deltaLine
      const startCharacter = deltaLine === 0 ? currentCharacter + deltaStartCharacter : deltaStartCharacter
      const endCharacter = startCharacter + length
      currentLine = lnum
      currentCharacter = startCharacter
      this.addHighlightItems(highlights, doc, lnum, startCharacter, endCharacter, tokenType, tokenModifiers)
    }
    if (token.isCancellationRequested) return null
    return highlights
  }

  /**
   * Single line only.
   */
  private addHighlightItems(highlights: SemanticTokenRange[], doc: Document, lnum: number, startCharacter: number, endCharacter: number, tokenType: string, tokenModifiers?: string[]): void {
    let { highlightGroups, combinedModifiers } = this.config
    tokenModifiers = tokenModifiers || []
    let highlightGroup: string
    let combine = false
    // Compose highlight group CocSem + modifier + type
    for (let item of tokenModifiers) {
      let hlGroup = HLGROUP_PREFIX + upperFirst(item) + upperFirst(tokenType)
      if (highlightGroups.includes(hlGroup)) {
        combine = combinedModifiers.includes(item)
        highlightGroup = hlGroup
        break
      }
    }
    if (!highlightGroup) {
      for (let item of tokenModifiers) {
        let hlGroup = HLGROUP_PREFIX + upperFirst(item)
        if (highlightGroups.includes(hlGroup)) {
          highlightGroup = hlGroup
          combine = combinedModifiers.includes(item)
          break
        }
      }
    }
    if (!highlightGroup) {
      let hlGroup = HLGROUP_PREFIX + upperFirst(tokenType)
      if (highlightGroups.includes(hlGroup)) {
        highlightGroup = hlGroup
      }
    }
    let line = doc.getline(lnum)
    let colStart = byteIndex(line, startCharacter)
    let colEnd = byteIndex(line, endCharacter)
    highlights.push({
      range: [lnum, colStart, colEnd],
      tokenType,
      combine,
      hlGroup: highlightGroup,
      tokenModifiers,
    })
  }

  private toHighlightItems(highlights: ReadonlyArray<SemanticTokenRange>, startLine?: number, endLine?: number): HighlightItem[] {
    let { incrementTypes } = this.config
    let filter = typeof startLine === 'number' && typeof endLine === 'number'
    let res: HighlightItem[] = []
    for (let hi of highlights) {
      if (!hi.hlGroup) continue
      let lnum = hi.range[0]
      if (filter && (lnum < startLine || lnum >= endLine)) continue
      let item: HighlightItem = {
        lnum,
        hlGroup: hi.hlGroup,
        colStart: hi.range[1],
        colEnd: hi.range[2],
        combine: hi.combine
      }
      if (incrementTypes.includes(hi.tokenType)) {
        item.end_incl = true
        item.start_incl = true
      }
      res.push(item)
    }
    return res
  }

  public async doHighlight(forceFull = false): Promise<void> {
    this.cancel()
    if (!this.enabled || events.pumvisible) return
    let hidden = await this.nvim.eval(`get(get(getbufinfo(${this.bufnr}),0,{}),'hidden',0)`)
    if (hidden == 1) return
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    if (this.shouldRangeHighlight) {
      let rangeTokenSource = this.rangeTokenSource = new CancellationTokenSource()
      await this.doRangeHighlight(rangeTokenSource.token)
      if (this.rangeProviderOnly) return
    }
    const doc = workspace.getDocument(this.bufnr)
    if (token.isCancellationRequested || !doc) return
    const priority = this.config.highlightPriority
    const version = doc.version
    let tokenRanges: SemanticTokenRange[] | undefined
    // TextDocument not changed, need perform highlight since lines possible replaced.
    if (version === this.previousResults?.version) {
      if (this._highlights && this._highlights[0] == version) {
        tokenRanges = this._highlights[1]
      } else {
        // possible cancelled.
        const tokens = this.previousResults.tokens
        const legend = languages.getLegend(doc.textDocument)
        tokenRanges = await this.getTokenRanges(doc, tokens, legend, token)
        if (tokenRanges) this._highlights = [version, tokenRanges]
      }
    } else {
      tokenRanges = await this.requestAllHighlights(token, forceFull)
      if (tokenRanges) this._highlights = [version, tokenRanges]
    }
    // request cancelled or can't work
    if (!tokenRanges || token.isCancellationRequested) return
    if (!this._dirty || tokenRanges.length < 1000) {
      let items = this.toHighlightItems(tokenRanges)
      let diff = await window.diffHighlights(this.bufnr, NAMESPACE, items, token)
      if (token.isCancellationRequested || !diff) return
      this._dirty = true
      this._version = version
      await window.applyDiffHighlights(this.bufnr, NAMESPACE, priority, diff)
    } else {
      this.regions = new Regions()
      await this.highlightRegions(token)
    }
    this._onDidRefresh.fire()
  }

  public async waitRefresh(): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer = setTimeout(() => {
        disposable.dispose()
        reject(new Error(`Timeout after 500ms`))
      }, 500)
      let disposable = this.onDidRefresh(() => {
        disposable.dispose()
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /**
   * Perform range highlight request and update.
   */
  public async doRangeHighlight(token: CancellationToken): Promise<void> {
    if (!this.enabled) return
    let doc = workspace.getDocument(this.bufnr)
    let { version } = doc
    let res = await this.requestRangeHighlights(doc, token)
    if (!res || token.isCancellationRequested || !doc) return
    const { highlights, start, end } = res
    if (this.rangeProviderOnly || !this.previousResults) {
      if (!this._highlights || version !== this._highlights[0]) {
        this._highlights = [version, []]
      }
      let tokenRanges = this._highlights[1]
      let used: Set<number> = tokenRanges.reduce((p, c) => p.add(c.range[0]), new Set<number>())
      highlights.forEach(hi => {
        if (!used.has(hi.range[0])) {
          tokenRanges.push(hi)
        }
      })
    }
    const items = this.toHighlightItems(highlights)
    const priority = this.config.highlightPriority
    await this.nvim.call('coc#highlight#update_highlights', [this.bufnr, NAMESPACE, items, start, end, priority])
  }

  /**
   * highlight current visible regions
   */
  public async highlightRegions(token: CancellationToken): Promise<void> {
    let { regions, highlights, config, lineCount } = this
    if (this.invalid || !regions) return
    let priority = config.highlightPriority
    let spans: [number, number][] = await this.nvim.call('coc#window#visible_ranges', [this.bufnr])
    if (this.invalid || !regions || token.isCancellationRequested || spans.length === 0) return
    let height = workspace.env.lines
    spans.forEach(o => {
      o[0] = Math.max(0, Math.floor(o[0] - height * 1.5))
      o[1] = Math.min(lineCount, Math.ceil(o[1] + height * 1.5))
    })
    for (let [start, end] of Regions.mergeSpans(spans)) {
      if (regions.has(start, end)) continue
      let items = this.toHighlightItems(highlights, start, end)
      regions.add(start, end)
      this.nvim.call('coc#highlight#update_highlights', [this.bufnr, NAMESPACE, items, start, end, priority], true)
    }
  }

  public async onCursorMoved(): Promise<void> {
    this.cancel(true)
    if (!this.enabled) return
    let rangeTokenSource = this.rangeTokenSource = new CancellationTokenSource()
    let token = rangeTokenSource.token
    await wait(global.__TEST__ ? 10 : 100)
    if (token.isCancellationRequested) return
    if (this.shouldRangeHighlight) {
      await this.doRangeHighlight(token)
    } else {
      await this.highlightRegions(token)
    }
  }

  /**
   * Request highlights for visible range.
   */
  private async requestRangeHighlights(doc: Document, token: CancellationToken): Promise<RangeHighlights | null> {
    let { nvim } = this
    let legend = languages.getLegend(doc.textDocument, true)
    let region = await nvim.call('coc#window#visible_range', [this.bufnr]) as [number, number]
    if (!region || token.isCancellationRequested) return null
    let range = Range.create(region[0] - 1, 0, region[1], 0)
    let res = await languages.provideDocumentRangeSemanticTokens(doc.textDocument, range, token)
    if (!res || token.isCancellationRequested) return null
    let highlights = await this.getTokenRanges(doc, res.data, legend, token)
    if (token.isCancellationRequested) return null
    return { highlights, start: region[0] - 1, end: region[1] }
  }

  /**
   * Request highlights from provider, return undefined when can't request or request cancelled
   * Use range provider only when not semanticTokens provider exists.
   */
  private async requestAllHighlights(token: CancellationToken, forceFull: boolean): Promise<SemanticTokenRange[] | null> {
    let doc = workspace.getDocument(this.bufnr)
    if (!doc) return null
    const legend = languages.getLegend(doc.textDocument)
    const hasEditProvider = languages.hasSemanticTokensEdits(doc.textDocument)
    const previousResult = forceFull ? null : this.previousResults
    const version = doc.version
    let result: SemanticTokens | SemanticTokensDelta
    if (hasEditProvider && previousResult?.resultId) {
      result = await languages.provideDocumentSemanticTokensEdits(doc.textDocument, previousResult.resultId, token)
    } else {
      result = await languages.provideDocumentSemanticTokens(doc.textDocument, token)
    }
    if (token.isCancellationRequested || !result) return
    let tokens: uinteger[] = []
    if (SemanticTokens.is(result)) {
      tokens = result.data
    } else if (previousResult && Array.isArray(result.edits)) {
      tokens = previousResult.tokens
      result.edits.forEach(e => {
        tokens.splice(e.start, e.deleteCount ? e.deleteCount : 0, ...e.data)
      })
    } else {
      return null
    }
    this.previousResults = { resultId: result.resultId, tokens, version }
    return await this.getTokenRanges(doc, tokens, legend, token)
  }

  public clearHighlight(): void {
    this.buffer.clearNamespace(NAMESPACE)
  }

  public abandonResult(): void {
    this.previousResults = undefined
    this._highlights = undefined
  }

  public cancel(rangeOnly = false): void {
    if (this.rangeTokenSource) {
      this.rangeTokenSource.cancel()
      this.rangeTokenSource.dispose()
      this.rangeTokenSource = null
    }
    if (rangeOnly) return
    this.regions = undefined
    this.highlight.clear()
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource.dispose()
      this.tokenSource = null
    }
  }

  public dispose(): void {
    this.cancel()
    this.abandonResult()
    this._onDidRefresh.dispose()
    this.regions = undefined
  }
}
