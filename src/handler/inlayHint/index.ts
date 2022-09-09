'use strict'
import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import commands from '../../commands'
import events from '../../events'
import languages from '../../languages'
import BufferSync from '../../model/bufferSync'
import { HandlerDelegate } from '../../types'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import InlayHintBuffer from './buffer'
const logger = require('../../util/logger')('inlayHint-index')

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
          if (languages.hasProvider('inlayHint', item.doc.textDocument)) {
            item.render()
          } else {
            item.clearVirtualText()
          }
        }
      }
    }, null, this.disposables)
    events.on('InsertLeave', async bufnr => {
      let item = this.buffers.getItem(bufnr)
      if (item) await item.onInsertLeave()
    }, null, this.disposables)
    events.on('InsertEnter', bufnr => {
      let item = this.buffers.getItem(bufnr)
      if (item) item.onInsertEnter()
    }, null, this.disposables)
    events.on('CursorMoved', bufnr => {
      this.refresh(bufnr)
    }, null, this.disposables)
    events.on('WinScrolled', async winid => {
      let bufnr = await nvim.call('winbufnr', [winid])
      if (bufnr != -1) this.refresh(bufnr)
    }, null, this.disposables)
    this.disposables.push(commands.registerCommand('document.toggleInlayHint', (bufnr?: number) => {
      this.toggle(bufnr ?? workspace.bufnr)
    }))
    handler.addDisposable(Disposable.create(() => {
      disposeAll(this.disposables)
    }))
  }

  public toggle(bufnr: number): void {
    let item = this.getItem(bufnr)
    try {
      if (!workspace.env.virtualText) throw new Error(`virtual text requires nvim >= 0.5.0 or vim >= 9.0.0067, please upgrade your vim.`)
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
