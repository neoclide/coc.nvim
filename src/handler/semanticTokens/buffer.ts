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
}

export default class SemanticTokensBuffer implements SyncItem {
  private _config: SemanticTokensConfig
  private _dirty = false
  private _version: number | undefined
  public readonly regions = new Regions()
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

  public async onShown(winid: number): Promise<void> {
    // Should be refreshed by onCursorMoved
    if (this.shouldRangeHighlight) return
    const { doc } = this
    if (doc.dirty || doc.version === this._version) return
    await this.doHighlight(false, winid)
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
    if (!this.configEnabled || !this.hasLegend) return false
    return this.hasProvider
  }

  public checkState(): void {
    if (!this.configEnabled) throw new Error(`Semantic tokens highlight not enabled for current filetype: ${this.doc.filetype}`)
    if (!this.hasProvider || !this.hasLegend) throw new Error(`SemanticTokens provider not found for ${this.doc.uri}`)
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
    // highlight groups:
    // CocSem + Type + type
    // CocSem + TypeMod + type + modifier

    let { combinedModifiers } = this.config
    let combine = false

    highlights.push({
      range,
      tokenType,
      combine,
      hlGroup: HLGROUP_PREFIX + 'Type' + toHighlightPart(tokenType),
      tokenModifiers,
    })

    if (tokenModifiers.length) {
      // only use first modifier to avoid highlight flicking
      const modifier = tokenModifiers[0]
      combine = combinedModifiers.includes(modifier)
      highlights.push({
        range,
        tokenType,
        combine,
        hlGroup: HLGROUP_PREFIX + 'TypeMod' + toHighlightPart(tokenType) + toHighlightPart(modifier),
        tokenModifiers,
      })
    }
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

  public async doHighlight(forceFull = false, winid?: number): Promise<void> {
    this.cancel()
    const winids = winid == null ? workspace.editors.getBufWinids(this.bufnr) : [winid]
    if (!this.enabled || winids.length === 0) return
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    if (this.shouldRangeHighlight) {
      let rangeTokenSource = this.rangeTokenSource = new CancellationTokenSource()
      let rangeToken = rangeTokenSource.token
      for (const win of winids) {
        await this.doRangeHighlight(win, rangeToken)
        if (rangeToken.isCancellationRequested) break
      }
      this.rangeTokenSource = undefined
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
    if (!this._dirty || tokenRanges.length < 500) {
      let items = this.toHighlightItems(tokenRanges)
      let diff = await window.diffHighlights(this.bufnr, NAMESPACE, items, undefined, token)
      if (token.isCancellationRequested || !diff) return
      this._dirty = true
      this._version = version
      const priority = this.config.highlightPriority
      await window.applyDiffHighlights(this.bufnr, NAMESPACE, priority, diff)
    } else {
      this.regions.clear()
      await this.highlightRegions(winid, token)
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
  public async doRangeHighlight(winid: number, token: CancellationToken): Promise<void> {
    const { version } = this.doc
    let res = await this.sendRequest(() => {
      return this.requestRangeHighlights(winid, token)
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
    const items = this.toHighlightItems(highlights, start, end + 1)
    let diff = await window.diffHighlights(this.bufnr, NAMESPACE, items, [start, end], token)
    if (diff && !token.isCancellationRequested) {
      const priority = this.config.highlightPriority
      await window.applyDiffHighlights(this.bufnr, NAMESPACE, priority, diff, true)
      this.regions.add(start, end)
      this._dirty = true
    }
  }

  /**
   * highlight current visible regions, highlight all associated winids when winid is undefined
   */
  public async highlightRegions(winid: number | undefined, token: CancellationToken, skipCheck = false): Promise<void> {
    let { regions, highlights, config, lineCount, bufnr } = this
    if (!highlights) return
    let spans: [number, number][]
    if (winid == null) {
      spans = await this.nvim.call('coc#window#visible_ranges', [bufnr]) as [number, number][]
      if (spans.length === 0) return
      let height = workspace.env.lines
      spans.forEach(o => {
        o[0] = Math.max(0, Math.floor(o[0] - height))
        o[1] = Math.min(lineCount, Math.ceil(o[1] + height))
      })
      spans = Regions.mergeSpans(spans)
    } else {
      let span = await this.nvim.call('coc#window#visible_range', [winid]) as [number, number] | null
      if (!span) return
      spans = [span]
    }
    if (token.isCancellationRequested) return
    for (let [start, end] of spans) {
      if (!skipCheck && regions.has(start, end)) continue
      let items = this.toHighlightItems(highlights, start, end + 1)
      let diff = await window.diffHighlights(bufnr, NAMESPACE, items, [start, end], token)
      if (token.isCancellationRequested) break
      regions.add(start, end)
      let priority = config.highlightPriority
      if (diff) await window.applyDiffHighlights(bufnr, NAMESPACE, priority, diff, true)
    }
  }

  public async onWinScroll(winid: number): Promise<void> {
    this.cancel(true)
    if (!this.enabled || this.doc.dirty) return
    let rangeTokenSource = this.rangeTokenSource = new CancellationTokenSource()
    let token = rangeTokenSource.token
    await wait(debounceInterval)
    if (token.isCancellationRequested) return
    if (this.shouldRangeHighlight) {
      await this.doRangeHighlight(winid, token)
    } else {
      await this.highlightRegions(winid, token)
    }
    if (!token.isCancellationRequested) this.rangeTokenSource = undefined
  }

  public getHighlightSpan(start: number, end: number): [number, number] | undefined {
    let delta = workspace.env.lines
    let startLine = start
    if (start != 0) {
      let s = Math.max(0, startLine - delta)
      if (!this.regions.has(s, startLine)) {
        startLine = s
      }
    }
    let endLine = end
    let linecount = this.doc.lineCount
    if (end < linecount) {
      let e = Math.min(end + delta, linecount)
      if (!this.regions.has(endLine, e)) {
        endLine = e
      }
    }
    if (this.regions.has(start, end) && startLine === start && endLine === end) {
      return undefined
    }
    return [startLine, endLine]
  }

  /**
   * Request highlights for visible range of winid.
   */
  public async requestRangeHighlights(winid: number, token: CancellationToken): Promise<RangeHighlights | null> {
    let { nvim, doc } = this
    let region = await nvim.call('coc#window#visible_range', [winid]) as [number, number]
    if (!region || token.isCancellationRequested) return null
    // convert to 0 based
    let span = this.getHighlightSpan(region[0] - 1, region[1] - 1)
    if (!span) return null
    const startLine = span[0]
    const endLine = span[1]
    let range = doc.textDocument.intersectWith(Range.create(startLine, 0, endLine + 1, 0))
    let res = await languages.provideDocumentRangeSemanticTokens(doc.textDocument, range, token)
    if (!res || !SemanticTokens.is(res) || token.isCancellationRequested) return null
    let legend = languages.getLegend(doc.textDocument, true)
    let highlights = await this.getTokenRanges(res.data, legend, token)
    if (!highlights) return null
    return { highlights, start: startLine, end: endLine }
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
