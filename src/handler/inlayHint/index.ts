'use strict'
import { Neovim } from '@chemzqm/neovim'
import events from '../../events'
import languages from '../../languages'
import commands from '../../commands'
import BufferSync from '../../model/bufferSync'
import { HandlerDelegate } from '../../types'
import workspace from '../../workspace'
import InlayHintBuffer, { InlayHintConfig } from './buffer'
import window from '../../window'

export default class InlayHintHandler {
  private buffers: BufferSync<InlayHintBuffer> | undefined
  constructor(nvim: Neovim, handler: HandlerDelegate) {
    this.buffers = workspace.registerBufferSync(doc => {
      if (!workspace.env.virtualText) return
      let config = this.getConfig(doc.uri)
      return new InlayHintBuffer(nvim, doc, config, nvim.isVim)
    })
    handler.addDisposable(this.buffers)
    handler.addDisposable(languages.onDidInlayHintRefresh(async e => {
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
    }))
    handler.addDisposable(events.on('CursorMoved', bufnr => {
      this.refresh(bufnr)
    }))
    handler.addDisposable(events.on('WinScrolled', async winid => {
      let bufnr = await nvim.call('winbufnr', [winid])
      if (bufnr != -1) this.refresh(bufnr)
    }))
    handler.addDisposable(commands.registerCommand('document.toggleInlayHint', (bufnr?: number) => {
      this.toggle(bufnr ?? workspace.bufnr)
    }))
  }

  public toggle(bufnr: number): void {
    let item = this.getItem(bufnr)
    if (item) {
      try {
        item.toggle()
      } catch (e) {
        void window.showErrorMessage((e as Error).message)
      }
    }
  }

  private getConfig(uri: string): InlayHintConfig {
    let config = workspace.getConfiguration('inlayHint', uri)
    return {
      filetypes: config.get<string[]>('filetypes', []),
      refreshOnInsertMode: config.get<boolean>('refreshOnInsertMode'),
      enableParameter: config.get<boolean>('enableParameter', false),
      typeSeparator: config.get<string>('typeSeparator', ''),
      parameterSeparator: config.get<string>('parameterSeparator', ''),
      subSeparator: config.get<string>('subSeparator', ' ')
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
