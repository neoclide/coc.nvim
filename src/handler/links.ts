'use strict'
import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { DocumentLink, Range } from 'vscode-languageserver-types'
import { IConfigurationChangeEvent } from '../configuration/types'
import events from '../events'
import languages, { ProviderName } from '../languages'
import BufferSync, { SyncItem } from '../model/bufferSync'
import Document from '../model/document'
import { DidChangeTextDocumentParams, Documentation, FloatFactory, HighlightItem } from '../types'
import { disposeAll, getConditionValue } from '../util'
import { isFalsyOrEmpty, toArray } from '../util/array'
import { equals } from '../util/object'
import { positionInRange } from '../util/position'
import { CancellationTokenSource, Disposable } from '../util/protocol'
import window from '../window'
import workspace from '../workspace'
import { HandlerDelegate } from './types'

// const regex = /CocAction(Async)?\(["']openLink["']\)/
let floatFactory: FloatFactory | undefined
const debounceTime = getConditionValue(200, 10)
const NAMESPACE = 'links'
const highlightGroup = 'CocLink'

interface LinkConfig {
  enable: boolean
  highlight: boolean
}

export default class Links implements Disposable {
  private disposables: Disposable[] = []
  private tooltip: boolean
  private tokenSource: CancellationTokenSource
  private buffers: BufferSync<LinkBuffer>
  constructor(private nvim: Neovim, private handler: HandlerDelegate) {
    this.setConfiguration()
    workspace.onDidChangeConfiguration(this.setConfiguration, this, this.disposables)
    events.on('CursorHold', async () => {
      await this.showTooltip()
    }, null, this.disposables)
    events.on(['CursorMoved', 'InsertEnter'], () => {
      this.cancel()
    }, null, this.disposables)
    this.buffers = workspace.registerBufferSync(doc => {
      return new LinkBuffer(doc)
    })
    this.disposables.push(this.buffers)
    languages.onDidLinksRefresh(selector => {
      for (let item of this.buffers.items) {
        if (workspace.match(selector, item.doc)) {
          item.fetchLinks()
        }
      }
    }, null, this.disposables)
  }

  private setConfiguration(e?: IConfigurationChangeEvent): void {
    if (!e || e.affectsConfiguration('links')) {
      this.tooltip = workspace.initialConfiguration.get<boolean>('links.tooltip', false)
      if (e) {
        for (let item of this.buffers.items) {
          item.updateDocumentConfig()
        }
      }
    }
  }

  public async showTooltip(): Promise<void> {
    if (!this.tooltip) return
    let link = await this.getCurrentLink()
    if (!link || !link.target) return
    let text = link.target
    if (link.tooltip) text += ' ' + link.tooltip
    let doc: Documentation = { content: text, filetype: 'txt' }
    if (!floatFactory) floatFactory = window.createFloatFactory({})
    await floatFactory.show([doc])
  }

  public async getLinks(): Promise<ReadonlyArray<DocumentLink>> {
    let { doc } = await this.handler.getCurrentState()
    let buf = this.buffers.getItem(doc.bufnr)
    await buf.getLinks()
    return toArray(buf.links)
  }

  public async getCurrentLink(): Promise<DocumentLink | undefined> {
    let links = await this.getLinks()
    let pos = await window.getCursorPosition()
    if (links && links.length) {
      for (let link of links) {
        if (positionInRange(pos, link.range) == 0) {
          if (!link.target) {
            let tokenSource = this.tokenSource = this.tokenSource || new CancellationTokenSource()
            link = await languages.resolveDocumentLink(link, this.tokenSource.token)
            this.tokenSource = undefined
            if (!link.target || tokenSource.token.isCancellationRequested) continue
          }
          return link
        }
      }
    }
    let line = await this.nvim.call('getline', ['.']) as string
    let regex = /\w+?:\/\/[^)\]'" ]+/g
    let arr
    let link: DocumentLink | undefined
    while ((arr = regex.exec(line)) !== null) {
      let start = arr.index
      if (start <= pos.character && start + arr[0].length >= pos.character) {
        link = DocumentLink.create(Range.create(pos.line, start, pos.line, start + arr[0].length), arr[0])
        break
      }
    }
    return link
  }

  public async openCurrentLink(): Promise<boolean> {
    let link = await this.getCurrentLink()
    if (link) {
      await this.openLink(link)
      return true
    }
    return false
  }

  public async openLink(link: DocumentLink): Promise<void> {
    if (!link.target) throw new Error(`Failed to resolve link target`)
    await workspace.openResource(link.target)
  }

  public getBuffer(bufnr: number): LinkBuffer | undefined {
    return this.buffers.getItem(bufnr)
  }

  private cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = null
    }
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}

class LinkBuffer implements SyncItem {
  private tokenSource: CancellationTokenSource | undefined
  private _config: LinkConfig | undefined
  public links: DocumentLink[] = []
  public fetchLinks: Function & { clear(): void }
  // last highlight version
  constructor(public readonly doc: Document) {
    this.fetchLinks = debounce(() => {
      void this.getLinks()
    }, debounceTime)
    if (this.hasProvider) this.fetchLinks()
  }

  public get config(): LinkConfig {
    if (this._config) return this._config
    this.updateDocumentConfig()
    return this._config
  }

  private get hasProvider(): boolean {
    return languages.hasProvider(ProviderName.DocumentLink, this.doc)
  }

  public updateDocumentConfig(): void {
    let configuration = workspace.getConfiguration('links', this.doc)
    this._config = {
      enable: configuration.get('enable', true),
      highlight: configuration.get('highlight', false),
    }
  }

  public onChange(e: DidChangeTextDocumentParams): void {
    if (e.contentChanges.length == 0) {
      this.highlight()
    } else {
      this.cancel()
      this.fetchLinks()
    }
  }

  public highlight(): void {
    if (!this.config.highlight || !this.links) return
    let { links, doc } = this
    if (isFalsyOrEmpty(links)) {
      this.clearHighlight()
    } else {
      let highlights: HighlightItem[] = []
      links.forEach(link => {
        doc.addHighlights(highlights, highlightGroup, link.range)
      })
      this.doc.buffer.updateHighlights(NAMESPACE, highlights, { priority: 2048 })
    }
  }

  public clearHighlight(): void {
    this.buffer.clearNamespace(NAMESPACE)
  }

  public get buffer(): Buffer {
    return this.doc.buffer
  }

  public cancel(): void {
    this.fetchLinks.clear()
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = null
    }
  }

  public async getLinks(): Promise<void> {
    if (!this.hasProvider || !this.config.enable) return
    this.cancel()
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    let links = await languages.getDocumentLinks(this.doc.textDocument, token)
    this.tokenSource = undefined
    if (token.isCancellationRequested || sameLinks(toArray(this.links), toArray(links))) return
    this.links = toArray(links)
    this.highlight()
  }

  public dispose(): void {
    this.cancel()
  }
}

export function sameLinks(links: ReadonlyArray<DocumentLink>, other: ReadonlyArray<DocumentLink>): boolean {
  if (links.length != other.length) return false
  for (let i = 0; i < links.length; i++) {
    if (!equals(links[i].range, other[i].range)) {
      return false
    }
  }
  return true
}
