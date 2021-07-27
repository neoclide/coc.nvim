import { NeovimClient as Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import events from '../../events'
import BufferSync from '../../model/bufferSync'
import { ConfigurationChangeEvent } from '../../types'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import CodeLensBuffer, { CodeLensConfig } from './buffer'
const logger = require('../../util/logger')('codelens')

/**
 * Show codeLens of document, works on neovim only.
 */
export default class CodeLensManager {
  private config: CodeLensConfig
  private disposables: Disposable[] = []
  public buffers: BufferSync<CodeLensBuffer>
  constructor(private nvim: Neovim) {
    this.setConfiguration()
    // need neovim to work
    if (!workspace.isNvim) return
    workspace.onDidChangeConfiguration(e => {
      this.setConfiguration(e)
    })
    this.buffers = workspace.registerBufferSync(doc => {
      if (doc.buftype != '') return undefined
      return new CodeLensBuffer(nvim, doc.bufnr, this.config)
    })
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

  private setConfiguration(e?: ConfigurationChangeEvent): void {
    if (e && !e.affectsConfiguration('codeLens')) return
    let config = workspace.getConfiguration('codeLens')
    let enable: boolean = this.nvim.hasFunction('nvim_buf_set_virtual_text') && config.get<boolean>('enable', false)
    if (e && enable != this.config.enabled) {
      if (enable) {
        this.listen()
      } else {
        disposeAll(this.disposables)
      }
      for (let buf of this.buffers.items) {
        if (enable) {
          buf.fetchCodelenses()
        } else {
          buf.cleanUp()
        }
      }
    }
    this.config = Object.assign(this.config || {}, {
      enabled: enable,
      separator: config.get<string>('separator', '‣'),
      subseparator: config.get<string>('subseparator', ' ')
    })
  }

  public async doAction(): Promise<void> {
    let [bufnr, line] = await this.nvim.eval(`[bufnr("%"),line(".")-1]`) as [number, number]
    let buf = this.buffers.getItem(bufnr)
    await buf?.doAction(line)
  }

  public dispose(): void {
    this.buffers.dispose()
    disposeAll(this.disposables)
  }
}
