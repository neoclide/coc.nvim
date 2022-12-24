'use strict'
import type { Neovim } from '@chemzqm/neovim'
import { CodeLens, Command } from 'vscode-languageserver-types'
import commandManager from '../../commands'
import languages, { ProviderName } from '../../languages'
import { createLogger } from '../../logger'
import { SyncItem } from '../../model/bufferSync'
import Document from '../../model/document'
import { DidChangeTextDocumentParams } from '../../types'
import { defaultValue, getConditionValue } from '../../util'
import { isFalsyOrEmpty } from '../../util/array'
import { isCommand } from '../../util/is'
import { debounce } from '../../util/node'
import { CancellationTokenSource } from '../../util/protocol'
import window from '../../window'
import workspace from '../../workspace'
import { handleError } from '../util'
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
const debounceTime = getConditionValue(200, 20)
const CODELENS_HL = 'CocCodeLens'
const NORMAL_HL = 'Normal'

/**
 * CodeLens buffer
 */
export default class CodeLensBuffer implements SyncItem {
  private codeLenses: CodeLensInfo | undefined
  private tokenSource: CancellationTokenSource
  private resolveTokenSource: CancellationTokenSource
  private _config: CodeLensConfig | undefined
  private display = true
  public resolveCodeLens: (() => void) & { clear(): void }
  public debounceFetch: (() => void) & { clear(): void }
  constructor(
    private nvim: Neovim,
    public readonly document: Document
  ) {
    this.resolveCodeLens = debounce(() => {
      this._resolveCodeLenses().catch(handleError)
    }, debounceTime)
    this.debounceFetch = debounce(() => {
      this.fetchCodeLenses().catch(handleError)
    }, debounceTime)
    if (this.hasProvider) this.debounceFetch()
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

  public async toggleDisplay(): Promise<void> {
    if (this.display) {
      this.display = false
      this.clear()
    } else {
      this.display = true
      this.resolveCodeLens.clear()
      await this._resolveCodeLenses()
    }
  }

  public get bufnr(): number {
    return this.document.bufnr
  }

  public onChange(e: DidChangeTextDocumentParams): void {
    if (e.contentChanges.length === 0 && this.codeLenses != null) {
      this.resolveCodeLens.clear()
      this._resolveCodeLenses().catch(handleError)
    } else {
      this.cancel()
      this.debounceFetch()
    }
  }

  public get currentCodeLens(): CodeLens[] | undefined {
    return this.codeLenses?.codeLenses
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

  public async fetchCodeLenses(): Promise<void> {
    if (!this.hasProvider || !this.config.enabled) return
    let noFetch = this.codeLenses?.version == this.document.version
    if (!noFetch) {
      let empty = this.codeLenses == null
      let { textDocument } = this.document
      let version = textDocument.version
      this.cancelFetch()
      let tokenSource = this.tokenSource = new CancellationTokenSource()
      let token = tokenSource.token
      if (!srcId) srcId = await this.nvim.createNamespace('coc-codelens')
      let codeLenses = await languages.getCodeLens(textDocument, token)
      if (token.isCancellationRequested) return
      codeLenses = defaultValue(codeLenses, [])
      codeLenses = codeLenses.filter(o => o != null)
      if (isFalsyOrEmpty(codeLenses)) {
        this.clear()
        return
      }
      this.codeLenses = { version, codeLenses }
      if (empty) this.setVirtualText(codeLenses)
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
    // only resolve current buffer
    if (this.isChanged || bufnr != this.bufnr) return
    this.cancel()
    codeLenses = codeLenses.filter(o => {
      let lnum = o.range.start.line + 1
      return lnum >= start && lnum <= end
    })
    if (codeLenses.length) {
      let tokenSource = this.resolveTokenSource = new CancellationTokenSource()
      let token = tokenSource.token
      await Promise.all(codeLenses.map(codeLens => {
        if (isCommand(codeLens.command)) return Promise.resolve()
        codeLens.command = undefined
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
    if (!srcId || !document || !codeLenses.length || !this.display) return
    let top = this.config.position === 'top'
    let list: Map<number, CodeLens[]> = new Map()
    for (let codeLens of codeLenses) {
      let { line } = codeLens.range.start
      let curr = list.get(line) ?? []
      curr.push(codeLens)
      list.set(line, curr)
    }
    for (let lnum of list.keys()) {
      let codeLenses = list.get(lnum)
      let commands = codeLenses.reduce((p, c) => {
        if (c && c.command && c.command.title) p.push(c.command.title.replace(/\s+/g, ' '))
        return p
      }, [] as string[])
      let chunks: [string, string][] = []
      let len = commands.length
      for (let i = 0; i < len; i++) {
        let title = commands[i]
        chunks.push([title, CODELENS_HL] as [string, string])
        if (i != len - 1) {
          chunks.push([this.config.subseparator, CODELENS_HL] as [string, string])
        }
      }
      if (chunks.length > 0 && this.config.separator) {
        chunks.unshift([`${this.config.separator} `, CODELENS_HL])
      }
      if (top && chunks.length == 0) {
        chunks.push([' ', NORMAL_HL])
      }
      if (chunks.length > 0) {
        document.buffer.setVirtualText(srcId, lnum, chunks, {
          text_align: getTextAlign(this.config.position),
          indent: true
        })
      }
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

  private cancelFetch(): void {
    this.debounceFetch.clear()
    if (this.tokenSource) {
      this.tokenSource.cancel()
      this.tokenSource = null
    }
  }

  private cancelResolve(): void {
    if (this.resolveTokenSource) {
      this.resolveTokenSource.cancel()
      this.resolveTokenSource = null
    }
  }

  private cancel(): void {
    this.resolveCodeLens.clear()
    this.cancelResolve()
    this.cancelFetch()
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
