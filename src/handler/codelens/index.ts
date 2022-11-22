'use strict'
import { NeovimClient as Neovim } from '@chemzqm/neovim'
import type { DocumentSelector } from 'vscode-languageserver-protocol'
import { debounce } from '../..//util/node'
import events from '../../events'
import languages from '../../languages'
import BufferSync from '../../model/bufferSync'
import { disposeAll, getConditionValue } from '../../util'
import { Disposable } from '../../util/protocol'
import workspace from '../../workspace'
import CodeLensBuffer from './buffer'

const debounceTime = getConditionValue(200, 0)
/**
 * Show codeLens of document
 */
export default class CodeLensManager {
  private disposables: Disposable[] = []
  public buffers: BufferSync<CodeLensBuffer>
  constructor(private nvim: Neovim) {
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('codeLens')) {
        for (let item of this.buffers.items) {
          item.loadConfiguration()
        }
      }
    }, this, this.disposables)
    this.buffers = workspace.registerBufferSync(doc => {
      if (doc.buftype != '') return undefined
      return new CodeLensBuffer(nvim, doc)
    })
    this.disposables.push(this.buffers)
    events.on('CursorMoved', bufnr => {
      let buf = this.buffers.getItem(bufnr)
      if (buf) buf.resolveCodeLens()
    }, null, this.disposables)
    let debounced = debounce(async (selector: DocumentSelector) => {
      for (let item of this.buffers.items) {
        if (!workspace.match(selector, item.document)) continue
        item.abandonResult()
        await item.forceFetch()
      }
    }, debounceTime)
    this.disposables.push(Disposable.create(() => {
      debounced.clear()
    }))
    languages.onDidCodeLensRefresh(debounced, null, this.disposables)
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
    if (buf) await buf.doAction(line)
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }
}
