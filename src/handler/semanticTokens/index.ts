'use strict'
import type { Neovim } from '@chemzqm/neovim'
import commands from '../../commands'
import events from '../../events'
import languages from '../../languages'
import BufferSync from '../../model/bufferSync'
import Highlighter from '../../model/highligher'
import { Documentation, FloatFactory } from '../../types'
import { disposeAll } from '../../util'
import { distinct, isFalsyOrEmpty, toArray } from '../../util/array'
import type { Disposable } from '../../util/protocol'
import { toErrorText, toText, upperFirst } from '../../util/string'
import window from '../../window'
import workspace from '../../workspace'
import SemanticTokensBuffer, { HLGROUP_PREFIX, NAMESPACE, StaticConfig, toHighlightPart } from './buffer'
const headGroup = 'Statement'

function getFiletypes(): string[] {
  return workspace.initialConfiguration.get<string[] | null>('semanticTokens.filetypes', null)
}
let floatFactory: FloatFactory | undefined

export default class SemanticTokens {
  private disposables: Disposable[] = []
  private highlighters: BufferSync<SemanticTokensBuffer>
  public staticConfig: StaticConfig

  constructor(private nvim: Neovim) {
    this.staticConfig = {
      filetypes: getFiletypes(),
      highlightGroups: []
    }
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('semanticTokens')) {
        this.staticConfig.filetypes = getFiletypes()
        for (let item of this.highlighters.items) {
          item.loadConfiguration()
        }
      }
    }, this, this.disposables)
    commands.register({
      id: 'semanticTokens.checkCurrent',
      execute: async () => {
        await this.showHighlightInfo()
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
      return new SemanticTokensBuffer(this.nvim, doc, this.staticConfig)
    })
    languages.onDidSemanticTokensRefresh(async selector => {
      if (isFalsyOrEmpty(this.staticConfig.highlightGroups)) await this.fetchHighlightGroups()
      let visibleBufs = window.visibleTextEditors.map(o => o.document.bufnr)
      for (let item of this.highlighters.items) {
        if (!workspace.match(selector, item.doc)) continue
        if (!item.hasProvider) {
          item.clearHighlight()
        } else {
          item.abandonResult()
          if (visibleBufs.includes(item.bufnr)) {
            item.highlight()
          }
        }
      }
    }, null, this.disposables)
    events.on('BufWinEnter', async bufnr => {
      let item = this.highlighters.getItem(bufnr)
      if (item) await item.onShown()
    }, null, this.disposables)
    events.on('CursorMoved', async bufnr => {
      let item = this.highlighters.getItem(bufnr)
      if (item) await item.onCursorMoved()
    }, null, this.disposables)
  }

  public async inspectSemanticToken(): Promise<void> {
    let item = await this.getCurrentItem()
    if (!item || !item.enabled) {
      if (!item) {
        let doc = await workspace.document
        void window.showErrorMessage(`Document not attached, ${doc.notAttachReason}`)
      } else {
        try {
          item.checkState()
        } catch (e) {
          void window.showErrorMessage((e as Error).message)
        }
      }
      this.closeFloat()
      return
    }
    let [_, line, col] = await this.nvim.call('getcurpos', []) as [number, number, number]
    let highlights = toArray(item.highlights)
    let highlight = highlights.find(o => {
      let column = col - 1
      return o.range[0] === line - 1 && column >= o.range[1] && column < o.range[2]
    })
    if (highlight) {
      let modifiers = toArray(highlight.tokenModifiers)
      let highlights = []
      if (highlight.hlGroup) {
        let s = 'Highlight group: '.length
        highlights.push({
          lnum: 2,
          colStart: s,
          colEnd: s + highlight.hlGroup.length,
          hlGroup: highlight.hlGroup
        })
      }
      let docs: Documentation[] = [{
        filetype: 'txt',
        content: `Type: ${highlight.tokenType}\nModifiers: ${modifiers.join(', ')}\nHighlight group: ${toText(highlight.hlGroup)}`,
        highlights
      }]
      if (!floatFactory) {
        floatFactory = window.createFloatFactory({
          title: 'Semantic token info',
          highlight: 'Normal',
          borderhighlight: 'MoreMsg',
          border: [1, 1, 1, 1]
        })
      }
      await floatFactory.show(docs, { winblend: 0 })
    } else {
      this.closeFloat()
    }
  }

  public closeFloat(): void {
    floatFactory?.close()
  }

  public async fetchHighlightGroups(): Promise<void> {
    let highlightGroups = await this.nvim.call('coc#util#semantic_hlgroups') as string[]
    this.staticConfig.highlightGroups = highlightGroups
  }

  public async getCurrentItem(): Promise<SemanticTokensBuffer | undefined> {
    let buf = await this.nvim.buffer
    return this.getItem(buf.id)
  }

  public getItem(bufnr: number): SemanticTokensBuffer | undefined {
    return this.highlighters.getItem(bufnr)
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
  public async showHighlightInfo(): Promise<void> {
    let bufnr = await this.nvim.call('bufnr', ['%']) as number
    workspace.getAttachedDocument(bufnr)
    let { nvim } = this
    let item = this.highlighters.getItem(bufnr)
    let hl = new Highlighter()
    nvim.pauseNotification()
    nvim.command(`vs +setl\\ buftype=nofile __coc_semantic_highlights_${bufnr}__`, true)
    nvim.command(`setl bufhidden=wipe noswapfile nobuflisted wrap undolevels=-1`, true)
    nvim.call('bufnr', ['%'], true)
    let res = await nvim.resumeNotification()
    hl.addLine('Semantic highlights info', headGroup)
    hl.addLine('')
    try {
      item.checkState()
      let highlights = item.highlights ?? []
      hl.addLine('The number of semantic tokens: ')
      hl.addText(String(highlights.length), 'Number')
      hl.addLine('')
      hl.addLine('Semantic highlight groups used by current buffer', headGroup)
      hl.addLine('')
      const groups = distinct(highlights.filter(o => o.hlGroup != null).map(({ hlGroup }) => hlGroup))
      for (const hlGroup of groups) {
        hl.addTexts([{ text: '-', hlGroup: 'Comment' }, { text: ' ' }, { text: hlGroup, hlGroup }])
      }
      hl.addLine('')
      hl.addLine('Tokens types that current Language Server supported:', headGroup)
      hl.addLine('')
      let doc = workspace.getDocument(item.bufnr)
      let legend = languages.getLegend(doc.textDocument) ?? languages.getLegend(doc.textDocument, true)
      if (legend.tokenTypes.length) {
        for (const t of [...new Set(legend.tokenTypes)]) {
          let text = HLGROUP_PREFIX + toHighlightPart(t)
          hl.addTexts([{ text: '-', hlGroup: 'Comment' }, { text: ' ' }, { text, hlGroup: text }])
        }
        hl.addLine('')
      } else {
        hl.addLine('No token types supported', 'Comment')
        hl.addLine('')
      }
      hl.addLine('Tokens modifiers that current Language Server supported:', headGroup)
      hl.addLine('')
      if (legend.tokenModifiers.length) {
        for (const t of [...new Set(legend.tokenModifiers)]) {
          let text = HLGROUP_PREFIX + toHighlightPart(t)
          hl.addTexts([{ text: '-', hlGroup: 'Comment' }, { text: ' ' }, { text, hlGroup: text }])
        }
        hl.addLine('')
      } else {
        hl.addLine('No token modifiers exist', 'Comment')
        hl.addLine('')
      }
    } catch (e) {
      hl.addLine(toErrorText(e))
    }
    nvim.pauseNotification()
    hl.render(nvim.createBuffer(res[0][2] as number))
    nvim.resumeNotification(true, true)
  }

  public dispose(): void {
    this.highlighters.dispose()
    disposeAll(this.disposables)
  }
}
