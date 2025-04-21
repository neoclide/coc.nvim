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

export type StateMethods = 'enable' | 'disable' | 'toggle'

export default class InlayHintHandler {
  private buffers: BufferSync<InlayHintBuffer> | undefined
  private disposables: Disposable[] = []
  constructor(nvim: Neovim, handler: HandlerDelegate) {
    this.buffers = workspace.registerBufferSync(doc => {
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
            await item.render()
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
    commands.register({
      id: 'document.toggleInlayHint',
      execute: (bufnr?: number) => {
        this.setState('toggle', bufnr)
      },
    }, false, 'Toggle inlayHint display of current buffer')
    commands.register({
      id: 'document.enableInlayHint',
      execute: (bufnr?: number) => {
        this.setState('enable', bufnr)
      },
    }, false, 'Enable inlayHint display of current buffer')
    commands.register({
      id: 'document.disableInlayHint',
      execute: (bufnr?: number) => {
        this.setState('disable', bufnr)
      },
    }, false, 'Disable inlayHint display of current buffer')
    handler.addDisposable(Disposable.create(() => {
      disposeAll(this.disposables)
    }))
  }

  public setState(method: StateMethods, bufnr?: number): void {
    try {
      bufnr = bufnr ?? workspace.bufnr
      workspace.getAttachedDocument(bufnr)
      let item = this.getItem(bufnr)
      item[method]()
    } catch (e) {
      void window.showErrorMessage((e as Error).message)
    }
  }

  public getItem(bufnr: number): InlayHintBuffer {
    return this.buffers.getItem(bufnr)
  }
}
