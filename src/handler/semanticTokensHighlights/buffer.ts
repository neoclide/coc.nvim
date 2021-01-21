import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { CancellationTokenSource, Range } from 'vscode-languageserver-protocol'
import languages from '../../languages'
import { SyncItem } from '../../model/bufferSync'
import Document from '../../model/document'
import { equals } from '../../util/object'
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

export default class SemanticTokensBuffer implements SyncItem {
  private _highlights: Highlight[] = []
  private tokenSource: CancellationTokenSource
  private version: number
  public highlight: Function & { clear(): void }
  constructor(
    private nvim: Neovim,
    private bufnr: number,
    private enabled: boolean) {
    this.highlight = debounce(() => {
      this.doHighlight().catch(e => {
        logger.error('Error on semanticTokens highlight:', e.stack)
      })
    }, global.hasOwnProperty('__TEST__') ? 10 : 500)
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
      // TODO: diff
      const highlights = await this.getHighlights(doc)
      if (!highlights) return
      if (equals(this._highlights, highlights)) return
      this._highlights = highlights

      const groups: { [index: string]: Range[] } = {}
      for (const h of highlights) {
        const range = Range.create(h.line, h.startCharacter, h.line, h.endCharacter)
        groups[h.group] = groups[h.group] || []
        groups[h.group].push(range)
      }

      const { nvim } = this
      nvim.pauseNotification()
      this.buffer.clearNamespace('semanticTokens')
      for (const hlGroup of Object.keys(groups)) {
        this.buffer.highlightRanges('semanticTokens', hlGroup, groups[hlGroup])
      }

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      nvim.resumeNotification(false, true)
      if (workspace.isVim) nvim.command('redraw', true)
    } catch (e) {
      logger.error('Error on semanticTokens highlight:', e)
    }
  }

  public async getHighlights(doc: Document): Promise<Highlight[]> {
    this.cancel()
    this.tokenSource = new CancellationTokenSource()
    const { token } = this.tokenSource
    const { version } = doc
    const legend = languages.getLegend()
    const tokens = await languages.provideDocumentSemanticTokens(doc.textDocument, token)
    this.tokenSource = null
    if (token.isCancellationRequested) return []
    if (!tokens) return []
    this.version = version

    const relatives: RelativeHighlight[] = []
    for (let i = 0; i < tokens.data.length; i += 5) {
      const deltaLine = tokens.data[i]
      const deltaStartCharacter = tokens.data[i + 1]
      const length = tokens.data[i + 2]
      const tokenType = tokens.data[i + 3]
      // TODO: support tokenModifiers
      // const tokenModifiers = highlights.data[i + 4];

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
  }
  public clearHighlight(): void {
    this.highlight.clear()
    this._highlights = []
    this.version = null
    this.buffer.clearNamespace('semanticTokens')
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
