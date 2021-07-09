import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationTokenSource, Range, SemanticTokens, SemanticTokensDelta, uinteger } from 'vscode-languageserver-protocol'
import languages from '../../languages'
import { SyncItem } from '../../model/bufferSync'
import Document from '../../model/document'
import { HighlightItem } from '../../types'
import workspace from '../../workspace'
const logger = require('../../util/logger')('semanticTokens-buffer')

const SEMANTIC_HLGROUP_PREFIX = 'CocSem_'
/**
 * Relative highlight
 */
interface RelativeHighlight {
  group: string
  deltaLine: number
  deltaStartCharacter: number
  length: number
}

export interface SemanticTokensConfig {
  enabled: boolean
}

interface SemanticTokensPreviousResult {
  readonly version: number
  readonly resultId: string | undefined,
  readonly tokens?: uinteger[],
}

export const NAMESPACE = 'semanticTokens'

export default class SemanticTokensBuffer implements SyncItem {
  private tokenSource: CancellationTokenSource
  private _highlights: HighlightItem[]
  private previousResults: SemanticTokensPreviousResult
  public highlight: Function & { clear(): void }
  constructor(
    private nvim: Neovim,
    public readonly bufnr: number,
    private readonly config: SemanticTokensConfig) {
    this.highlight = debounce(() => {
      this.doHighlight().catch(e => {
        logger.error('Error on semanticTokens highlight:', e.stack)
      })
    }, global.hasOwnProperty('__TEST__') ? 10 : 2000)
    this.highlight()
  }

  public onChange(): void {
    this.cancel()
    this.highlight()
  }

  public async forceHighlight(): Promise<void> {
    this.cancel()
    this.highlight.clear()
    await this.doHighlight()
  }

  /**
   * Get current highlight items
   */
  public get highlights(): ReadonlyArray<HighlightItem> {
    return this._highlights
  }

  public get enabled(): boolean {
    if (!this.config.enabled) return false
    let doc = workspace.getDocument(this.bufnr)
    if (!doc || !doc.attached) return false
    return languages.hasProvider('semanticTokens', doc.textDocument)
  }

  public get previousVersion(): number | undefined {
    if (!this.previousResults) return undefined
    return this.previousResults.version
  }

  private get buffer(): Buffer {
    return this.nvim.createBuffer(this.bufnr)
  }

  public checkState(): void {
    if (!this.config.enabled) throw new Error('SemanticTokens highlights disabled by configuration')
    let doc = workspace.getDocument(this.bufnr)
    if (!doc || !doc.attached) throw new Error('Document not attached')
    if (!languages.hasProvider('semanticTokens', doc.textDocument)) throw new Error('SemanticTokens provider not found, your languageserver may not support it')
  }

  public setState(enabled: boolean): void {
    if (enabled) {
      this.highlight()
    } else {
      this.highlight.clear()
      this.clearHighlight()
    }
  }

  private async doHighlight(): Promise<void> {
    if (!this.enabled) return
    let doc = workspace.getDocument(this.bufnr)
    const { nvim } = this
    let winid = await nvim.call('bufwinid', [this.bufnr])
    // not visible on current tab
    if (winid == -1) return
    const curr = await this.requestHighlights(doc)
    // request cancelled or can't work
    if (!curr) return
    if (!curr.length) {
      this.clearHighlight()
      return
    }
    let prev: HighlightItem[] = []
    if (workspace.env.updateHighlight) {
      prev = (await nvim.call('coc#highlight#get_highlights', [this.bufnr, NAMESPACE])) as HighlightItem[]
    }
    const { highlights, lines } = this.calculateHighlightUpdates(prev, curr)
    nvim.pauseNotification()
    if (!workspace.env.updateHighlight) {
      this.buffer.clearNamespace(NAMESPACE, 0, -1)
    } else {
      for (const ln of lines) {
        this.buffer.clearNamespace(NAMESPACE, ln, ln + 1)
      }
    }
    const groups: { [index: string]: Range[] } = {}
    if (highlights.length) {
      for (const h of highlights) {
        const range = Range.create(h.lnum, h.colStart, h.lnum, h.colEnd)
        groups[h.hlGroup] = groups[h.hlGroup] || []
        groups[h.hlGroup].push(range)
      }
    }
    for (const hlGroup of Object.keys(groups)) {
      this.buffer.highlightRanges(NAMESPACE, hlGroup, groups[hlGroup])
    }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
    if (workspace.isVim) nvim.command('redraw', true)
  }

  private calculateHighlightUpdates(prev: HighlightItem[], curr: HighlightItem[]): { highlights: HighlightItem[], lines: Set<number> } {
    const stringCompare = Intl.Collator("en").compare
    function compare(a: HighlightItem, b: HighlightItem): number {
      return (
        a.lnum - b.lnum ||
        a.colStart - b.colStart ||
        a.colEnd - b.colEnd ||
        stringCompare(a.hlGroup, b.hlGroup)
      )
    }

    prev = prev.slice().sort(compare)
    curr = curr.slice().sort(compare)

    const prevByLine: Map<number, HighlightItem[]> = new Map()
    for (const hl of prev) {
      if (!prevByLine.has(hl.lnum)) prevByLine.set(hl.lnum, [])
      prevByLine.get(hl.lnum).push(hl)
    }

    const currByLine: Map<number, HighlightItem[]> = new Map()
    for (const hl of curr) {
      if (!currByLine.has(hl.lnum)) currByLine.set(hl.lnum, [])
      currByLine.get(hl.lnum).push(hl)
    }

    const lastLine = Math.max(
      (prev[prev.length - 1] || { lnum: 0 }).lnum,
      (curr[curr.length - 1] || { lnum: 0 }).lnum
    )
    const lineNumbersToUpdate: Set<number> = new Set()
    for (let i = 0; i <= lastLine; i++) {
      const ph = prevByLine.has(i)
      const ch = currByLine.has(i)
      if (ph !== ch) {
        lineNumbersToUpdate.add(i)
        continue
      } else if (!ph && !ch) {
        continue
      }

      const pp = prevByLine.get(i)
      const cc = currByLine.get(i)

      if (pp.length !== cc.length) {
        lineNumbersToUpdate.add(i)
        continue
      }

      for (let j = 0; j < pp.length; j++) {
        if (compare(pp[j], cc[j]) !== 0) {
          lineNumbersToUpdate.add(i)
          continue
        }
      }
    }

    let highlights: HighlightItem[] = []
    for (const line of lineNumbersToUpdate) {
      highlights = highlights.concat(currByLine.get(line) || [])
    }
    return { highlights, lines: lineNumbersToUpdate }
  }

  /**
   * Request highlights from provider, return undefined when can't request or request cancelled
   * TODO use range provider as well
   */
  private async requestHighlights(doc: Document, forceFull?: boolean): Promise<HighlightItem[] | undefined> {
    const legend = languages.getLegend(doc.textDocument)
    if (!legend) return undefined
    this.cancel()
    this.tokenSource = new CancellationTokenSource()
    const { token } = this.tokenSource
    const hasEditProvider = languages.hasSemanticTokensEdits(doc.textDocument)
    const previousResult = forceFull ? null : this.previousResults
    let result: SemanticTokens | SemanticTokensDelta
    let version = doc.textDocument.version
    if (hasEditProvider && previousResult?.resultId) {
      result = await languages.provideDocumentSemanticTokensEdits(doc.textDocument, previousResult.resultId, token)
    } else {
      result = await languages.provideDocumentSemanticTokens(doc.textDocument, token)
    }
    this.tokenSource = null
    if (token.isCancellationRequested || !result) return undefined

    let tokens: uinteger[] = []
    if (SemanticTokens.is(result)) {
      tokens = result.data
    } else if (result.edits.length) {
      tokens = previousResult.tokens
      result.edits.forEach(e => {
        if (e.deleteCount > 0) {
          tokens.splice(e.start, e.deleteCount)
        } else {
          tokens.splice(e.start, 0, ...e.data)
        }
      })
    }
    this.previousResults = { resultId: result.resultId, tokens, version }
    const relatives: RelativeHighlight[] = []
    for (let i = 0; i < tokens.length; i += 5) {
      const deltaLine = tokens[i]
      const deltaStartCharacter = tokens[i + 1]
      const length = tokens[i + 2]
      const tokenType = tokens[i + 3]
      // const tokenModifiers = legend.tokenModifiers.filter((_, m) => tokens[i + 4] & (1 << m))
      const group = SEMANTIC_HLGROUP_PREFIX + legend.tokenTypes[tokenType]
      relatives.push({
        group,
        deltaLine,
        deltaStartCharacter,
        length
      })
    }

    const res: HighlightItem[] = []
    let currentLine = 0
    let currentCharacter = 0
    for (const {
      group,
      deltaLine,
      deltaStartCharacter,
      length
    } of relatives) {
      const lnum = currentLine + deltaLine
      const colStart = deltaLine === 0 ? currentCharacter + deltaStartCharacter : deltaStartCharacter
      const colEnd = colStart + length
      currentLine = lnum
      currentCharacter = colStart
      res.push({
        hlGroup: group,
        lnum,
        colStart,
        colEnd
      })
    }
    this._highlights = res
    return res
  }

  public clearHighlight(): void {
    this.buffer.clearNamespace(NAMESPACE)
  }

  public cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = null
    }
  }

  public dispose(): void {
    this.highlight.clear()
    this.previousResults = undefined
    this.cancel()
  }
}
