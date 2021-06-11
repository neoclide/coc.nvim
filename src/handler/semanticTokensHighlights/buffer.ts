import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationTokenSource, Range, SemanticTokens, SemanticTokensDelta, uinteger } from 'vscode-languageserver-protocol'
import languages from '../../languages'
import { SyncItem } from '../../model/bufferSync'
import Document from '../../model/document'
import workspace from '../../workspace'
const logger = require('../../util/logger')('semanticTokens-buffer')

const SEMANTIC_HIGHLIGHTS_HLGROUP_PREFIX = 'CocSem_'
/**
 * Relative highlight
 */
interface RelativeHighlight {
  group: string
  deltaLine: number
  deltaStartCharacter: number
  length: number
}

/**
 * highlight
 */
export interface Highlight {
  group: string
  line: number // 0-indexed
  startCharacter: number // 0-indexed
  endCharacter: number // 0-indexed
}

class SemanticTokensPreviousResult {
  constructor(
    public readonly resultId: string | undefined,
    public readonly tokens?: uinteger[],
  ) { }
}

export default class SemanticTokensBuffer implements SyncItem {
  private tokenSource: CancellationTokenSource
  private version: number
  private namespace = 'semanticTokens'
  private previousResults: Map<number, SemanticTokensPreviousResult> = new Map()
  public highlight: Function & { clear(): void }
  constructor(
    private nvim: Neovim,
    private bufnr: number,
    private enabled: boolean) {
    this.highlight = debounce(() => {
      this.doHighlight().catch(e => {
        logger.error('Error on semanticTokens highlight:', e.stack)
      })
    }, global.hasOwnProperty('__TEST__') ? 10 : 5000)
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

    try {
      const { nvim } = this

      const curr = await this.getHighlights(doc)
      if (!curr.length) return
      const prev = await this.vimGetCurrentHighlights(doc)
      const { highlights, lines } = this.calculateHighlightUpdates(prev, curr)
      for (const ln of lines) {
        this.buffer.clearNamespace(this.namespace, ln, ln + 1)
      }
      if (!highlights.length) return

      const groups: { [index: string]: Range[] } = {}
      for (const h of highlights) {
        const range = Range.create(h.line, h.startCharacter, h.line, h.endCharacter)
        groups[h.group] = groups[h.group] || []
        groups[h.group].push(range)
      }

      nvim.pauseNotification()
      for (const hlGroup of Object.keys(groups)) {
        this.buffer.highlightRanges(this.namespace, hlGroup, groups[hlGroup])
      }

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      nvim.resumeNotification(false, true)
      if (workspace.isVim) nvim.command('redraw', true)
    } catch (e) {
      logger.error('Error on semanticTokens highlight:', e)
    }
  }

  private async vimGetCurrentHighlights(doc: Document): Promise<Highlight[]> {
    return await this.nvim.call("coc#highlight#get_highlights", [doc.bufnr, this.namespace])
  }

  private calculateHighlightUpdates(prev: Highlight[], curr: Highlight[]): { highlights: Highlight[], lines: Set<number> } {
    const stringCompare = Intl.Collator("en").compare
    function compare(a: Highlight, b: Highlight): number {
      return (
        a.line - b.line ||
        a.startCharacter - b.startCharacter ||
        a.endCharacter - b.endCharacter ||
        stringCompare(a.group, b.group)
      )
    }

    prev = prev.slice().sort(compare)
    curr = curr.slice().sort(compare)

    const prevByLine: Map<number, Highlight[]> = new Map()
    for (const hl of prev) {
      if (!prevByLine.has(hl.line)) prevByLine.set(hl.line, [])
      prevByLine.get(hl.line).push(hl)
    }

    const currByLine: Map<number, Highlight[]> = new Map()
    for (const hl of curr) {
      if (!currByLine.has(hl.line)) currByLine.set(hl.line, [])
      currByLine.get(hl.line).push(hl)
    }

    const lastLine = Math.max(
      (prev[prev.length - 1] || { line: 0 }).line,
      (curr[curr.length - 1] || { line: 0 }).line
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

    let highlights: Highlight[] = []
    for (const line of lineNumbersToUpdate) {
      highlights = highlights.concat(currByLine.get(line) || [])
    }
    return { highlights, lines: lineNumbersToUpdate }
  }

  public async getHighlights(doc: Document, forceFull?: boolean): Promise<Highlight[]> {
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

      const group = SEMANTIC_HIGHLIGHTS_HLGROUP_PREFIX + legend.tokenTypes[tokenType]
      relatives.push({
        group,
        deltaLine,
        deltaStartCharacter,
        length
      })
    }

    const res: Highlight[] = []
    let currentLine = 0
    let currentCharacter = 0
    for (const {
      group,
      deltaLine,
      deltaStartCharacter,
      length
    } of relatives) {
      const line = currentLine + deltaLine
      const startCharacter = deltaLine === 0 ? currentCharacter + deltaStartCharacter : deltaStartCharacter
      const endCharacter = startCharacter + length
      currentLine = line
      currentCharacter = startCharacter
      res.push({ group, line, startCharacter, endCharacter })
    }

    return res
  }
  public clearHighlight(): void {
    this.highlight.clear()
    this.version = null
    this.buffer.clearNamespace(this.namespace)
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
