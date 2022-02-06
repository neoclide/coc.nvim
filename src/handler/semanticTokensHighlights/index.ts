import { Neovim } from '@chemzqm/neovim'
import { debounce } from 'debounce'
import { Disposable } from 'vscode-languageserver-protocol'
import commands from '../../commands'
import events from '../../events'
import languages from '../../languages'
import BufferSync from '../../model/bufferSync'
import FloatFactory from '../../model/floatFactory'
import Highlighter from '../../model/highligher'
import { ConfigurationChangeEvent, HandlerDelegate } from '../../types'
import { disposeAll } from '../../util'
import { distinct } from '../../util/array'
import { positionInRange } from '../../util/position'
import window from '../../window'
import workspace from '../../workspace'
import SemanticTokensBuffer, { capitalize, HLGROUP_PREFIX, NAMESPACE, SemanticTokensConfig } from './buffer'
const logger = require('../../util/logger')('semanticTokens')
const headGroup = 'Statement'

export default class SemanticTokensHighlights {
  // shared with buffers
  private config: SemanticTokensConfig
  private disposables: Disposable[] = []
  private highlighters: BufferSync<SemanticTokensBuffer>
  private floatFactory: FloatFactory
  // buffers that wait for refresh when visible
  private hiddenBuffers: Set<number> = new Set()

  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this.loadConfiguration()
    this.config.highlightGroups = workspace.env.semanticHighlights || []
    this.floatFactory = new FloatFactory(nvim)
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    commands.register({
      id: 'semanticTokens.checkCurrent',
      execute: async () => {
        await this.showHiglightInfo()
      }
    }, false, 'show semantic tokens highlight information of current buffer')
    commands.register({
      id: 'semanticTokens.refreshCurrent',
      execute: () => {
        return this.highlightCurrent()
      }
    }, false, 'refresh semantic tokens highlight of current buffer.')
    commands.register({
      id: 'semanticTokens.inspect',
      execute: () => {
        return this.inspectSemanticToken()
      }
    }, false, 'Inspect semantic token information at cursor position.')
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
    languages.onDidSemanticTokensRefresh(async selector => {
      let visibleBufs = await this.nvim.call('coc#window#bufnrs') as number[]
      let visible = await this.nvim.call('pumvisible')
      for (let item of this.highlighters.items) {
        let doc = workspace.getDocument(item.bufnr)
        if (!doc || !workspace.match(selector, doc.textDocument)) continue
        if (visibleBufs.includes(item.bufnr)) {
          this.hiddenBuffers.delete(item.bufnr)
          if (!visible) item.highlight()
        } else {
          this.hiddenBuffers.add(item.bufnr)
        }
      }
    }, null, this.disposables)
    events.on('BufWinEnter', bufnr => {
      if (!this.hiddenBuffers.has(bufnr)) return
      this.hiddenBuffers.delete(bufnr)
      let item = this.highlighters.getItem(bufnr)
      if (item && !item.rangeProviderOnly) {
        item.highlight()
      }
    }, null, this.disposables)
    events.on('BufUnload', bufnr => {
      this.hiddenBuffers.delete(bufnr)
    }, null, this.disposables)
    let fn = debounce(async bufnr => {
      let item = this.highlighters.getItem(bufnr)
      if (!item || !item.shouldRangeHighlight) return
      await item.doRangeHighlight()
    }, global.hasOwnProperty('__TEST__') ? 10 : 300)
    events.on('CursorMoved', fn, null, this.disposables)
    this.disposables.push({
      dispose: () => {
        fn.clear()
      }
    })
  }

  private loadConfiguration(e?: ConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('semanticTokens')) {
      let config = workspace.getConfiguration('semanticTokens')
      this.config = Object.assign(this.config || {}, {
        filetypes: config.get<string[]>('filetypes', []),
        highlightPriority: config.get<number>('highlightPriority', 2048),
        incrementTypes: config.get<string[]>('incrementTypes', []),
        combinedModifiers: config.get<string[]>('combinedModifiers', [])
      })
    }
  }

  public async inspectSemanticToken(): Promise<void> {
    let item = await this.getCurrentItem()
    if (!item || !item.enabled) {
      this.floatFactory.close()
      return
    }
    let position = await window.getCursorPosition()
    let highlight = item.highlights.find(o => positionInRange(position, o.range) == 0)
    if (highlight) {
      let modifiers = highlight.tokenModifiers || []
      let docs = [{
        filetype: 'txt',
        content: `Type: ${highlight.tokenType}\nModifiers: ${modifiers.join(', ')}\nHighlight group: ${highlight.hlGroup || ''}`
      }]
      await this.floatFactory.show(docs, {
        autoHide: true,
        focusable: true,
        title: 'Semantic token info',
        borderhighlight: 'MoreMsg',
        border: [1, 1, 1, 1]
      })
    } else {
      this.floatFactory.close()
    }
  }

  public async fetchHighlightGroups(): Promise<void> {
    let res = await this.nvim.call('coc#util#semantic_hlgroups') as string[]
    this.config.highlightGroups = res
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
    let item = await this.getCurrentItem()
    if (!item || !item.enabled) throw new Error(`Unable to perform semantic highlights for current buffer.`)
    await this.fetchHighlightGroups()
    await item.forceHighlight()
  }

  /**
   * Show semantic highlight info in temporarily buffer
   */
  public async showHiglightInfo(): Promise<void> {
    let buf = await this.nvim.buffer
    let { nvim } = this
    let item = this.highlighters.getItem(buf.id)
    if (!item) return nvim.echoError('Document not attached.')
    let highlighter = new Highlighter()
    nvim.pauseNotification()
    nvim.command(`vs +setl\\ buftype=nofile __coc_semantic_highlights_${buf.id}__`, true)
    nvim.command(`setl bufhidden=wipe noswapfile nobuflisted wrap undolevels=-1`, true)
    nvim.call('bufnr', ['%'], true)
    let res = await nvim.resumeNotification()
    highlighter.addLine('Semantic highlights info', headGroup)
    highlighter.addLine('')
    try {
      item.checkState()
      let highlights = item.highlights || []
      highlighter.addLine('The number of semantic tokens: ')
      highlighter.addText(String(highlights.length), 'Number')
      highlighter.addLine('')
      highlighter.addLine('Semantic highlight groups used by current buffer', headGroup)
      highlighter.addLine('')
      const groups = distinct(highlights.filter(o => o.hlGroup != null).map(({ hlGroup }) => hlGroup))
      for (const hlGroup of groups) {
        highlighter.addTexts([{ text: '-', hlGroup: 'Comment' }, { text: ' ' }, { text: hlGroup, hlGroup }])
        highlighter.addLine('')
      }
      highlighter.addLine('Tokens types that current Language Server supported:', headGroup)
      highlighter.addLine('')
      let doc = workspace.getDocument(item.bufnr)
      let legend = languages.getLegend(doc.textDocument)
      if (!legend) legend = languages.getLegend(doc.textDocument, true)
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
    nvim.pauseNotification()
    let bufnr = res[0][2] as number
    highlighter.render(nvim.createBuffer(bufnr))
    void nvim.resumeNotification(false, true)
  }

  public dispose(): void {
    this.hiddenBuffers.clear()
    this.floatFactory.dispose()
    this.highlighters.dispose()
    disposeAll(this.disposables)
  }
}
