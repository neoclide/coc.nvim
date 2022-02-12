import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationToken, CancellationTokenSource, Range, SemanticTokens, SemanticTokensDelta, SemanticTokensLegend, uinteger } from 'vscode-languageserver-protocol'
import languages from '../../languages'
import { SyncItem } from '../../model/bufferSync'
import Document from '../../model/document'
import { HighlightItem, HighlightItemOption } from '../../types'
import window from '../../window'
import workspace from '../../workspace'
const logger = require('../../util/logger')('semanticTokens-buffer')

export const HLGROUP_PREFIX = 'CocSem'
export const NAMESPACE = 'semanticTokens'

/**
 * Relative highlight
 */
interface RelativeHighlight {
  tokenType: string
  tokenModifiers: string[]
  deltaLine: number
  deltaStartCharacter: number
  length: number
}

/**
 * Absolute Token
 */
interface AbsoluteToken {
  lnum: number
  startCharacter: number
  endCharacter: number
  tokenType: string
  tokenModifiers?: string[]
}

export interface SemanticTokensConfig {
  filetypes: string[]
  highlightPriority: number
  incrementTypes: string[]
  combinedModifiers: string[]
  highlightGroups?: string[]
}

export interface SemanticTokenRange {
  range: Range
  tokenType: string
  tokenModifiers?: string[]
  hlGroup?: string
}

interface SemanticTokensPreviousResult {
  readonly version: number
  readonly resultId: string | undefined,
  readonly tokens?: uinteger[],
}

interface RangeHighlights {
  items: HighlightItem[]
  /**
   * 0 based
   */
  start: number
  /**
   * 0 based exclusive
   */
  end: number
}

export function capitalize(text: string): string {
  return text.length ? text[0].toUpperCase() + text.slice(1) : ''
}

// should be higher than document debounce
const debounceInterval = global.hasOwnProperty('__TEST__') ? 10 : 300

export default class SemanticTokensBuffer implements SyncItem {
  private tokenSource: CancellationTokenSource
  private rangeTokenSource: CancellationTokenSource
  private _highlights: SemanticTokenRange[]
  private _pendingHighlights: Map<number, AbsoluteToken[]> = new Map()
  private previousResults: SemanticTokensPreviousResult | undefined
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
    this.highlight()
  }

  public onChange(): void {
    this.cancel()
    this.highlight()
  }

  public onTextChange(): void {
    this.cancel()
    this.highlight()
  }

  public async forceHighlight(): Promise<void> {
    this.clearHighlight()
    this.cancel()
    await this.doHighlight(true)
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

  public get hasPendingHighlights(): boolean {
    return this._pendingHighlights.size > 0
  }

  private get invalid(): boolean {
    let doc = workspace.getDocument(this.bufnr)
    return !doc || doc.dirty
  }

  /**
   * Get current highlight items
   */
  public get highlights(): ReadonlyArray<SemanticTokenRange> {
    let pending: SemanticTokenRange[] = []
    this._pendingHighlights.forEach(absHighlights => {
      absHighlights.forEach(absHighlight => {
        let { lnum, startCharacter, endCharacter, tokenType, tokenModifiers } = absHighlight
        let [highlightGroup] = this.getHighlightGroup(tokenType, tokenModifiers)
        if (highlightGroup) {
          let range = Range.create(lnum, startCharacter, lnum, endCharacter)
          pending.push({
            range,
            tokenType,
            hlGroup: highlightGroup,
            tokenModifiers,
          })
        }
      })
    })
    return pending.length > 0 ? [...this._highlights, ...pending] : this._highlights
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

  private getHighlightItems(doc: Document, startLine: number, endLine: number, tokens: number[], legend: SemanticTokensLegend): HighlightItem[] {
    const relatives: RelativeHighlight[] = []
    for (let i = 0; i < tokens.length; i += 5) {
      const deltaLine = tokens[i]
      const deltaStartCharacter = tokens[i + 1]
      const length = tokens[i + 2]
      const tokenType = tokens[i + 3]
      const tokenModifiers = legend.tokenModifiers.filter((_, m) => tokens[i + 4] & (1 << m))
      relatives.push({ tokenType: legend.tokenTypes[tokenType], tokenModifiers, deltaLine, deltaStartCharacter, length })
    }

    const res: HighlightItem[] = []
    let currentLine = 0
    let currentCharacter = 0
    this._highlights = []
    this._pendingHighlights.clear()
    for (const {
      tokenType,
      tokenModifiers,
      deltaLine,
      deltaStartCharacter,
      length
    } of relatives) {
      const lnum = currentLine + deltaLine
      const startCharacter = deltaLine === 0 ? currentCharacter + deltaStartCharacter : deltaStartCharacter
      const endCharacter = startCharacter + length
      currentLine = lnum
      currentCharacter = startCharacter
      if (startLine <= lnum && lnum < endLine) {
        // range, tokenType, tokenModifiers
        let range = Range.create(lnum, startCharacter, lnum, endCharacter)
        this.addHighlightItems(res, doc, range, tokenType, tokenModifiers)
      } else {
        let arr = this._pendingHighlights.get(lnum) || []
        arr.push({ lnum, startCharacter, endCharacter, tokenType, tokenModifiers })
        this._pendingHighlights.set(lnum, arr)
      }
    }
    return res
  }

  private getHighlightGroup(tokenType: string, tokenModifiers?: string[]): [string | null, boolean] {
    let { highlightGroups, combinedModifiers } = this.config
    tokenModifiers = tokenModifiers || []
    let highlightGroup: string
    let combine = false
    // Compose highlight group CocSem + modifier + type
    for (let item of tokenModifiers) {
      let hlGroup = HLGROUP_PREFIX + capitalize(item) + capitalize(tokenType)
      if (highlightGroups.includes(hlGroup)) {
        combine = combinedModifiers.includes(item)
        highlightGroup = hlGroup
        break
      }
    }
    if (!highlightGroup) {
      for (let item of tokenModifiers) {
        let hlGroup = HLGROUP_PREFIX + capitalize(item)
        if (highlightGroups.includes(hlGroup)) {
          highlightGroup = hlGroup
          combine = combinedModifiers.includes(item)
          break
        }
      }
    }
    if (!highlightGroup) {
      let hlGroup = HLGROUP_PREFIX + capitalize(tokenType)
      if (highlightGroups.includes(hlGroup)) {
        highlightGroup = hlGroup
      }
    }
    return [highlightGroup, combine]
  }

  private addHighlightItems(items: HighlightItem[], doc: Document, range: Range, tokenType: string, tokenModifiers?: string[]): void {
    let { incrementTypes } = this.config
    let [highlightGroup, combine] = this.getHighlightGroup(tokenType, tokenModifiers)
    if (highlightGroup) {
      let opts: HighlightItemOption = { combine }
      if (incrementTypes.includes(tokenType)) {
        opts.end_incl = true
        opts.start_incl = true
      }
      doc.addHighlights(items, highlightGroup, range, opts)
    }
    this._highlights.push({
      range,
      tokenType,
      hlGroup: highlightGroup,
      tokenModifiers,
    })
  }

  public async doPendingHighlight() {
    if (this._pendingHighlights.size <= 0) return
    let r = await this.nvim.call('coc#window#render_range', [this.bufnr]) as [number, number]
    if (!r) return
    let [startLine, endLine] = r
    const items: HighlightItem[] = []
    let doc = workspace.getDocument(this.bufnr)
    let start: number | undefined
    let end: number | undefined
    for (let i = startLine - 1; i < endLine; i++) {
      let arr = this._pendingHighlights.get(i)
      if (!this._pendingHighlights.delete(i) || arr.length == 0) {
        continue
      }
      if (!start) {
        start = i
      }
      for (const o of arr) {
        let { lnum, startCharacter, endCharacter, tokenType, tokenModifiers } = o
        let range = Range.create(lnum, startCharacter, lnum, endCharacter)
        this.addHighlightItems(items, doc, range, tokenType, tokenModifiers)
        end = lnum
      }
    }
    if (items.length > 0) {
      let priority = this.config.highlightPriority
      await this.nvim.call('coc#highlight#update_highlights', [this.bufnr, NAMESPACE, items, start, end, priority])
    }
  }

  public async doRangeHighlight(startLine?: number, endLine?: number): Promise<void> {
    if (!this.enabled) return
    if (!startLine || !endLine) {
      let r = await this.nvim.call('coc#window#render_range', [this.bufnr]) as [number, number]
      if (!r) return
      [startLine, endLine] = r
    }
    this.cancel(true)
    let tokenSource = this.rangeTokenSource = new CancellationTokenSource()
    let priority = this.config.highlightPriority
    let res = await this.requestRangeHighlights(startLine, endLine, tokenSource.token)
    this.rangeTokenSource = null
    if (!res) return
    const { items, start, end } = res
    await this.nvim.call('coc#highlight#update_highlights', [this.bufnr, NAMESPACE, items, start, end, priority])
  }

  public async doHighlight(forceFull = false): Promise<void> {
    if (!this.enabled) return
    this.cancel()
    let { nvim } = this
    let visible = await nvim.call('pumvisible')
    if (visible) return
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let r = await nvim.call('coc#window#render_range', [this.bufnr]) as [number, number]
    if (!r) return
    let [startLine, endLine] = r
    if (this.shouldRangeHighlight) {
      await this.doRangeHighlight(startLine, endLine)
      if (this.rangeProviderOnly) return
    }
    let priority = this.config.highlightPriority
    let previousVersion = this.previousResults?.version
    let doc = workspace.getDocument(this.bufnr)
    let items: HighlightItem[] | undefined
    // TextDocument not changed, need perform highlight since lines possible changed.
    if (previousVersion && doc && doc.version === previousVersion) {
      let tokens = this.previousResults.tokens
      const legend = languages.getLegend(doc.textDocument)
      items = this.getHighlightItems(doc, startLine, endLine, tokens, legend)
    } else {
      items = await this.requestAllHighlights(startLine, endLine, tokenSource.token, forceFull)
    }
    // request cancelled or can't work
    if (!items || tokenSource.token.isCancellationRequested || this.invalid) return
    let diff = await window.diffHighlights(this.bufnr, NAMESPACE, items, startLine, endLine)
    this.tokenSource = null
    if (tokenSource.token.isCancellationRequested || !diff || this.invalid) return
    await window.applyDiffHighlights(this.bufnr, NAMESPACE, priority, diff)
  }

  /**
   * Request highlights for specific range.
   */
  private async requestRangeHighlights(startLine: number, endLine: number, token: CancellationToken): Promise<RangeHighlights | null> {
    let doc = workspace.getDocument(this.bufnr)
    let legend = languages.getLegend(doc.textDocument, true)
    if (token.isCancellationRequested) return null
    let range = Range.create(startLine, 0, endLine, 0)
    let res = await languages.provideDocumentRangeSemanticTokens(doc.textDocument, range, token)
    if (!res || token.isCancellationRequested) return null
    let items = this.getHighlightItems(doc, startLine, endLine, res.data, legend)
    return { items, start: startLine, end: endLine }
  }

  /**
   * Request highlights from provider, return undefined when can't request or request cancelled
   * Use range provider only when not semanticTokens provider exists.
   */
  private async requestAllHighlights(startLine: number, endLine: number, token: CancellationToken, forceFull: boolean): Promise<HighlightItem[] | undefined> {
    let doc = workspace.getDocument(this.bufnr)
    if (!doc) return
    const legend = languages.getLegend(doc.textDocument)
    const hasEditProvider = languages.hasSemanticTokensEdits(doc.textDocument)
    const previousResult = forceFull ? null : this.previousResults
    let result: SemanticTokens | SemanticTokensDelta
    let version = doc.textDocument.version
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
      return
    }
    this.previousResults = { resultId: result.resultId, tokens, version }
    return this.getHighlightItems(doc, startLine, endLine, tokens, legend)
  }

  public clearHighlight(): void {
    this.buffer.clearNamespace(NAMESPACE)
  }

  public cancel(rangeOnly = false): void {
    if (this.rangeTokenSource) {
      this.rangeTokenSource.cancel()
      this.rangeTokenSource.dispose()
      this.rangeTokenSource = null
    }
    if (rangeOnly) return
    this.highlight.clear()
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource.dispose()
      this.tokenSource = null
    }
  }

  public dispose(): void {
    this.cancel()
    this._highlights = []
    this._pendingHighlights.clear()
    this.previousResults = undefined
  }
}
