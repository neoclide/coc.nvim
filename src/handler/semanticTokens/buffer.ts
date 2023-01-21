'use strict'
import { Buffer, Neovim } from '@chemzqm/neovim'
import { Range, SemanticTokens, SemanticTokensDelta, SemanticTokensLegend, uinteger } from 'vscode-languageserver-types'
import languages, { ProviderName } from '../../languages'
import { createLogger } from '../../logger'
import { SyncItem } from '../../model/bufferSync'
import Document from '../../model/document'
import Regions from '../../model/regions'
import { HighlightItem } from '../../types'
import { delay, getConditionValue } from '../../util'
import { toArray } from '../../util/array'
import { CancellationError } from '../../util/errors'
import { wait, waitImmediate } from '../../util/index'
import { toNumber } from '../../util/numbers'
import { CancellationToken, CancellationTokenSource, Emitter, Event } from '../../util/protocol'
import { bytes, isHighlightGroupCharCode, toText } from '../../util/string'
import window from '../../window'
import workspace from '../../workspace'
const logger = createLogger('semanticTokens-buffer')
const yieldEveryMilliseconds = getConditionValue(15, 5)

export const HLGROUP_PREFIX = 'CocSem'
export const NAMESPACE = 'semanticTokens'

export type TokenRange = [number, number, number] // line, startCol, endCol

export interface SemanticTokensConfig {
  enable: boolean
  highlightPriority: number
  incrementTypes: string[]
  combinedModifiers: string[]
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
const debounceInterval = getConditionValue(100, 20)
const requestDelay = getConditionValue(500, 20)
const highlightGroupMap: Map<string, string> = new Map()

export interface StaticConfig {
  filetypes: string[] | null
  highlightGroups: ReadonlyArray<string>
}

export default class SemanticTokensBuffer implements SyncItem {
  private _config: SemanticTokensConfig
  private _dirty = false
  private _version: number | undefined
  private regions = new Regions()
  private tokenSource: CancellationTokenSource
  private rangeTokenSource: CancellationTokenSource
  private previousResults: SemanticTokensPreviousResult | undefined
  private _highlights: [number, SemanticTokenRange[]]
  private readonly _onDidRefresh = new Emitter<void>()
  public readonly onDidRefresh: Event<void> = this._onDidRefresh.event
  public highlight: ((ms?: number) => void) & { clear: () => void }
  constructor(private nvim: Neovim, public readonly doc: Document, private staticConfig: StaticConfig) {
    this.highlight = delay(() => {
      void this.doHighlight()
    }, debounceInterval)
    if (this.hasProvider) this.highlight()
  }

  public get config(): SemanticTokensConfig {
    if (this._config) return this._config
    this.loadConfiguration()
    return this._config
  }

  public loadConfiguration(): void {
    let config = workspace.getConfiguration('semanticTokens', this.doc)
    let changed = this._config != null && this._config.enable != config.enable
    this._config = {
      enable: config.get<boolean>('enable'),
      highlightPriority: config.get<number>('highlightPriority'),
      incrementTypes: config.get<string[]>('incrementTypes'),
      combinedModifiers: config.get<string[]>('combinedModifiers')
    }
    if (changed) {
      if (this._config.enable) {
        this.highlight()
      } else {
        this.clearHighlight()
      }
    }
  }

  public get configEnabled(): boolean {
    let { enable } = this.config
    let { filetypes } = this.staticConfig
    // should be null when not specified
    if (Array.isArray(filetypes)) return filetypes.includes('*') || filetypes.includes(this.doc.filetype)
    return enable
  }

  public get bufnr(): number {
    return this.doc.bufnr
  }

  public onChange(): void {
    // need debounce for document synchronize
    this.highlight()
  }

  public onTextChange(): void {
    this.cancel()
  }

  public async forceHighlight(): Promise<void> {
    this.clearHighlight()
    this.cancel()
    await this.doHighlight(true)
  }

  public async onShown(): Promise<void> {
    // Should be refreshed by onCursorMoved
    if (this.shouldRangeHighlight) return
    const { doc } = this
    if (doc.dirty || doc.version === this._version) return
    await this.doHighlight(false, true)
  }

  public get hasProvider(): boolean {
    return languages.hasProvider(ProviderName.SemanticTokens, this.doc)
      || languages.hasProvider(ProviderName.SemanticTokensRange, this.doc)
  }

  private get hasLegend(): boolean {
    let { textDocument } = this.doc
    return languages.getLegend(textDocument) != null || languages.getLegend(textDocument, true) != null
  }

  public get rangeProviderOnly(): boolean {
    return !languages.hasProvider(ProviderName.SemanticTokens, this.doc)
      && languages.hasProvider(ProviderName.SemanticTokensRange, this.doc)
  }

  public get shouldRangeHighlight(): boolean {
    let { textDocument } = this.doc
    return languages.hasProvider(ProviderName.SemanticTokensRange, textDocument) && this.previousResults == null
  }

  private get lineCount(): number {
    return this.doc.lineCount
  }

  /**
   * Get current highlight items
   */
  public get highlights(): SemanticTokenRange[] | undefined {
    if (!this._highlights) return undefined
    return this._highlights[1]
  }

  private get buffer(): Buffer {
    return this.nvim.createBuffer(this.bufnr)
  }

  public get enabled(): boolean {
    if (!this.configEnabled || !workspace.env.updateHighlight || !this.hasLegend) return false
    return this.hasProvider
  }

  public checkState(): void {
    if (!workspace.env.updateHighlight) throw new Error(`Can't perform highlight update, highlight update requires vim >= 8.1.1719 or neovim >= 0.5.0`)
    if (!this.configEnabled) throw new Error(`Semantic tokens highlight not enabled for current filetype: ${this.doc.filetype}`)
    if (!this.hasProvider || !this.hasLegend) throw new Error(`SemanticTokens provider not found for ${this.doc.uri}`)
    if (this.staticConfig.highlightGroups.length === 0) throw new Error(`Unable to find highlight groups starts with CocSem`)
  }

  public async getTokenRanges(
    tokens: number[],
    legend: SemanticTokensLegend,
    token: CancellationToken): Promise<SemanticTokenRange[] | null> {
    let currentLine = 0
    let currentCharacter = 0
    let highlights: SemanticTokenRange[] = []
    let toBytes: (characterIndex: number) => number | undefined
    let textDocument = this.doc.textDocument
    let tickStart = Date.now()
    for (let i = 0; i < tokens.length; i += 5) {
      if (i == 0 || Date.now() - tickStart > yieldEveryMilliseconds) {
        await waitImmediate()
        if (token.isCancellationRequested) break
        tickStart = Date.now()
      }
      const deltaLine = tokens[i]
      const deltaCharacter = tokens[i + 1]
      const length = tokens[i + 2]
      const tokenType = legend.tokenTypes[tokens[i + 3]]
      const tokenModifiers = legend.tokenModifiers.filter((_, m) => tokens[i + 4] & (1 << m))
      const lnum = currentLine + deltaLine
      if (deltaLine != 0 || !toBytes) {
        toBytes = bytes(toText(textDocument.lines[lnum]))
      }
      const sc = deltaLine === 0 ? currentCharacter + deltaCharacter : deltaCharacter
      const ec = sc + length
      currentLine = lnum
      currentCharacter = sc
      this.addHighlightItems(highlights, [lnum, toBytes(sc), toBytes(ec)], tokenType, tokenModifiers)
    }
    if (token.isCancellationRequested) return null
    return highlights
  }

  /**
   * Single line only.
   */
  private addHighlightItems(highlights: SemanticTokenRange[], range: [number, number, number], tokenType: string, tokenModifiers: string[]): void {
    let { combinedModifiers } = this.config
    let { highlightGroups } = this.staticConfig
    let highlightGroup: string
    let combine = false
    // Compose highlight group CocSem + modifier + type
    for (let item of tokenModifiers) {
      let hlGroup = HLGROUP_PREFIX + toHighlightPart(item) + toHighlightPart(tokenType)
      if (highlightGroups.includes(hlGroup)) {
        combine = combinedModifiers.includes(item)
        highlightGroup = hlGroup
        break
      }
    }
    if (!highlightGroup) {
      for (let modifier of tokenModifiers) {
        let hlGroup = HLGROUP_PREFIX + toHighlightPart(modifier)
        if (highlightGroups.includes(hlGroup)) {
          highlightGroup = hlGroup
          combine = combinedModifiers.includes(modifier)
          break
        }
      }
    }
    if (!highlightGroup) {
      let hlGroup = HLGROUP_PREFIX + toHighlightPart(tokenType)
      if (highlightGroups.includes(hlGroup)) {
        highlightGroup = hlGroup
      }
    }
    highlights.push({
      range,
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

  public async doHighlight(forceFull = false, onShown = false): Promise<void> {
    this.cancel()
    if (!this.enabled || (!onShown && !workspace.editors.isVisible(this.bufnr))) return
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    if (this.shouldRangeHighlight) {
      let rangeTokenSource = this.rangeTokenSource = new CancellationTokenSource()
      let rangeToken = rangeTokenSource.token
      await this.doRangeHighlight(rangeToken)
      if (!rangeToken.isCancellationRequested) this.rangeTokenSource = undefined
      if (rangeToken.isCancellationRequested && this.rangeProviderOnly) return
    }
    if (token.isCancellationRequested) return
    const { doc } = this
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
        tokenRanges = await this.getTokenRanges(tokens, legend, token)
      }
    } else {
      tokenRanges = await this.sendRequest(() => {
        return this.requestAllHighlights(token, forceFull)
      }, token)
    }
    // request cancelled or can't work
    if (token.isCancellationRequested || !tokenRanges) return
    this._highlights = [version, tokenRanges]
    if (!this._dirty || tokenRanges.length < 200) {
      let items = this.toHighlightItems(tokenRanges)
      let diff = await window.diffHighlights(this.bufnr, NAMESPACE, items, undefined, token)
      if (token.isCancellationRequested || !diff) return
      this._dirty = true
      this._version = version
      const priority = this.config.highlightPriority
      await window.applyDiffHighlights(this.bufnr, NAMESPACE, priority, diff)
    } else {
      this.regions.clear()
      await this.highlightRegions(token)
    }
    if (!token.isCancellationRequested) this.tokenSource = undefined
    this._onDidRefresh.fire()
  }

  private async sendRequest<R>(fn: () => Promise<R>, token: CancellationToken): Promise<R | undefined> {
    try {
      return await fn()
    } catch (e) {
      if (!token.isCancellationRequested) {
        if (e instanceof CancellationError) {
          this.highlight(requestDelay)
        } else {
          logger.error('Error on request semanticTokens: ', e)
        }
      }
      return undefined
    }
  }

  /**
   * Perform range highlight request and update.
   */
  public async doRangeHighlight(token: CancellationToken): Promise<void> {
    let { version } = this.doc
    let res = await this.sendRequest(() => {
      return this.requestRangeHighlights(token)
    }, token)
    if (res == null || token.isCancellationRequested) return
    const { highlights, start, end } = res
    if (this.rangeProviderOnly || !this.previousResults) {
      if (!this._highlights || version !== this._highlights[0]) {
        this._highlights = [version, []]
      }
      let tokenRanges = this._highlights[1]
      let usedLines: Set<number> = tokenRanges.reduce((p, c) => p.add(c.range[0]), new Set<number>())
      highlights.forEach(hi => {
        if (!usedLines.has(hi.range[0])) {
          tokenRanges.push(hi)
        }
      })
    }
    const items = this.toHighlightItems(highlights)
    let diff = await window.diffHighlights(this.bufnr, NAMESPACE, items, [start, end], token)
    if (diff) {
      const priority = this.config.highlightPriority
      await window.applyDiffHighlights(this.bufnr, NAMESPACE, priority, diff, true)
      this._dirty = true
    }
  }

  /**
   * highlight current visible regions
   */
  public async highlightRegions(token: CancellationToken, skipCheck = false): Promise<void> {
    let { regions, highlights, config, lineCount, bufnr } = this
    if (!highlights) return
    let spans = await this.nvim.call('coc#window#visible_ranges', [bufnr]) as [number, number][]
    if (token.isCancellationRequested || spans.length === 0) return
    let height = workspace.env.lines
    spans.forEach(o => {
      let s = o[0]
      o[0] = Math.max(0, Math.floor(s - height * 1.5))
      o[1] = Math.min(lineCount, Math.ceil(o[1] + height * 1.5), s + height * 2)
    })
    for (let [start, end] of Regions.mergeSpans(spans)) {
      if (!skipCheck && regions.has(start, end)) continue
      let items = this.toHighlightItems(highlights, start, end)
      let diff = await window.diffHighlights(bufnr, NAMESPACE, items, [start, end], token)
      if (token.isCancellationRequested) break
      regions.add(start, end)
      let priority = config.highlightPriority
      if (diff) void window.applyDiffHighlights(bufnr, NAMESPACE, priority, diff, true)
    }
  }

  public async onCursorMoved(): Promise<void> {
    this.cancel(true)
    if (!this.enabled || this.doc.dirty) return
    let rangeTokenSource = this.rangeTokenSource = new CancellationTokenSource()
    let token = rangeTokenSource.token
    await wait(debounceInterval)
    if (token.isCancellationRequested) return
    if (this.shouldRangeHighlight) {
      await this.doRangeHighlight(token)
    } else {
      await this.highlightRegions(token)
    }
    if (!token.isCancellationRequested) this.rangeTokenSource = undefined
  }

  /**
   * Request highlights for visible range.
   */
  public async requestRangeHighlights(token: CancellationToken): Promise<RangeHighlights | null> {
    let { nvim, doc } = this
    let region = await nvim.call('coc#window#visible_range', [this.bufnr]) as [number, number]
    if (!region || token.isCancellationRequested) return null
    let endLine = Math.min(region[0] + workspace.env.lines * 2, region[1] + workspace.env.lines, doc.lineCount)
    let range = Range.create(region[0] - 1, 0, endLine, 0)
    let res = await languages.provideDocumentRangeSemanticTokens(doc.textDocument, range, token)
    if (!res || !SemanticTokens.is(res) || token.isCancellationRequested) return null
    let legend = languages.getLegend(doc.textDocument, true)
    let highlights = await this.getTokenRanges(res.data, legend, token)
    if (!highlights) return null
    return { highlights, start: region[0] - 1, end: region[1] }
  }

  /**
   * Request highlights from provider, return undefined when can't request or request cancelled
   * Use range provider only when not semanticTokens provider exists.
   */
  public async requestAllHighlights(token: CancellationToken, forceFull: boolean): Promise<SemanticTokenRange[] | null> {
    const textDocument = this.doc.textDocument
    const legend = languages.getLegend(textDocument)
    const hasEditProvider = languages.hasSemanticTokensEdits(textDocument)
    const previousResult = forceFull ? null : this.previousResults
    const version = textDocument.version
    let result: SemanticTokens | SemanticTokensDelta
    if (hasEditProvider && previousResult?.resultId) {
      result = await languages.provideDocumentSemanticTokensEdits(textDocument, previousResult.resultId, token)
    } else {
      result = await languages.provideDocumentSemanticTokens(textDocument, token)
    }
    if (token.isCancellationRequested || result == null) return
    let tokens: uinteger[] = []
    if (SemanticTokens.is(result)) {
      tokens = result.data
    } else if (previousResult && Array.isArray(result.edits)) {
      tokens = previousResult.tokens
      result.edits.forEach(e => {
        tokens.splice(e.start, toNumber(e.deleteCount), ...toArray(e.data))
      })
    }
    this.previousResults = { resultId: result.resultId, tokens, version }
    return await this.getTokenRanges(tokens, legend, token)
  }

  public clearHighlight(): void {
    this.previousResults = undefined
    this._highlights = undefined
    this.regions.clear()
    this.buffer.clearNamespace(NAMESPACE)
  }

  public abandonResult(): void {
    this.previousResults = undefined
  }

  public cancel(rangeOnly = false): void {
    if (this.rangeTokenSource) {
      this.rangeTokenSource.cancel()
      this.rangeTokenSource = null
    }
    if (rangeOnly) return
    this.regions.clear()
    this.highlight.clear()
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = null
    }
  }

  public dispose(): void {
    this.cancel()
    this.clearHighlight()
    this._onDidRefresh.dispose()
  }
}

export function toHighlightPart(token: string): string {
  if (!token) return ''
  if (highlightGroupMap.has(token)) return highlightGroupMap.get(token)
  let chars: string[] = []
  for (let i = 0; i < token.length; i++) {
    let ch = token[i]
    ch = isHighlightGroupCharCode(ch.charCodeAt(0)) ? ch : '_'
    chars.push(i == 0 ? ch.toUpperCase() : ch)
  }
  let part = chars.join('')
  highlightGroupMap.set(token, part)
  return part
}
