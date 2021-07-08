import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import extensions from '../../extensions'
import BufferSync from '../../model/bufferSync'
import { disposeAll } from '../../util'
import { ConfigurationChangeEvent, HandlerDelegate } from '../../types'
import workspace from '../../workspace'
import SemanticTokensBuffer from './buffer'
import Highlighter from '../../model/highligher'
import languages from '../../languages'
import { HighlightItem } from '../../types'
const logger = require('../../util/logger')('semanticTokens')
const headGroup = 'Statement'

export default class SemanticTokensHighlights {
  private _enabled = true
  private disposables: Disposable[] = []
  private highlighters: BufferSync<SemanticTokensBuffer>

  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this.loadConfiguration()
    this.highlighters = workspace.registerBufferSync(doc => {
      return new SemanticTokensBuffer(this.nvim, doc.bufnr, this._enabled)
    })
    extensions.onDidActiveExtension(() => {
      this.highlightAll()
    }, null, this.disposables)
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    languages.onDidSemanticTokensRefresh(async selector => {
      for (let item of this.highlighters.items) {
        let doc = workspace.getDocument(item.bufnr)
        if (doc && workspace.match(selector, doc.textDocument)) {
          await item.doHighlight()
        }
      }
    }, null, this.disposables)
  }

  private loadConfiguration(e?: ConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('coc.preferences')) {
      if (workspace.isVim && !workspace.env.textprop) {
        this._enabled = false
        return
      }
      let config = workspace.getConfiguration('coc.preferences')
      let enabled = config.get<boolean>('semanticTokensHighlights', true)
      if (enabled != this._enabled) {
        this._enabled = enabled
        if (this.highlighters) {
          for (let buf of this.highlighters.items) {
            buf.setState(enabled)
          }
        }
      }
    }
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

  public async highlightCurrent(): Promise<void> {
    let { doc } = await this.handler.getCurrentState()
    this.handler.checkProvier('semanticTokens', doc.textDocument)
    await doc.synchronize()
    await this.doHighlight(doc.bufnr)
  }

  /**
   * Show semantic highlight info in temporarily buffer
   */
  public async showHiglightInfo(): Promise<void> {
    if (!this.enabled) throw new Error('Semantic highlights is disabled.')
    let { doc } = await this.handler.getCurrentState()
    this.handler.checkProvier('semanticTokens', doc.textDocument)
    let highlights = (await this.getHighlights(doc.bufnr)) || []
    let highlighter = new Highlighter()
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command(`vs +setl\\ buftype=nofile __coc_semantic_highlights_${doc.bufnr}__`, true)
    nvim.command(`setl bufhidden=wipe noswapfile nobuflisted wrap undolevels=-1`, true)
    nvim.call('bufnr', ['%'], true)
    let res = await nvim.resumeNotification()
    if (res[1]) throw new Error(`Error on buffer create: ${res[1]}`)
    let bufnr = res[0][2] as number
    highlighter.addLine('Semantic highlights info', headGroup)
    highlighter.addLine('')
    highlighter.addLine('The number of semantic tokens: ')
    highlighter.addText(String(highlights.length), 'Number')
    highlighter.addLine('')
    highlighter.addLine('Semantic highlight groups used by current buffer', headGroup)
    highlighter.addLine('')
    const groups = [...new Set(highlights.map(({ hlGroup }) => hlGroup))]
    for (const hlGroup of groups) {
      highlighter.addTexts([{ text: '-', hlGroup: 'Comment' }, { text: ' ' }, { text: hlGroup, hlGroup }])
      highlighter.addLine('')
    }
    highlighter.addLine('Tokens types that current Language Server supported:', headGroup)
    highlighter.addLine('')
    const legend = languages.getLegend(doc.textDocument)
    if (legend?.tokenTypes.length) {
      for (const t of legend.tokenTypes) {
        highlighter.addTexts([{ text: '-', hlGroup: 'Comment' }, { text: ' ' }, { text: `CocSem_${t}`, hlGroup: `CocSem_${t}` }])
        highlighter.addLine('')
      }
    } else {
      highlighter.addLine('No token types supported', 'Comment')
    }
    highlighter.addLine('Tokens modifiers that current Language Server supported:', headGroup)
    highlighter.addLine('')
    if (legend?.tokenModifiers.length) {
      for (const t of legend.tokenModifiers) {
        highlighter.addTexts([{ text: '-', hlGroup: 'Comment' }, { text: ' ' }, { text: `CocSem_${t}`, hlGroup: `CocSem_${t}` }])
        highlighter.addLine('')
      }
    } else {
      highlighter.addLine('No token modifiers supported', 'Comment')
    }
    nvim.pauseNotification()
    highlighter.render(nvim.createBuffer(bufnr))
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
  }

  private async doHighlight(bufnr: number): Promise<void> {
    let highlighter = this.highlighters.getItem(bufnr)
    if (!highlighter) return
    await highlighter.doHighlight()
  }

  public async getHighlights(bufnr: number): Promise<HighlightItem[]> {
    let highlighter = this.highlighters.getItem(bufnr)
    if (!highlighter) return []
    return await highlighter.getHighlights(true)
  }

  public dispose(): void {
    this.highlighters.dispose()
    disposeAll(this.disposables)
  }
}
