import { Buffer, Neovim } from '@chemzqm/neovim'
import { debounce } from 'debounce'
import { Diagnostic, DiagnosticSeverity, Position } from 'vscode-languageserver-protocol'
import { SyncItem } from '../model/bufferSync'
import { HighlightItem, LocationListItem } from '../types'
import events from '../events'
import { Mutex } from '../util/mutex'
import { lineInRange, positionInRange } from '../util/position'
import workspace from '../workspace'
import { DiagnosticConfig, getHighlightGroup, getLocationListItem, getNameFromSeverity, getSeverityType, sortDiagnostics } from './util'
const logger = require('../util/logger')('diagnostic-buffer')
const signGroup = 'CocDiagnostic'
const NAMESPACE = 'diagnostic'
// higher priority first
const hlGroups = ['CocErrorHighlight', 'CocWarningHighlight', 'CocInfoHighlight', 'CocHintHighlight', 'CocDeprecatedHighlight', 'CocUnusedHighlight']

interface DiagnosticInfo {
  /**
   * current bufnr
   */
  bufnr: number
  lnum: number
  winid: number
  locationlist: string
}

const aleMethod = global.hasOwnProperty('__TEST__') ? 'MockAleResults' : 'ale#other_source#ShowResults'
/**
 * Manage diagnostics of buffer, including:
 *
 * - highlights
 * - variable
 * - signs
 * - location list
 * - virtual text
 */
export class DiagnosticBuffer implements SyncItem {
  private diagnosticsMap: Map<string, ReadonlyArray<Diagnostic>> = new Map()
  private mutex = new Mutex()
  private _disposed = false
  private _dirty = false
  public refreshHighlights: Function & { clear(): void }
  constructor(
    private readonly nvim: Neovim,
    public readonly bufnr: number,
    public readonly uri: string,
    private config: DiagnosticConfig,
    private onRefresh: (diagnostics: ReadonlyArray<Diagnostic>) => void
  ) {
    let ms = global.hasOwnProperty('__TEST__') ? 50 : 500
    this.refreshHighlights = debounce(this._refreshHighlights.bind(this), ms)
  }

  public get dirty(): boolean {
    return this._dirty
  }

  public onChange(): void {
    this.refreshHighlights.clear()
  }

  public onTextChange(): void {
    if (events.insertMode && !this.config.refreshOnInsertMode) return
    this.refreshHighlights()
  }

  private get displayByAle(): boolean {
    return this.config.displayByAle
  }

  private clearHighlight(collection: string): void {
    this.buffer.clearNamespace(NAMESPACE + collection)
  }

  private clearSigns(collection: string): void {
    this.buffer.unplaceSign({ group: signGroup + collection })
  }

  private get diagnostics(): Diagnostic[] {
    let res: Diagnostic[] = []
    for (let diags of this.diagnosticsMap.values()) {
      res.push(...diags)
    }
    return res
  }

  private get buffer(): Buffer {
    return this.nvim.createBuffer(this.bufnr)
  }

  private refreshAle(collection: string, diagnostics: ReadonlyArray<Diagnostic>): void {
    let aleItems = diagnostics.map(o => {
      let range = o.range
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
    this.nvim.call(aleMethod, [this.bufnr, 'coc' + collection, aleItems], true)
  }

  /**
   * Refresh buffer with new diagnostics.
   *
   * @param {Object} diagnosticsMap
   * @param {boolean} force Force highlights update.
   */
  public async refresh(diagnosticsMap: { [collection: string]: Diagnostic[] }, clear?: boolean): Promise<void> {
    if (clear) {
      this.diagnosticsMap.clear()
      this.refreshHighlights.clear()
    }
    let release = await this.mutex.acquire()
    try {
      await this._refresh(diagnosticsMap)
      release()
    } catch (e) {
      release()
      this.nvim.echoError(e)
    }
  }

  private async getDiagnosticInfo(): Promise<DiagnosticInfo | undefined> {
    let { refreshOnInsertMode } = this.config
    let { nvim, bufnr } = this
    let disabledByInsert = events.insertMode && !refreshOnInsertMode
    if (disabledByInsert) return undefined
    let info: DiagnosticInfo | undefined = await nvim.call('coc#util#diagnostic_info', [bufnr, !refreshOnInsertMode])
    return info
  }

  private async updateDiagnostics(diagnosticsMap: Map<string, ReadonlyArray<Diagnostic>>, info: DiagnosticInfo): Promise<void> {
    let { nvim } = this
    nvim.pauseNotification()
    for (let [collection, diagnostics] of diagnosticsMap.entries()) {
      this.addSigns(collection, diagnostics)
      this.updateHighlights(collection, diagnostics)
    }
    this.showVirtualText(info.lnum, info.bufnr)
    this.updateLocationList(info.winid, info.locationlist)
    this.setDiagnosticInfo()
    void this.nvim.resumeNotification(true, false)
    this.onRefresh(this.diagnostics)
  }

  /**
   * Refresh UI with new diagnostics.
   * Used on document create, diagnostics change and force refresh.
   * Note that highlights create may use timer, so the highlight process may not finished.
   */
  private async _refresh(diagnosticsMap: { [collection: string]: Diagnostic[] }): Promise<void> {
    let { nvim } = this
    let info = await this.getDiagnosticInfo()
    if (this.displayByAle) {
      if (!info) return
      nvim.pauseNotification()
      for (let [collection, diagnostics] of Object.entries(diagnosticsMap)) {
        this.diagnosticsMap.set(collection, [])
        this.refreshAle(collection, diagnostics)
      }
      await nvim.resumeNotification()
    } else {
      // avoid highlights on invalid state or buffer hidden.
      let noHighlights = !info || info.winid == -1
      let map: Map<string, ReadonlyArray<Diagnostic>> = new Map()
      for (let [collection, diagnostics] of Object.entries(diagnosticsMap)) {
        this.diagnosticsMap.set(collection, diagnostics)
        map.set(collection, diagnostics)
      }
      this._dirty = noHighlights
      if (noHighlights) return
      await this.updateDiagnostics(map, info)
    }
  }

  public updateLocationList(winid: number, title: string): void {
    if (!this.config.locationlistUpdate || winid == -1 || title !== 'Diagnostics of coc') return
    let items: LocationListItem[] = []
    let { diagnostics } = this
    diagnostics.sort(sortDiagnostics)
    for (let diagnostic of diagnostics) {
      let item = getLocationListItem(this.bufnr, diagnostic)
      items.push(item)
    }
    this.nvim.call('setloclist', [winid, [], 'r', { title: 'Diagnostics of coc', items }], true)
  }

  public addSigns(collection: string, diagnostics: ReadonlyArray<Diagnostic>): void {
    let { enableSign, signLevel } = this.config
    if (!enableSign) return
    let group = signGroup + collection
    this.buffer.unplaceSign({ group })
    let signsMap: Map<number, DiagnosticSeverity[]> = new Map()
    for (let diagnostic of diagnostics) {
      let { range, severity } = diagnostic
      if (!severity || (signLevel && severity > signLevel)) {
        continue
      }
      let line = range.start.line
      let exists = signsMap.get(line) || []
      if (exists.includes(severity)) {
        continue
      }
      exists.push(severity)
      signsMap.set(line, exists)
      let priority = this.config.signPriority + 4 - severity
      let name = getNameFromSeverity(severity)
      this.buffer.placeSign({ name, lnum: line + 1, group, priority })
    }
  }

  public setDiagnosticInfo(): void {
    let lnums = [0, 0, 0, 0]
    let info = { error: 0, warning: 0, information: 0, hint: 0, lnums }
    for (let diagnostics of this.diagnosticsMap.values()) {
      for (let diagnostic of diagnostics) {
        let lnum = diagnostic.range.start.line + 1
        switch (diagnostic.severity) {
          case DiagnosticSeverity.Warning:
            info.warning = info.warning + 1
            lnums[1] = lnums[1] ? Math.min(lnums[1], lnum) : lnum
            break
          case DiagnosticSeverity.Information:
            info.information = info.information + 1
            lnums[2] = lnums[2] ? Math.min(lnums[2], lnum) : lnum
            break
          case DiagnosticSeverity.Hint:
            info.hint = info.hint + 1
            lnums[3] = lnums[3] ? Math.min(lnums[3], lnum) : lnum
            break
          default:
            lnums[0] = lnums[0] ? Math.min(lnums[0], lnum) : lnum
            info.error = info.error + 1
        }
      }
    }
    let buf = this.nvim.createBuffer(this.bufnr)
    buf.setVar('coc_diagnostic_info', info, true)
    this.nvim.call('coc#util#do_autocmd', ['CocDiagnosticChange'], true)
  }

  public showVirtualText(lnum: number, bufnr?: number): void {
    let { config } = this
    let { virtualText, virtualTextLevel } = config
    if (!virtualText) return
    let { virtualTextSrcId, virtualTextPrefix, virtualTextCurrentLineOnly } = this.config
    let { diagnostics, buffer } = this
    if (virtualTextCurrentLineOnly) {
      if (bufnr && this.bufnr != bufnr) return
      diagnostics = diagnostics.filter(d => {
        let { start, end } = d.range
        return start.line <= lnum - 1 && end.line >= lnum - 1
      })
    }
    diagnostics.sort(sortDiagnostics)
    buffer.clearNamespace(virtualTextSrcId)
    for (let i = diagnostics.length - 1; i >= 0; i--) {
      let diagnostic = diagnostics[i]
      if (virtualTextLevel && diagnostic.severity && diagnostic.severity > virtualTextLevel) {
        continue
      }
      let { line } = diagnostic.range.start
      let highlight = getNameFromSeverity(diagnostic.severity) + 'VirtualText'
      let msg = diagnostic.message.split(/\n/)
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0)
        .slice(0, this.config.virtualTextLines)
        .join(this.config.virtualTextLineSeparator)
      if (workspace.has('nvim-0.5.1')) {
        let opts: any = {
          virt_text: [[virtualTextPrefix + msg, highlight]]
        }
        if (config.virtualTextAlignRight) {
          opts.virt_text_pos = 'right_align'
        } else if (typeof config.virtualTextWinCol === 'number') {
          opts.virt_text_win_col = config.virtualTextWinCol
        }
        buffer.setExtMark(virtualTextSrcId, line, 0, opts)
      } else {
        void buffer.setVirtualText(virtualTextSrcId, line, [[virtualTextPrefix + msg, highlight]], {})
      }
    }
  }

  public updateHighlights(collection: string, diagnostics: ReadonlyArray<Diagnostic>): void {
    if (!diagnostics.length) {
      this.clearHighlight(collection)
    } else {
      let items = this.getHighlightItems(diagnostics)
      let priority = this.config.highlightPriority
      this.buffer.updateHighlights(NAMESPACE + collection, items, { priority })
    }
  }

  /**
   * Refresh all diagnostics
   */
  private async _refreshHighlights(): Promise<void> {
    if (this.config.displayByAle) return
    this._dirty = false
    let info = await this.getDiagnosticInfo()
    let noHighlights = !info || info.winid == -1
    if (noHighlights) return
    await this.updateDiagnostics(this.diagnosticsMap, info)
  }

  private getHighlightItems(diagnostics: ReadonlyArray<Diagnostic>): HighlightItem[] {
    let doc = workspace.getDocument(this.bufnr)
    if (!doc) return []
    let res: HighlightItem[] = []
    for (let diagnostic of diagnostics.slice(0, this.config.highlighLimit)) {
      let hlGroup = getHighlightGroup(diagnostic)
      doc.addHighlights(res, hlGroup, diagnostic.range)
    }
    // needed for iteration performance and since diagnostic highlight may cross lines.
    res.sort((a, b) => {
      if (a.lnum != b.lnum) return a.lnum - b.lnum
      if (a.colStart != b.colStart) return a.colStart - b.colStart
      return hlGroups.indexOf(b.hlGroup) - hlGroups.indexOf(a.hlGroup)
    })
    return res
  }

  /**
   * Clear all diagnostics from UI.
   */
  public clear(): void {
    let { nvim } = this
    let collections = Array.from(this.diagnosticsMap.keys())
    this.refreshHighlights.clear()
    this.diagnosticsMap.clear()
    if (this.displayByAle) {
      for (let collection of collections) {
        this.nvim.call(aleMethod, [this.bufnr, collection, []], true)
      }
    } else {
      this.buffer.deleteVar('coc_diagnostic_info')
      nvim.pauseNotification()
      for (let collection of collections) {
        this.clearHighlight(collection)
        this.clearSigns(collection)
      }
      if (this.config.virtualText) {
        this.buffer.clearNamespace(this.config.virtualTextSrcId)
      }
      void nvim.resumeNotification(true, true)
    }
  }

  /**
   * Get diagnostics at cursor position.
   */
  public getDiagnosticsAt(pos: Position, checkCurrentLine: boolean): Diagnostic[] {
    let diagnostics: Diagnostic[] = []
    for (let diags of this.diagnosticsMap.values()) {
      if (checkCurrentLine) {
        diagnostics.push(...diags.filter(o => lineInRange(pos.line, o.range)))
      } else {
        diagnostics.push(...diags.filter(o => positionInRange(pos, o.range) == 0))
      }
    }
    diagnostics.sort(sortDiagnostics)
    return diagnostics
  }

  public async isEnabled(): Promise<boolean> {
    if (this._disposed) return false
    let buf = this.nvim.createBuffer(this.bufnr)
    let res = await buf.getVar('coc_diagnostic_disable')
    return res != 1
  }

  public dispose(): void {
    this._disposed = true
    this.clear()
  }
}
