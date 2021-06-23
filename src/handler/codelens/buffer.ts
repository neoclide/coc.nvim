import { Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { CancellationTokenSource, CodeLens } from 'vscode-languageserver-protocol'
import languages from '../../languages'
import { BufferSyncItem } from '../../types'
import window from '../../window'
import workspace from '../../workspace'
import commandManager from '../../commands'
const logger = require('../../util/logger')('codelens-buffer')

export interface CodeLensInfo {
  codeLenses: CodeLens[]
  version: number
  hasError: boolean
}

export interface CodeLensConfig {
  enabled: boolean
  separator: string
  subseparator: string
}

/**
 * CodeLens buffer
 */
export default class CodeLensBuffer implements BufferSyncItem {
  private _disposed = false
  private _fetching = false
  private codeLenses: CodeLensInfo
  private tokenSource: CancellationTokenSource
  private srcId: number
  public fetchCodelenses: (() => void) & { clear(): void }
  public resolveCodeLens: (() => void) & { clear(): void }
  constructor(
    private nvim: Neovim,
    public readonly bufnr: number,
    private config: CodeLensConfig
  ) {
    this.fetchCodelenses = debounce(() => {
      this._fetchCodeLenses().logError()
    }, global.hasOwnProperty('__TEST__') ? 10 : 100)
    this.resolveCodeLens = debounce(() => {
      this._resolveCodeLenses().logError()
    }, global.hasOwnProperty('__TEST__') ? 10 : 200)
    this.forceFetch().logError()
  }

  public currentCodeLens(): CodeLens[] {
    return this.codeLenses?.codeLenses
  }

  public async forceFetch(): Promise<void> {
    this.fetchCodelenses.clear()
    await this._fetchCodeLenses()
  }

  private get textDocument(): TextDocument | undefined {
    return workspace.getDocument(this.bufnr)?.textDocument
  }

  public get hasProvider(): boolean {
    let { textDocument } = this
    if (!textDocument) return false
    return languages.hasProvider('codeLens', textDocument)
  }

  private async _fetchCodeLenses(): Promise<void> {
    if (!this.config.enabled || !this.hasProvider || this._fetching) return
    let { textDocument } = this
    let version = textDocument.version
    let curr = this.codeLenses || {} as any
    if (curr.codeLenses && !curr.hasError && version == this.codeLenses.version) {
      let res = await this._resolveCodeLenses(true)
      if (!res) this.clear()
      return
    }
    this.cancel()
    let tokenSource = this.tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    this._fetching = true
    let codeLenses = await languages.getCodeLens(textDocument, token)
    this._fetching = false
    this.tokenSource = undefined
    if (token.isCancellationRequested) return
    this.resolveCodeLens.clear()
    if (Array.isArray(codeLenses)) {
      let hasError = codeLenses.some(o => o == null)
      this.codeLenses = { version, codeLenses: codeLenses.filter(o => o != null), hasError }
      let res = await this._resolveCodeLenses(true)
      if (!res) this.clear()
    }
  }

  private async _resolveCodeLenses(clear = false): Promise<boolean> {
    if (!this.config.enabled || !this.codeLenses || this._disposed) return false
    let { codeLenses, version } = this.codeLenses
    let [bufnr, start, end] = await this.nvim.eval(`[bufnr('%'),line('w0'),line('w$')]`) as [number, number, number]
    // text changed
    if (!this.textDocument || this.textDocument.version != version) return false
    // only resolve current buffer
    if (bufnr != this.bufnr) return false
    codeLenses = codeLenses.filter(o => {
      let lnum = o.range.start.line + 1
      return lnum >= start && lnum <= end
    })
    if (!clear) codeLenses = codeLenses.filter(o => o.command == null)
    if (!codeLenses.length) return false
    let tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    let timer = setTimeout(() => {
      tokenSource.cancel()
    }, 1000)
    await Promise.all(codeLenses.map(codeLens => languages.resolveCodeLens(codeLens, token)))
    clearTimeout(timer)
    this.tokenSource = undefined
    if (token.isCancellationRequested || this._disposed) return false
    this.srcId = await this.nvim.createNamespace('coc-codelens')
    this.nvim.pauseNotification()
    if (clear) this.clear()
    this.setVirtualText(codeLenses)
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    let res = await this.nvim.resumeNotification()
    if (Array.isArray(res) && res[1] != null) {
      logger.error(`Error on resolve codeLens`, res[1][2])
      return false
    }
    return true
  }

  /**
   * Attach resolved codeLens
   */
  private setVirtualText(codeLenses: CodeLens[]): void {
    if (codeLenses.length == 0) return
    let list: Map<number, CodeLens[]> = new Map()
    for (let codeLens of codeLenses) {
      let { range, command } = codeLens
      if (!command) continue
      let { line } = range.start
      if (list.has(line)) {
        list.get(line).push(codeLens)
      } else {
        list.set(line, [codeLens])
      }
    }
    for (let lnum of list.keys()) {
      let codeLenses = list.get(lnum)
      let commands = codeLenses.map(codeLens => codeLens.command)
      commands = commands.filter(c => c && c.title)
      let chunks = []
      let n_commands = commands.length
      for (let i = 0; i < n_commands; i++) {
        let c = commands[i]
        chunks.push([c.title.replace(/(\r\n|\r|\n) */g, " "), 'CocCodeLens'] as [string, string])
        if (i != n_commands - 1) {
          chunks.push([this.config.subseparator, 'CocCodeLens'] as [string, string])
        }
      }
      chunks.unshift([`${this.config.separator} `, 'CocCodeLens'])
      this.nvim.call('nvim_buf_set_virtual_text', [this.bufnr, this.srcId, lnum, chunks, {}], true)
    }
  }

  public clear(): void {
    if (!this.srcId) return
    let buf = this.nvim.createBuffer(this.bufnr)
    buf.clearNamespace(this.srcId)
  }

  public getCodelenses(): CodeLens[] | undefined {
    return this.codeLenses?.codeLenses
  }

  public async doAction(line: number): Promise<void> {
    let { codeLenses } = this.codeLenses ?? {}
    if (!codeLenses || codeLenses.length == 0) {
      window.showMessage('No codeLenses available', 'warning')
      return
    }
    let list: Map<number, CodeLens[]> = new Map()
    for (let codeLens of codeLenses) {
      let { range, command } = codeLens
      if (!command) continue
      let { line } = range.start
      if (list.has(line)) {
        list.get(line).push(codeLens)
      } else {
        list.set(line, [codeLens])
      }
    }
    let current: CodeLens[] = null
    for (let i = line; i >= 0; i--) {
      if (list.has(i)) {
        current = list.get(i)
        break
      }
    }
    if (!current) {
      window.showMessage('No codeLenses available', 'warning')
      return
    }
    let commands = current.map(o => o.command)
    commands = commands.filter(c => c.command != null && c.command != '')
    if (commands.length == 0) {
      window.showMessage('CodeLenses command not found', 'warning')
    } else if (commands.length == 1) {
      commandManager.execute(commands[0])
    } else {
      let res = await window.showMenuPicker(commands.map(c => c.title))
      if (res == -1) return
      commandManager.execute(commands[res])
    }
  }

  private cancel(): void {
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource.dispose()
      this.tokenSource = null
    }
  }

  public onChange(): void {
    if (!this.config.enabled) return
    this.cancel()
    this.resolveCodeLens.clear()
  }

  public dispose(): void {
    this._disposed = true
    this.codeLenses = undefined
    this.cancel()
    this.fetchCodelenses.clear()
    this.resolveCodeLens.clear()
  }
}
