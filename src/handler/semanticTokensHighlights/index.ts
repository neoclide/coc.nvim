import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import extensions from '../../extensions'
import BufferSync from '../../model/bufferSync'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import SemanticTokensBuffer, { Highlight } from './buffer'
const logger = require('../../util/logger')('semanticTokens')

/**
 * @class SemanticTokensHighlights
 */
export default class SemanticTokensHighlights {
  private _enabled = true
  private disposables: Disposable[] = []
  private highlighters: BufferSync<SemanticTokensBuffer>

  constructor(private nvim: Neovim) {
    let config = workspace.getConfiguration('coc.preferences')
    this._enabled = config.get<boolean>('semanticTokensHighlights', true)
    if (workspace.isVim && !workspace.env.textprop) {
      this._enabled = false
    }
    this.highlighters = workspace.registerBufferSync(doc => {
      const buf = new SemanticTokensBuffer(this.nvim, doc.bufnr, this._enabled)
      buf.highlight()
      return buf
    })
    extensions.onDidActiveExtension(() => {
      this.highlightAll()
    }, null, this.disposables)
    workspace.onDidChangeConfiguration(async e => {
      if (workspace.isVim && !workspace.env.textprop) return
      if (e.affectsConfiguration('coc.preferences.semanticTokensHighlights')) {
        let config = workspace.getConfiguration('coc.preferences')
        let enabled = config.get<boolean>('semanticTokensHighlights', true)
        if (enabled != this._enabled) {
          this._enabled = enabled
          for (let buf of this.highlighters.items) {
            buf.setState(enabled)
          }
        }
      }
    }, null, this.disposables)
  }

  public get enabled(): boolean {
    return this._enabled
  }

  public clearHighlight(bufnr: number): void {
    let highlighter = this.highlighters.getItem(bufnr)
    if (!highlighter) return
    highlighter.clearHighlight()
  }

  public highlightAll(): void {
    for (let buf of this.highlighters.items) {
      buf.highlight()
    }
  }

  public async doHighlight(bufnr: number): Promise<void> {
    let highlighter = this.highlighters.getItem(bufnr)
    if (!highlighter) return
    await highlighter.doHighlight()
  }

  public async getHighlights(bufnr: number): Promise<Highlight[]> {
    let highlighter = this.highlighters.getItem(bufnr)
    if (!highlighter) return []
    const doc = workspace.getDocument(bufnr)
    return await highlighter.getHighlights(doc, true)
  }

  public dispose(): void {
    this.highlighters.dispose()
    disposeAll(this.disposables)
  }
}
