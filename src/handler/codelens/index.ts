import { NeovimClient as Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import events from '../../events'
import BufferSync from '../../model/bufferSync'
import services from '../../services'
import { ConfigurationChangeEvent } from '../../types'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import CodeLensBuffer, { CodeLensConfig } from './buffer'
const logger = require('../../util/logger')('codelens')

/**
 * Show codeLens of document, works on neovim only.
 */
export default class CodeLensManager {
  public srcId: number
  private config: CodeLensConfig
  private disposables: Disposable[] = []
  public buffers: BufferSync<CodeLensBuffer>
  constructor(private nvim: Neovim) {
    this.init().logError()
  }

  private async init(): Promise<void> {
    let { nvim } = this
    this.srcId = await nvim.createNamespace('coc-codelens')
    this.setConfiguration()
    workspace.onDidChangeConfiguration(e => {
      this.setConfiguration(e)
    }, null, this.disposables)
    this.buffers = workspace.registerBufferSync(doc => {
      if (doc.buftype != '') return undefined
      return new CodeLensBuffer(nvim, doc.bufnr, this.srcId, this.config)
    })
    services.on('ready', () => {
      this.checkProvider()
    })
    let resolveCodeLens = bufnr => {
      let buf = this.buffers.getItem(bufnr)
      if (buf) buf.resolveCodeLens()
    }
    events.on('CursorMoved', resolveCodeLens, null, this.disposables)
    events.on('BufEnter', resolveCodeLens, null, this.disposables)
    this.checkProvider()
  }

  /**
   * Check provider for buf that not fetched
   */
  public checkProvider(): void {
    for (let buf of this.buffers.items) {
      if (buf.hasProvider) {
        buf.fetchCodelenses()
      }
    }
  }

  private setConfiguration(e?: ConfigurationChangeEvent): void {
    if (e && !e.affectsConfiguration('codeLens')) return
    let config = workspace.getConfiguration('codeLens')
    let enable: boolean = this.nvim.hasFunction('nvim_buf_set_virtual_text') && config.get<boolean>('enable', false)
    if (e && enable != this.config.enabled) {
      for (let buf of this.buffers.items) {
        if (enable) {
          buf.fetchCodelenses()
        } else {
          buf.clear()
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
    let { nvim } = this
    let bufnr = await nvim.call('bufnr', '%')
    let line = (await nvim.call('line', '.') as number) - 1
    let buf = this.buffers.getItem(bufnr)
    await buf?.doAction(line)
  }

  public dispose(): void {
    this.buffers.dispose()
    disposeAll(this.disposables)
  }
}
