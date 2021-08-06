import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import { CancellationTokenSource, Disposable, Hover, MarkedString, MarkupContent, Range } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import languages from '../languages'
import { Documentation } from '../markdown'
import FloatFactory, { FloatWinConfig } from '../model/floatFactory'
import { TextDocumentContentProvider } from '../provider'
import { ConfigurationChangeEvent, HandlerDelegate } from '../types'
import { disposeAll, isMarkdown } from '../util'
import { readFileLines } from '../util/fs'
import workspace from '../workspace'
const logger = require('../util/logger')('handler-hover')

export type HoverTarget = 'float' | 'preview' | 'echo'

interface HoverConfig {
  target: HoverTarget
  previewMaxHeight: number
  floatMaxWidth: number
  floatMaxHeight: number | undefined
  autoHide: boolean
}

export default class HoverHandler {
  private hoverFactory: FloatFactory
  private disposables: Disposable[] = []
  private documentLines: string[] = []
  private config: HoverConfig
  private timer: NodeJS.Timeout
  private hasProvider = false
  private excludeImages = true
  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this.loadConfiguration()
    workspace.onDidChangeConfiguration(this.loadConfiguration, this, this.disposables)
    this.hoverFactory = new FloatFactory(nvim)
    this.disposables.push(this.hoverFactory)
  }

  private registerProvider(): void {
    if (this.hasProvider) return
    this.hasProvider = true
    let { nvim } = this
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
      let target = config.get<HoverTarget>('target', 'float')
      this.config = {
        autoHide: config.get('autoHide', true),
        floatMaxHeight: config.get('floatMaxHeight', undefined),
        floatMaxWidth: config.get('floatMaxWidth', 80),
        target: target == 'float' && !workspace.floatSupported ? 'preview' : target,
        previewMaxHeight: config.get<number>('previewMaxHeight', 12)
      }
      if (this.config.target == 'preview') {
        this.registerProvider()
      }
      let preferences = workspace.getConfiguration('coc.preferences')
      this.excludeImages = preferences.get<boolean>('excludeImageLinksInMarkdownDocument', true)
    }
  }

  public async onHover(hoverTarget?: HoverTarget): Promise<boolean> {
    let { doc, position, winid } = await this.handler.getCurrentState()
    if (hoverTarget == 'preview') this.registerProvider()
    this.handler.checkProvier('hover', doc.textDocument)
    await doc.synchronize()
    let hovers = await this.handler.withRequestToken('hover', token => {
      return languages.getHover(doc.textDocument, position, token)
    }, true)
    if (hovers == null || !hovers.length) return false
    let hover = hovers.find(o => Range.is(o.range))
    if (hover?.range) {
      let win = this.nvim.createWindow(winid)
      win.highlightRanges('CocHoverRange', [hover.range], 99, true)
      this.timer = setTimeout(() => {
        win.clearMatchGroup('CocHoverRange')
        if (workspace.isVim) this.nvim.command('redraw', true)
      }, 500)
    }
    await this.previewHover(hovers, hoverTarget)
    return true
  }

  public async definitionHover(hoverTarget: HoverTarget): Promise<boolean> {
    const { doc, position } = await this.handler.getCurrentState()
    if (hoverTarget == 'preview') this.registerProvider()
    this.handler.checkProvier('hover', doc.textDocument)
    await doc.synchronize()
    const hovers: (Hover | Documentation)[] = await this.handler.withRequestToken('hover', token => {
      return languages.getHover(doc.textDocument, position, token)
    }, true)
    if (!hovers?.length) return false
    const defs = await this.handler.withRequestToken('definitionHover', token => {
      return languages.getDefinitionLinks(doc.textDocument, position, token)
    }, true)
    if (defs?.length) {
      for (const def of defs) {
        if (!def.targetRange) continue
        const { start, end } = def.targetRange
        const endLine = end.line - start.line >= 8 ? start.line + 8 : (end.character == 0 ? end.line - 1 : end.line)
        const lines = await readLines(def.targetUri, start.line, endLine)
        hovers.push({ content: lines.join('\n'), filetype: doc.filetype })
      }
    }
    await this.previewHover(hovers, hoverTarget)
    return true
  }

  private async previewHover(hovers: (Hover | Documentation)[], target?: string): Promise<void> {
    let docs: Documentation[] = []
    target = target || this.config.target
    let isPreview = target === 'preview'
    for (let hover of hovers) {
      if (isDocumentation(hover)) {
        docs.push(hover)
        continue
      }
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
      let opts: FloatWinConfig = {
        modes: ['n'],
        maxWidth: this.config.floatMaxWidth,
        maxHeight: this.config.floatMaxHeight,
        autoHide: this.config.autoHide,
        excludeImages: this.excludeImages
      }
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
      await this.nvim.call('coc#util#echo_hover', [msg])
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
    await doc.synchronize()
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
    if (this.timer) clearTimeout(this.timer)
    disposeAll(this.disposables)
  }
}

function addDocument(docs: Documentation[], text: string, filetype: string, isPreview = false): void {
  let content = text.trim()
  if (!content.length)
    return
  if (isPreview && filetype !== 'markdown') {
    content = '``` ' + filetype + '\n' + content + '\n```'
  }
  docs.push({ content, filetype })
}

function isDocumentation(obj: any): obj is Documentation {
  if (!obj) return false
  return typeof obj.filetype === 'string' && typeof obj.content === 'string'
}

async function readLines(uri: string, start: number, end: number): Promise<string[]> {
  let doc = workspace.getDocument(uri)
  if (doc) return doc.getLines(start, end + 1)
  let fsPath = URI.parse(uri).fsPath
  if (!fs.existsSync(fsPath)) return []
  return await readFileLines(fsPath, start, end)
}
