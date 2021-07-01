import { Neovim } from '@chemzqm/neovim'
import { ConfigurationChangeEvent, Documentation, HandlerDelegate } from '../types'
import FloatFactory, { FloatWinConfig } from '../model/floatFactory'
import { CancellationTokenSource, Disposable, Hover, MarkedString, MarkupContent, Range } from 'vscode-languageserver-protocol'
import { disposeAll } from '../util'
import { TextDocumentContentProvider } from '../provider'
import workspace from '../workspace'
import { addDocument, isMarkdown, synchronizeDocument } from './helper'
import languages from '../languages'
const logger = require('../util/logger')('handler-signature')

interface HoverConfig {
  target: string
  previewMaxHeight: number
}

export default class HoverHandler {
  private hoverFactory: FloatFactory
  private disposables: Disposable[] = []
  private documentLines: string[] = []
  private config: HoverConfig
  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    this.hoverFactory = new FloatFactory(nvim)
    this.disposables.push(this.hoverFactory)
    let provider: TextDocumentContentProvider = {
      onDidChange: null,
      provideTextDocumentContent: async () => {
        nvim.pauseNotification()
        nvim.command('setlocal conceallevel=2 nospell nofoldenable wrap', true)
        nvim.command('setlocal bufhidden=wipe nobuflisted', true)
        nvim.command('setfiletype markdown', true)
        nvim.command(`if winnr('j') != winnr('k') | exe "normal! z${Math.min(this.documentLines.length, this.config.previewMaxHeight)}\\<cr> | endif"`, true)
        await nvim.resumeNotification()
        return this.documentLines.join('\n')
      }
    }
    this.disposables.push(workspace.registerTextDocumentContentProvider('coc', provider))
  }

  private loadConfiguration(e?: ConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('hover')) {
      let config = workspace.getConfiguration('hover')
      let target = config.get<string>('target', 'float')
      if (target == 'float' && !workspace.floatSupported) {
        target = 'preview'
      }
      this.config = {
        target,
        previewMaxHeight: config.get<number>('previewMaxHeight', 12)
      }
    }
  }

  public async onHover(hoverTarget?: string): Promise<boolean> {
    let { doc, position, winid } = await this.handler.getCurrentState()
    this.handler.checkProvier('hover', doc.textDocument)
    this.hoverFactory.close()
    await synchronizeDocument(doc)
    let hovers = await this.handler.withRequestToken('hover', token => {
      return languages.getHover(doc.textDocument, position, token)
    }, true)
    if (hovers == null) return false
    let hover = hovers.find(o => Range.is(o.range))
    if (hover?.range) {
      let win = this.nvim.createWindow(winid)
      let ids = await win.highlightRanges('CocHoverRange', [hover.range], 99) as number[]
      setTimeout(() => {
        if (ids.length) win.clearMatches(ids)
        if (workspace.isVim) this.nvim.command('redraw', true)
      }, 500)
    }
    await this.previewHover(hovers, hoverTarget)
    return true
  }

  private async previewHover(hovers: Hover[], target?: string): Promise<void> {
    let docs: Documentation[] = []
    let hoverPreference = workspace.getConfiguration('hover')
    target = target || this.config.target
    let isPreview = target === 'preview'
    for (let hover of hovers) {
      let { contents } = hover
      if (Array.isArray(contents)) {
        for (let item of contents) {
          if (typeof item === 'string') {
            addDocument(docs, item, 'markdown', isPreview)
          } else {
            addDocument(docs, item.value, item.language, isPreview)
          }
        }
      } else if (MarkedString.is(contents)) {
        if (typeof contents == 'string') {
          addDocument(docs, contents, 'markdown', isPreview)
        } else {
          addDocument(docs, contents.value, contents.language, isPreview)
        }
      } else if (MarkupContent.is(contents)) {
        addDocument(docs, contents.value, isMarkdown(contents) ? 'markdown' : 'txt', isPreview)
      }
    }
    if (target == 'float') {
      let opts: FloatWinConfig = { modes: ['n'] }
      opts.maxWidth = hoverPreference.get('floatMaxWidth', 80)
      opts.maxHeight = hoverPreference.get('floatMaxHeight', undefined)
      opts.autoHide = hoverPreference.get('autoHide', true)
      opts.excludeImages = workspace.getConfiguration('coc.preferences').get<boolean>('excludeImageLinksInMarkdownDocument', true)
      await this.hoverFactory.show(docs, opts)
      return
    }
    let lines = docs.reduce((p, c) => {
      let arr = c.content.split(/\r?\n/)
      if (p.length > 0) p.push('')
      p.push(...arr)
      return p
    }, [])
    if (target == 'echo') {
      const msg = lines.join('\n').trim()
      if (msg.length) {
        await this.nvim.call('coc#util#echo_hover', msg)
      }
    } else {
      this.documentLines = lines
      await this.nvim.command(`noswapfile pedit coc://document`)
    }
  }

  /**
   * Get hover text array
   */
  public async getHover(): Promise<string[]> {
    let result: string[] = []
    let { doc, position } = await this.handler.getCurrentState()
    this.handler.checkProvier('hover', doc.textDocument)
    await synchronizeDocument(doc)
    let tokenSource = new CancellationTokenSource()
    let hovers = await languages.getHover(doc.textDocument, position, tokenSource.token)
    if (Array.isArray(hovers)) {
      for (let h of hovers) {
        let { contents } = h
        if (Array.isArray(contents)) {
          contents.forEach(c => {
            result.push(typeof c === 'string' ? c : c.value)
          })
        } else if (MarkupContent.is(contents)) {
          result.push(contents.value)
        } else {
          result.push(typeof contents === 'string' ? contents : contents.value)
        }
      }
    }
    result = result.filter(s => s != null && s.length > 0)
    return result
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
