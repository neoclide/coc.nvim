import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import commands from '../../commands'
import languages from '../../languages'
import BufferSync from '../../model/bufferSync'
import Highlighter from '../../model/highligher'
import { ConfigurationChangeEvent, HandlerDelegate } from '../../types'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import SemanticTokensBuffer, { capitalize, HLGROUP_PREFIX, NAMESPACE, SemanticTokensConfig } from './buffer'
const logger = require('../../util/logger')('semanticTokens')
const headGroup = 'Statement'

export default class SemanticTokensHighlights {
  // shared with buffers
  private config: SemanticTokensConfig
  private disposables: Disposable[] = []
  private highlighters: BufferSync<SemanticTokensBuffer>

  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    commands.register({
      id: 'semanticTokens.checkCurrent',
      execute: async () => {
        await this.showHiglightInfo()
      }
    }, false, 'show semantic tokens highlight information of current buffer')
    commands.register({
      id: 'semanticTokens.clearCurrent',
      execute: async () => {
        let buf = await nvim.buffer
        buf.clearNamespace(NAMESPACE, 0, -1)
      }
    }, false, 'clear semantic tokens highlight of current buffer')
    commands.register({
      id: 'semanticTokens.clearAll',
      execute: async () => {
        let bufs = await nvim.buffers
        for (let buf of bufs) {
          buf.clearNamespace(NAMESPACE, 0, -1)
        }
      }
    }, false, 'clear semantic tokens highlight of all buffers')
    this.highlighters = workspace.registerBufferSync(doc => {
      return new SemanticTokensBuffer(this.nvim, doc.bufnr, this.config)
    })
    languages.onDidSemanticTokensRefresh(selector => {
      for (let item of this.highlighters.items) {
        let doc = workspace.getDocument(item.bufnr)
        if (doc && workspace.match(selector, doc.textDocument)) {
          item.highlight()
        }
      }
    }, null, this.disposables)
  }

  private loadConfiguration(e?: ConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('semanticTokens')) {
      let config = workspace.getConfiguration('semanticTokens')
      this.config = Object.assign(this.config || {}, {
        filetypes: config.get<string[]>('filetypes', []),
        highlightPriority: config.get<number>('highlightPriority', 2048),
        incrementTypes: config.get<string[]>('incrementTypes'),
        combinedModifiers: config.get<string[]>('combinedModifiers')
      })
    }
  }

  public async getCurrentItem(): Promise<SemanticTokensBuffer | null> {
    let buf = await this.nvim.buffer
    let highlighter = this.highlighters.getItem(buf.id)
    if (!highlighter) null
    return highlighter
  }

  /**
   * Force highlight of current buffer
   */
  public async highlightCurrent(): Promise<void> {
    let highlighter = await this.getCurrentItem()
    if (!highlighter) return
    highlighter.checkState()
    await highlighter.forceHighlight()
  }

  /**
   * Show semantic highlight info in temporarily buffer
   */
  public async showHiglightInfo(): Promise<void> {
    let buf = await this.nvim.buffer
    let highlighter = new Highlighter()
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command(`vs +setl\\ buftype=nofile __coc_semantic_highlights_${buf.id}__`, true)
    nvim.command(`setl bufhidden=wipe noswapfile nobuflisted wrap undolevels=-1`, true)
    nvim.call('bufnr', ['%'], true)
    let res = await nvim.resumeNotification()
    let item = this.highlighters.getItem(buf.id)
    highlighter.addLine('Semantic highlights info', headGroup)
    highlighter.addLine('')
    if (!item) {
      highlighter.addLine('Document not attached.', 'WarningMsg')
    } else {
      try {
        item.checkState()
        let highlights = item.highlights || []
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
        let doc = workspace.getDocument(item.bufnr)
        const legend = languages.getLegend(doc.textDocument)
        if (legend?.tokenTypes.length) {
          for (const t of [...new Set(legend.tokenTypes)]) {
            let text = HLGROUP_PREFIX + capitalize(t)
            highlighter.addTexts([{ text: '-', hlGroup: 'Comment' }, { text: ' ' }, { text, hlGroup: text }])
            highlighter.addLine('')
          }
        } else {
          highlighter.addLine('No token types supported', 'Comment')
        }
        highlighter.addLine('Tokens modifiers that current Language Server supported:', headGroup)
        highlighter.addLine('')
        if (legend?.tokenModifiers.length) {
          for (const t of [...new Set(legend.tokenModifiers)]) {
            let text = HLGROUP_PREFIX + capitalize(t)
            highlighter.addTexts([{ text: '-', hlGroup: 'Comment' }, { text: ' ' }, { text, hlGroup: text }])
            highlighter.addLine('')
          }
        } else {
          highlighter.addLine('No token modifiers exists', 'Comment')
        }
      } catch (e) {
        highlighter.addLine(e.message, 'Error')
      }
    }
    nvim.pauseNotification()
    let bufnr = res[0][2] as number
    highlighter.render(nvim.createBuffer(bufnr))
    void nvim.resumeNotification(false, true)
  }

  public dispose(): void {
    this.highlighters.dispose()
    disposeAll(this.disposables)
  }
}
