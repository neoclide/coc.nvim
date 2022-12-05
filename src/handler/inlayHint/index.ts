'use strict'
import { Neovim } from '@chemzqm/neovim'
import commands from '../../commands'
import events from '../../events'
import languages, { ProviderName } from '../../languages'
import BufferSync from '../../model/bufferSync'
import { disposeAll } from '../../util'
import { Disposable } from '../../util/protocol'
import window from '../../window'
import workspace from '../../workspace'
import { HandlerDelegate } from '../types'
import InlayHintBuffer from './buffer'

export default class InlayHintHandler {
  private buffers: BufferSync<InlayHintBuffer> | undefined
  private disposables: Disposable[] = []
  constructor(nvim: Neovim, handler: HandlerDelegate) {
    this.buffers = workspace.registerBufferSync(doc => {
      if (!workspace.env.virtualText) return
      return new InlayHintBuffer(nvim, doc)
    })
    this.disposables.push(this.buffers)
    workspace.onDidChangeConfiguration(e => {
      for (let item of this.buffers.items) {
        if (e.affectsConfiguration('inlayHint', item.doc)) {
          item.loadConfiguration()
        }
      }
    }, null, this.disposables)
    languages.onDidInlayHintRefresh(async e => {
      for (let item of this.buffers.items) {
        if (workspace.match(e, item.doc.textDocument)) {
          item.clearCache()
          if (languages.hasProvider(ProviderName.InlayHint, item.doc.textDocument)) {
            item.render()
          } else {
            item.clearVirtualText()
          }
        }
      }
    }, null, this.disposables)
    events.on('InsertLeave', bufnr => {
      let item = this.buffers.getItem(bufnr)
      if (item) item.onInsertLeave()
    }, null, this.disposables)
    events.on('InsertEnter', bufnr => {
      let item = this.buffers.getItem(bufnr)
      if (item) item.onInsertEnter()
    }, null, this.disposables)
    events.on('CursorMoved', bufnr => {
      this.refresh(bufnr)
    }, null, this.disposables)
    events.on('WinScrolled', async winid => {
      let bufnr = await nvim.call('winbufnr', [winid]) as number
      if (bufnr != -1) this.refresh(bufnr)
    }, null, this.disposables)
    commands.register({
      id: 'document.toggleInlayHint',
      execute: (bufnr?: number) => {
        return this.toggle(bufnr ?? workspace.bufnr)
      },
    }, false, 'toggle codeLens display of current buffer')
    handler.addDisposable(Disposable.create(() => {
      disposeAll(this.disposables)
    }))
  }

  public toggle(bufnr: number): void {
    let item = this.getItem(bufnr)
    try {
      workspace.getAttachedDocument(bufnr)
      item.toggle()
    } catch (e) {
      void window.showErrorMessage((e as Error).message)
    }
  }

  public getItem(bufnr: number): InlayHintBuffer {
    return this.buffers.getItem(bufnr)
  }

  public refresh(bufnr: number): void {
    let buf = this.buffers.getItem(bufnr)
    if (buf) buf.render()
  }
}
