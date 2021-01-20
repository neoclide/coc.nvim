import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import languages from '../languages'
import Document from '../model/document'
import { disposeAll } from '../util'
import workspace from '../workspace'
const logger = require('../util/logger')('semanticTokensHighlight')

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

/**
 * Semantic highlights for current buffer.
 */
export default class SemanticHighlights {
  private disposables: Disposable[] = []
  private tokenSource: CancellationTokenSource
  private highlightedBuffers: Set<number> = new Set()

  constructor(private nvim: Neovim) {}

  public async highlight(doc: Document): Promise<void> {
    this.cancel()
    if (!doc || !doc.attached) return
    const support = await this.vimCheckFeatures()
    if (!support) return

    const curr = await this.getHighlights(doc)
    if (!curr) return

    const prev = await this.vimGetCurrentHighlights(doc)
    const highlightChanges = this.calculateHighlightUpdates(prev, curr)
    logger.debug(
      `calculating highlight changes finished: updates ${JSON.stringify(
        Object.fromEntries(highlightChanges)
      )}`
    )

    // record, clear, and add highlights
    await this.updateHighlights(doc, highlightChanges)
    this.highlightedBuffers.add(doc.bufnr)
  }

  public async getHighlights(doc: Document): Promise<Highlight[]> {
    try {
      this.cancel()
      if (!doc || !doc.attached) return
      const relatives = await this.getRelativeHighlights(doc)
      let res: Highlight[] = []
      let currentLine = 0
      let currentCharacter = 0
      for (const {
        group,
        deltaLine,
        deltaStartCharacter,
        length
      } of relatives) {
        const line = currentLine + deltaLine
        const startCharacter =
          deltaLine == 0
            ? currentCharacter + deltaStartCharacter
            : deltaStartCharacter
        const endCharacter = startCharacter + length
        currentLine = line
        currentCharacter = startCharacter
        res.push({ group, line, startCharacter, endCharacter })
      }

      return res
    } catch (_e) {
      return null
    }
  }

  private async getRelativeHighlights(doc: Document): Promise<RelativeHighlight[]> {
    try {
      this.tokenSource = new CancellationTokenSource()
      doc.forceSync()
      const { token } = this.tokenSource
      const legend = languages.getLegend()
      const tokens = await languages.provideDocumentSemanticTokens(doc.textDocument, token)
      this.tokenSource = null
      if (token.isCancellationRequested) return null

      const res: RelativeHighlight[] = []
      for (let i = 0; i < tokens.data.length; i += 5) {
        const deltaLine = tokens.data[i]
        const deltaStartCharacter = tokens.data[i + 1]
        const length = tokens.data[i + 2]
        const tokenType = tokens.data[i + 3]
        // TODO: support tokenModifiers
        // const tokenModifiers = highlights.data[i + 4];

        const group = SEMANTIC_HIGHLIGHTS_HLGROUP_PREFIX + legend.tokenTypes[tokenType]
        res.push({
          group,
          deltaLine,
          deltaStartCharacter,
          length
        })
      }
      return res
    } catch (_e) {
      return null
    }
  }

  public calculateHighlightUpdates(
    prev: Highlight[],
    curr: Highlight[]
  ): Map<number, Highlight[]> {
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

    const res: Map<number, Highlight[]> = new Map()
    for (const line of lineNumbersToUpdate) {
      res.set(line, currByLine.get(line) || [])
    }
    return res
  }

  public hasHighlights(bufnr: number): boolean {
    return this.highlightedBuffers.has(bufnr)
  }

  public clearHighlights(): void {
    if (this.highlightedBuffers.size == 0) return
    for (const bufnr of this.highlightedBuffers) {
      const doc = workspace.getDocument(bufnr)
      void this.vimClearHighlights(doc)
    }
    this.highlightedBuffers.clear()
  }

  private async updateHighlights(
    doc: Document,
    highlights: Map<number, Highlight[]>
  ): Promise<void> {
    if (workspace.isVim) {
      const newGroups = [...highlights.values()].flat().map(e => e.group)
      const registered = new Set(await this.nvim.call("prop_type_list"))
      const groupsToRegister = newGroups.filter(g => !registered.has(g))
      await this.nvim.call("coc#semantic_highlight#prepare_highlight_groups", [
        doc.bufnr,
        groupsToRegister
      ])
    }

    await this.nvim.call("coc#semantic_highlight#add_highlights", [
      doc.bufnr,
      Object.fromEntries(highlights)
    ])

    if (workspace.isVim) this.nvim.command("redraw", true)
  }

  private async vimCheckFeatures(): Promise<boolean> {
    if (workspace.isVim) {
      return await this.nvim.call("has", ["textprop"])
    } else if (workspace.isNvim) {
      return await this.nvim.call("exists", ["*nvim_buf_add_highlight"])
    } else {
      return false
    }
  }

  private async vimClearHighlights(doc: Document): Promise<void> {
    return await this.nvim.call("coc#semantic_highlight#clear_highlights", [doc.bufnr])
  }

  private async vimGetCurrentHighlights(doc: Document): Promise<Highlight[]> {
    return await this.nvim.call("coc#semantic_highlight#get_highlights", [doc.bufnr])
  }

  private cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource.dispose()
      this.tokenSource = null
    }
  }

  public dispose(): void {
    this.clearHighlights()
    this.highlightedBuffers.clear()
    this.cancel()
    disposeAll(this.disposables)
  }
}
