'use strict'
import { NeovimClient as Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import events from '../../events'
import BufferSync from '../../model/bufferSync'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import CodeLensBuffer from './buffer'
const logger = require('../../util/logger')('codelens')

/**
 * Show codeLens of document, works on neovim only.
 */
export default class CodeLensManager {
  private disposables: Disposable[] = []
  public buffers: BufferSync<CodeLensBuffer>
  constructor(private nvim: Neovim) {
    workspace.onDidChangeConfiguration(e => {
      for (let item of this.buffers.items) {
        if (e.affectsConfiguration('codeLens', item.document)) {
          item.loadConfiguration()
        }
      }
    }, this, this.disposables)
    this.buffers = workspace.registerBufferSync(doc => {
      if (doc.buftype != '') return undefined
      return new CodeLensBuffer(nvim, doc)
    })
    this.disposables.push(this.buffers)
    this.listen()
  }

  private listen(): void {
    events.on('CursorMoved', bufnr => {
      let buf = this.buffers.getItem(bufnr)
      if (buf) buf.resolveCodeLens()
    }, null, this.disposables)
    // Refresh on CursorHold
    events.on('CursorHold', async bufnr => {
      let buf = this.buffers.getItem(bufnr)
      if (buf) await buf.forceFetch()
    }, this, this.disposables)
  }

  /**
   * Check provider for buf that not fetched
   */
  public async checkProvider(): Promise<void> {
    for (let buf of this.buffers.items) {
      await buf.forceFetch()
    }
  }

  public async doAction(): Promise<void> {
    let [bufnr, line] = await this.nvim.eval(`[bufnr("%"),line(".")-1]`) as [number, number]
    let buf = this.buffers.getItem(bufnr)
    await buf?.doAction(line)
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
