import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import commands from '../../commands'
import languages from '../../languages'
import BufferSync from '../../model/bufferSync'
import Highlighter from '../../model/highligher'
import { ConfigurationChangeEvent, HandlerDelegate } from '../../types'
import { disposeAll } from '../../util'
import { equals } from '../../util/object'
import window from '../../window'
import workspace from '../../workspace'
import SemanticTokensBuffer, { NAMESPACE, SemanticTokensConfig } from './buffer'
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
        try {
          let item = await this.getCurrentItem()
          item.checkState()
        } catch (e) {
          window.showMessage(e.message, 'error')
          return
        }
        window.showMessage('Semantic tokens provider found for current buffer', 'more')
      }
    }, false, 'check semantic tokens provider for current buffer')
    commands.register({
      id: 'semanticTokens.clearCurrent',
      execute: async () => {
        let buf = await nvim.buffer
        buf.clearNamespace(NAMESPACE, 0, -1)
      }
    }, false, 'clear semantic tokens highlights of current buffer')
    commands.register({
      id: 'semanticTokens.clearAll',
      execute: async () => {
        let bufs = await nvim.buffers
        for (let buf of bufs) {
          buf.clearNamespace(NAMESPACE, 0, -1)
        }
      }
    }, false, 'clear semantic tokens highlights of all buffers')
    this.disposables.push({
      dispose: () => {
        commands.unregister('semanticTokens.checkCurrentBuffer')
      }
    })
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
      let filetypes = config.get<string[]>('filetypes', [])
      if (workspace.isVim && !workspace.env.textprop) {
        filetypes = []
      }

      if (this.config && !equals(filetypes, this.config.filetypes)) {
        if (this.highlighters) {
          for (let buf of this.highlighters.items) {
            const doc = workspace.getDocument(buf.bufnr)
            if (doc && doc.attached) {
              buf.setState(filetypes.includes(doc.filetype))
            }
          }
        }
      }

      if (!this.config) {
        this.config = { filetypes }
      } else {
        this.config.filetypes = filetypes
      }
    }
  }

  public async getCurrentItem(): Promise<SemanticTokensBuffer> {
    let buf = await this.nvim.buffer
    let highlighter = this.highlighters.getItem(buf.id)
    if (!highlighter) throw new Error('current buffer not attached')
    return highlighter
  }

  /**
   * Force highlight of current buffer
   */
  public async highlightCurrent(): Promise<void> {
    let highlighter = await this.getCurrentItem()
    highlighter.checkState()
    await highlighter.forceHighlight()
  }

  /**
   * Show semantic highlight info in temporarily buffer
   */
  public async showHiglightInfo(): Promise<void> {
    let item = await this.getCurrentItem()
    item.checkState()
    let highlights = item.highlights || []
    let highlighter = new Highlighter()
    let { nvim } = this
    nvim.pauseNotification()
    nvim.command(`vs +setl\\ buftype=nofile __coc_semantic_highlights_${item.bufnr}__`, true)
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
    let doc = workspace.getDocument(item.bufnr)
    const legend = languages.getLegend(doc.textDocument)
    if (legend?.tokenTypes.length) {
      for (const t of [...new Set(legend.tokenTypes)]) {
        highlighter.addTexts([{ text: '-', hlGroup: 'Comment' }, { text: ' ' }, { text: `TS${t}`, hlGroup: `TS${t}` }])
        highlighter.addLine('')
      }
    } else {
      highlighter.addLine('No token types supported', 'Comment')
    }
    highlighter.addLine('Tokens modifiers that current Language Server supported:', headGroup)
    highlighter.addLine('')
    if (legend?.tokenModifiers.length) {
      for (const t of [...new Set(legend.tokenModifiers)]) {
        highlighter.addTexts([{ text: '-', hlGroup: 'Comment' }, { text: ' ' }, { text: `TS${t}`, hlGroup: `TS${t}` }])
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

  public dispose(): void {
    this.highlighters.dispose()
    disposeAll(this.disposables)
  }
}
