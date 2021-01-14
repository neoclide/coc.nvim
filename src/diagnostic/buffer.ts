import { Neovim, Buffer } from '@chemzqm/neovim'
import debounce from 'debounce'
import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver-protocol'
import workspace from '../workspace'
import { getNameFromSeverity, getLocationListItem, getSeverityType } from './util'
import { BufferSyncItem, DiagnosticConfig, LocationListItem } from '../types'
import { equals } from '../util/object'
const logger = require('../util/logger')('diagnostic-buffer')
const signGroup = 'CocDiagnostic'

/**
 * Manage diagnostics of buffer, including:
 *
 * - highlights
 * - variable
 * - signs
 * - location list
 * - virtual text
 */
export class DiagnosticBuffer implements BufferSyncItem {
  private diagnostics: ReadonlyArray<Diagnostic & { collection: string }> = []
  private _disposed = false
  /**
   * Refresh diagnostics with debounce
   */
  public refresh: ((diagnostics: ReadonlyArray<Diagnostic & { collection: string }>) => void) & { clear(): void }
  constructor(
    private readonly nvim: Neovim,
    public readonly bufnr: number,
    public readonly uri: string,
    private config: DiagnosticConfig,
    private onRefresh: (diagnostics: ReadonlyArray<Diagnostic & { collection: string }>) => void
  ) {
    this.refresh = debounce((diagnostics: ReadonlyArray<Diagnostic & { collection: string }>) => {
      this._refresh(diagnostics).logError()
    }, 300)
  }

  private get displayByAle(): boolean {
    return this.config.displayByAle
  }

  public onChange(): void {
    this.refresh.clear()
  }

  /**
   * Refresh diagnostics without debounce
   */
  public forceRefresh(diagnostics: ReadonlyArray<Diagnostic & { collection: string }>): void {
    this.refresh.clear()
    this._refresh(diagnostics).logError()
  }

  private refreshAle(diagnostics: ReadonlyArray<Diagnostic & { collection: string }>): void {
    let collections = getCollections(this.diagnostics)
    this.diagnostics = diagnostics
    let map: Map<string, Diagnostic[]> = new Map()
    diagnostics.forEach(o => {
      let exists = map.get(o.collection) || []
      exists.push(o)
      map.set(o.collection, exists)
    })
    // clear old collection.
    for (let name of collections) {
      if (!map.has(name)) {
        map.set(name, [])
      }
    }
    this.nvim.pauseNotification()
    for (let [collection, diagnostics] of map.entries()) {
      let aleItems = diagnostics.map(o => {
        let range = o.range || Range.create(0, 0, 1, 0)
        return {
          text: o.message,
          code: o.code,
          lnum: range.start.line + 1,
          col: range.start.character + 1,
          end_lnum: range.end.line + 1,
          end_col: range.end.character,
          type: getSeverityType(o.severity)
        }
      })
      let method = global.hasOwnProperty('__TEST__') ? 'MockAleResults' : 'ale#other_source#ShowResults'
      this.nvim.call(method, [this.bufnr, collection, aleItems], true)
    }
    this.nvim.resumeNotification().then(res => {
      if (Array.isArray(res) && res[1] != null) {
        logger.error(`Error on displayByAle:`, res[1][2])
      }
    }).logError()
  }

  private async _refresh(diagnostics: ReadonlyArray<Diagnostic & { collection: string }>): Promise<void> {
    if (equals(this.diagnostics, diagnostics)) return
    let { refreshOnInsertMode } = this.config
    let { nvim } = this
    let arr = await nvim.eval(`[coc#util#check_refresh(${this.bufnr}),mode(),line("."),getloclist(bufwinid(${this.bufnr}),{'title':1})]`) as [number, string, number, { title: string }]
    if (arr[0] == 0 || this._disposed) return
    let mode = arr[1]
    if (!refreshOnInsertMode && mode.startsWith('i') && diagnostics.length) return
    if (this.displayByAle) {
      this.refreshAle(diagnostics)
    } else {
      this.diagnostics = diagnostics
      let lnum = arr[2]
      nvim.pauseNotification()
      this.setDiagnosticInfo(diagnostics)
      this.addSigns(diagnostics)
      this.addHighlight(diagnostics)
      this.updateLocationList(arr[3], diagnostics)
      this.showVirtualText(diagnostics, lnum)
      if (workspace.isVim) this.nvim.command('redraw', true)
      let res = await this.nvim.resumeNotification()
      if (Array.isArray(res) && res[1]) throw new Error(res[1])
    }
    this.onRefresh(diagnostics)
  }

  public updateLocationList(curr: { title: string }, diagnostics: ReadonlyArray<Diagnostic>): void {
    if (!this.config.locationlistUpdate) return
    if (!curr || curr.title !== 'Diagnostics of coc') return
    let items: LocationListItem[] = []
    for (let diagnostic of diagnostics) {
      let item = getLocationListItem(this.bufnr, diagnostic)
      items.push(item)
    }
    this.nvim.call('setloclist', [0, [], 'r', { title: 'Diagnostics of coc', items }], true)
  }

  public addSigns(diagnostics: ReadonlyArray<Diagnostic>): void {
    if (!this.config.enableSign) return
    this.clearSigns()
    let { nvim, bufnr } = this
    for (let diagnostic of diagnostics) {
      let { range, severity } = diagnostic
      let line = range.start.line
      let name = getNameFromSeverity(severity)
      nvim.call('sign_place', [0, signGroup, name, bufnr, { lnum: line + 1, priority: 14 - (severity || 0) }], true)
    }
  }

  private clearSigns(): void {
    let { nvim, bufnr } = this
    nvim.call('sign_unplace', [signGroup, { buffer: bufnr }], true)
  }

  public setDiagnosticInfo(diagnostics: ReadonlyArray<Diagnostic>): void {
    let lnums = [0, 0, 0, 0]
    let info = { error: 0, warning: 0, information: 0, hint: 0, lnums }
    for (let diagnostic of diagnostics) {
      switch (diagnostic.severity) {
        case DiagnosticSeverity.Warning:
          info.warning = info.warning + 1
          lnums[1] = lnums[1] || diagnostic.range.start.line + 1
          break
        case DiagnosticSeverity.Information:
          info.information = info.information + 1
          lnums[2] = lnums[2] || diagnostic.range.start.line + 1
          break
        case DiagnosticSeverity.Hint:
          info.hint = info.hint + 1
          lnums[3] = lnums[3] || diagnostic.range.start.line + 1
          break
        default:
          lnums[0] = lnums[0] || diagnostic.range.start.line + 1
          info.error = info.error + 1
      }
    }
    this.nvim.call('coc#util#set_buf_var', [this.bufnr, 'coc_diagnostic_info', info], true)
    this.nvim.call('coc#util#do_autocmd', ['CocDiagnosticChange'], true)
  }

  public showVirtualText(diagnostics: ReadonlyArray<Diagnostic>, lnum: number): void {
    let { buffer, config } = this
    if (!config.virtualText) return
    let srcId = this.config.virtualTextSrcId
    let prefix = this.config.virtualTextPrefix
    if (this.config.virtualTextCurrentLineOnly) {
      diagnostics = diagnostics.filter(d => {
        let { start, end } = d.range
        return start.line <= lnum - 1 && end.line >= lnum - 1
      })
    }
    buffer.clearNamespace(srcId)
    for (let diagnostic of diagnostics) {
      let { line } = diagnostic.range.start
      let highlight = getNameFromSeverity(diagnostic.severity) + 'VirtualText'
      let msg = diagnostic.message.split(/\n/)
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0)
        .slice(0, this.config.virtualTextLines)
        .join(this.config.virtualTextLineSeparator)
      buffer.setVirtualText(srcId, line, [[prefix + msg, highlight]], {}).logError()
    }
  }

  public addHighlight(diagnostics: ReadonlyArray<Diagnostic>): void {
    if (workspace.isVim && !workspace.env.textprop) return
    this.clearHighlight()
    if (diagnostics.length == 0) return
    // can't add highlight for old vim
    // TODO support DiagnosticTag, fade unnecessary ranges.
    const highlights: Map<DiagnosticSeverity, Range[]> = new Map()
    for (let diagnostic of diagnostics) {
      let { range, severity } = diagnostic
      let ranges = highlights.get(severity) || []
      ranges.push(range)
      highlights.set(severity, ranges)
    }
    for (let severity of [DiagnosticSeverity.Hint, DiagnosticSeverity.Information, DiagnosticSeverity.Warning, DiagnosticSeverity.Error]) {
      let ranges = highlights.get(severity) || []
      let hlGroup = getNameFromSeverity(severity) + 'Highlight'
      this.buffer.highlightRanges('diagnostic', hlGroup, ranges)
    }
  }

  private clearHighlight(): void {
    this.buffer.clearNamespace('diagnostic')
  }

  public get buffer(): Buffer {
    return this.nvim.createBuffer(this.bufnr)
  }

  /**
   * Clear all diagnostics from UI.
   */
  public clear(): void {
    this.refresh.clear()
    let { nvim } = this
    if (this.displayByAle) {
      let collections = getCollections(this.diagnostics)
      this.diagnostics = []
      if (collections.size > 0) {
        for (let collection of collections) {
          let method = global.hasOwnProperty('__TEST__') ? 'MockAleResults' : 'ale#other_source#ShowResults'
          this.nvim.call(method, [this.bufnr, collection, []], true)
        }
      }
    } else {
      this.diagnostics = []
      nvim.pauseNotification()
      this.clearHighlight()
      if (this.config.enableSign) {
        this.clearSigns()
      }
      if (this.config.virtualText) {
        this.buffer.clearNamespace(this.config.virtualTextSrcId)
      }
      this.setDiagnosticInfo([])
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      nvim.resumeNotification(false, true)
    }
  }

  public dispose(): void {
    this._disposed = true
    this.clear()
  }
}

function getCollections(diagnostics: ReadonlyArray<Diagnostic & { collection: string }>): Set<string> {
  let res: Set<string> = new Set()
  diagnostics.forEach(o => {
    res.add(o.collection)
  })
  return res
}
