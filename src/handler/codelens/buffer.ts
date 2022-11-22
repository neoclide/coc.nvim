'use strict'
import type { Neovim } from '@chemzqm/neovim'
import { CodeLens, Command } from 'vscode-languageserver-types'
import commandManager from '../../commands'
import languages from '../../languages'
import { createLogger } from '../../logger'
import { SyncItem } from '../../model/bufferSync'
import Document from '../../model/document'
import { DidChangeTextDocumentParams, ProviderName } from '../../types'
import { getConditionValue } from '../../util'
import { isCommand } from '../../util/is'
import { debounce } from '../../util/node'
import { CancellationTokenSource } from '../../util/protocol'
import window from '../../window'
import workspace from '../../workspace'
const logger = createLogger('codelens-buffer')

export interface CodeLensInfo {
  codeLenses: CodeLens[]
  version: number
}

export interface CodeLensConfig {
  position: 'top' | 'eol' | 'right_align'
  enabled: boolean
  separator: string
  subseparator: string
}

export enum TextAlign {
  After = 'after',
  Right = 'right',
  Below = 'below',
  Above = 'above',
}

let srcId: number | undefined
const debounceTme = getConditionValue(200, 50)

/**
 * CodeLens buffer
 */
export default class CodeLensBuffer implements SyncItem {
  private codeLenses: CodeLensInfo | undefined
  private tokenSource: CancellationTokenSource
  private resolveTokenSource: CancellationTokenSource
  private _config: CodeLensConfig | undefined
  public resolveCodeLens: (() => void) & { clear(): void }
  public debounceFetch: (() => void) & { clear(): void }
  constructor(
    private nvim: Neovim,
    public readonly document: Document
  ) {
    this.resolveCodeLens = debounce(() => {
      this._resolveCodeLenses().catch(e => {
        logger.error(`Error on resolve codeLens`, e)
      })
    }, debounceTme)
    this.debounceFetch = debounce(() => {
      this.fetchCodeLenses().catch(e => {
        logger.error(`Error on fetch codeLens`, e)
      })
    }, debounceTme)
    this.debounceFetch()
  }

  public get config(): CodeLensConfig {
    if (this._config) return this._config
    this.loadConfiguration()
    return this._config
  }

  public loadConfiguration(): void {
    let config = workspace.getConfiguration('codeLens', this.document)
    this._config = {
      enabled: config.get<boolean>('enable', false),
      position: config.get<'top' | 'eol' | 'right_align'>('position', 'top'),
      separator: config.get<string>('separator', ''),
      subseparator: config.get<string>('subseparator', ' ')
    }
  }

  public get bufnr(): number {
    return this.document.bufnr
  }

  public onChange(e: DidChangeTextDocumentParams): void {
    if (e.contentChanges.length === 0 && this.codeLenses != null) {
      this.resolveCodeLens.clear()
      this._resolveCodeLenses().catch(e => {
        logger.error(`Error on resolve codeLens`, e)
      })
    } else {
      this.cancel()
      this.debounceFetch()
    }
  }

  public get currentCodeLens(): CodeLens[] | undefined {
    return this.codeLenses?.codeLenses
  }

  public get version(): number | undefined {
    return this.codeLenses?.version
  }

  private get hasProvider(): boolean {
    return languages.hasProvider(ProviderName.CodeLens, this.document)
  }

  public async forceFetch(): Promise<void> {
    if (!this.config.enabled || !this.hasProvider) return
    await this.document.synchronize()
    this.cancel()
    await this.fetchCodeLenses()
  }

  private async fetchCodeLenses(): Promise<void> {
    if (!this.hasProvider || !this.config.enabled) return
    let noFetch = this.codeLenses?.version == this.document.version
    if (!noFetch) {
      let { textDocument } = this.document
      let version = textDocument.version
      let tokenSource = this.tokenSource = new CancellationTokenSource()
      let token = tokenSource.token
      if (token.isCancellationRequested) return
      let codeLenses = await languages.getCodeLens(textDocument, token)
      codeLenses = Array.isArray(codeLenses) ? codeLenses.filter(o => o != null) : []
      this.tokenSource = undefined
      if (token.isCancellationRequested || codeLenses.length == 0) return
      this.codeLenses = { version, codeLenses }
    }
    this.resolveCodeLens.clear()
    await this._resolveCodeLenses()
  }

  /**
   * Resolve visible codeLens
   */
  private async _resolveCodeLenses(): Promise<void> {
    if (!this.codeLenses || this.isChanged) return
    let { codeLenses } = this.codeLenses
    let [bufnr, start, end, total] = await this.nvim.eval(`[bufnr('%'),line('w0'),line('w$'),line('$')]`) as [number, number, number, number]
    if (!srcId) srcId = await this.nvim.createNamespace('coc-codelens')
    // only resolve current buffer
    if (this.isChanged || bufnr != this.bufnr) return
    if (this.resolveTokenSource) this.resolveTokenSource.cancel()
    codeLenses = codeLenses.filter(o => {
      let lnum = o.range.start.line + 1
      return lnum >= start && lnum <= end
    })
    if (codeLenses.length) {
      let tokenSource = this.resolveTokenSource = new CancellationTokenSource()
      let token = tokenSource.token
      await Promise.all(codeLenses.map(codeLens => {
        if (isCommand(codeLens.command)) return Promise.resolve()
        return languages.resolveCodeLens(codeLens, token)
      }))
      this.resolveTokenSource = undefined
      if (token.isCancellationRequested || this.isChanged) return
    }
    // nvim could have extmarks exceeded last line.
    if (end == total) end = -1
    this.nvim.pauseNotification()
    this.clear(start - 1, end)
    this.setVirtualText(codeLenses)
    this.nvim.resumeNotification(true, true)
  }

  private get isChanged(): boolean {
    if (!this.codeLenses || this.document.dirty) return true
    let { version } = this.codeLenses
    return this.document.textDocument.version !== version
  }

  /**
   * Attach resolved codeLens
   */
  private setVirtualText(codeLenses: CodeLens[]): void {
    let { document } = this
    if (!srcId || !document || !codeLenses.length) return
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
      let chunks: [string, string][] = []
      let n_commands = commands.length
      for (let i = 0; i < n_commands; i++) {
        let c = commands[i]
        chunks.push([c.title.replace(/\s+/g, " "), 'CocCodeLens'] as [string, string])
        if (i != n_commands - 1) {
          chunks.push([this.config.subseparator, 'CocCodeLens'] as [string, string])
        }
      }
      if (this.config.separator) {
        chunks.unshift([`${this.config.separator} `, 'CocCodeLens'])
      }
      document.buffer.setVirtualText(srcId, lnum, chunks, {
        text_align: getTextAlign(this.config.position),
        indent: true
      })
    }
  }

  public clear(start = 0, end = -1): void {
    if (!srcId) return
    let buf = this.nvim.createBuffer(this.bufnr)
    buf.clearNamespace(srcId, start, end)
  }

  public async doAction(line: number): Promise<void> {
    let commands = getCommands(line, this.codeLenses?.codeLenses)
    if (commands.length == 1) {
      await commandManager.execute(commands[0])
    } else if (commands.length > 1) {
      let res = await window.showMenuPicker(commands.map(c => c.title))
      if (res != -1) await commandManager.execute(commands[res])
    }
  }

  private cancel(): void {
    this.resolveCodeLens.clear()
    this.debounceFetch.clear()
    if (this.resolveTokenSource) {
      this.resolveTokenSource.cancel()
      this.resolveTokenSource = null
    }
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = null
    }
  }

  public abandonResult(): void {
    this.codeLenses = undefined
  }

  public dispose(): void {
    this.cancel()
    this.codeLenses = undefined
  }
}

export function getTextAlign(position: 'top' | 'eol' | 'right_align'): TextAlign {
  if (position == 'top') return TextAlign.Above
  if (position == 'eol') return TextAlign.After
  if (position === 'right_align') return TextAlign.Right
  return TextAlign.Above
}

export function getCommands(line: number, codeLenses: CodeLens[] | undefined): Command[] {
  if (!codeLenses?.length) return []
  let commands: Command[] = []
  for (let codeLens of codeLenses) {
    let { range, command } = codeLens
    if (!isCommand(command)) continue
    if (line == range.start.line) {
      commands.push(command)
    }
  }
  return commands
}
