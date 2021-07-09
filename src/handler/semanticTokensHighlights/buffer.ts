import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationTokenSource, Range, SemanticTokens, SemanticTokensDelta, uinteger } from 'vscode-languageserver-protocol'
import languages from '../../languages'
import { SyncItem } from '../../model/bufferSync'
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

class SemanticTokensPreviousResult {
  constructor(
    public readonly resultId: string | undefined,
    public readonly tokens?: uinteger[],
  ) {}
}

const NAMESPACE = 'semanticTokens'

export default class SemanticTokensBuffer implements SyncItem {
  private tokenSource: CancellationTokenSource
  private version: number
  private previousResults: Map<number, SemanticTokensPreviousResult> = new Map()
  public highlight: Function & { clear(): void }
  constructor(
    private nvim: Neovim,
    public readonly bufnr: number,
    private enabled: boolean) {
    this.highlight = debounce(() => {
      this.doHighlight().catch(e => {
        logger.error('Error on semanticTokens highlight:', e.stack)
      })
    }, global.hasOwnProperty('__TEST__') ? 10 : 5000)
    this.highlight()
  }

  public onChange(): void {
    this.cancel()
    this.highlight()
  }

  public get buffer(): Buffer {
    return this.nvim.createBuffer(this.bufnr)
  }

  public setState(enabled: boolean): void {
    this.enabled = enabled
    if (enabled) {
      this.highlight()
    } else {
      this.clearHighlight()
    }
  }

  public async doHighlight(): Promise<void> {
    let doc = workspace.getDocument(this.bufnr)
    if (!doc || !this.enabled) return
    if (this.version && doc.version == this.version) return
    const { nvim } = this
    const curr = await this.getHighlights()
    if (!curr.length) return
    let prev: HighlightItem[] = []
    if (workspace.env.updateHighlight) {
      prev = (await nvim.call('coc#highlight#get_highlights', [this.bufnr, NAMESPACE])) as HighlightItem[]
    }
    const { highlights, lines } = this.calculateHighlightUpdates(prev, curr)
    if (!prev) {
      this.buffer.clearNamespace(NAMESPACE, 0, -1)
    } else {
      for (const ln of lines) {
        this.buffer.clearNamespace(NAMESPACE, ln, ln + 1)
      }
    }
    if (!highlights.length) return
    const groups: { [index: string]: Range[] } = {}
    for (const h of highlights) {
      const range = Range.create(h.lnum, h.colStart, h.lnum, h.colEnd)
      groups[h.hlGroup] = groups[h.hlGroup] || []
      groups[h.hlGroup].push(range)
    }
    nvim.pauseNotification()
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

  public async getHighlights(forceFull?: boolean): Promise<HighlightItem[]> {
    let doc = workspace.getDocument(this.bufnr)
    if (!doc) return []
    const legend = languages.getLegend(doc.textDocument)
    if (!legend) return []
    this.cancel()
    this.tokenSource = new CancellationTokenSource()
    const { token } = this.tokenSource
    const { version } = doc
    const hasEditProvider = languages.hasSemanticTokensEdits(doc.textDocument)
    const previousResult = forceFull ? null : this.previousResults.get(this.bufnr)
    let result: SemanticTokens | SemanticTokensDelta
    if (hasEditProvider && previousResult?.resultId) {
      result = await languages.provideDocumentSemanticTokensEdits(doc.textDocument, previousResult.resultId, token)
    } else {
      result = await languages.provideDocumentSemanticTokens(doc.textDocument, token)
    }
    this.tokenSource = null
    if (token.isCancellationRequested) return []
    if (!result) return []
    this.version = version

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
    this.previousResults.set(this.bufnr, new SemanticTokensPreviousResult(result.resultId, tokens))
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
    return res
  }

  public clearHighlight(): void {
    this.highlight.clear()
    this.version = null
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
    this.cancel()
  }
}
