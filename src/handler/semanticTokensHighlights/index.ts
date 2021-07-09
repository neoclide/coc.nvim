import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import commands from '../../commands'
import events from '../../events'
import languages from '../../languages'
import BufferSync from '../../model/bufferSync'
import Highlighter from '../../model/highligher'
import { ConfigurationChangeEvent, HandlerDelegate } from '../../types'
import { disposeAll } from '../../util'
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
    // may need update highlights for buffer that becomes visible
    events.on('BufEnter', bufnr => {
      let item = this.highlighters.getItem(bufnr)
      if (!item) return
      let doc = workspace.getDocument(bufnr)
      if (!doc || doc.textDocument.version == item.previousVersion) return
      item.forceHighlight().catch(e => {
        logger.error(`Error on semantic highlighters:`, e)
      })
    }, null, this.disposables)
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
    if (!e || e.affectsConfiguration('coc.preferences')) {
      // let con = this.config || {}
      let config = workspace.getConfiguration('coc.preferences')
      let enabled = config.get<boolean>('semanticTokensHighlights', true)
      if (workspace.isVim && !workspace.env.textprop) {
        enabled = false
      }
      if (this.config && enabled != this.config.enabled) {
        if (this.highlighters) {
          for (let buf of this.highlighters.items) {
            buf.setState(enabled)
          }
        }
      }
      if (!this.config) {
        this.config = { enabled }
      } else {
        this.config.enabled = enabled
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
    if (!this.config.enabled) throw new Error('Semantic highlights is disabled by configuration.')
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

  public dispose(): void {
    this.highlighters.dispose()
    disposeAll(this.disposables)
  }
}
