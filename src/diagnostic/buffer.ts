import { Buffer, Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { Diagnostic, DiagnosticSeverity, DiagnosticTag, Position, Range } from 'vscode-languageserver-protocol'
import { BufferSyncItem, HighlightItem, LocationListItem } from '../types'
import { equals } from '../util/object'
import { lineInRange, positionInRange } from '../util/position'
import workspace from '../workspace'
import { getLocationListItem, getNameFromSeverity, getSeverityType } from './util'
const isVim = process.env.VIM_NODE_RPC == '1'
const logger = require('../util/logger')('diagnostic-buffer')
const signGroup = 'CocDiagnostic'
const highlightNamespace = 'diagnostic'
// higher priority first
const hlGroups = ['CocErrorHighlight', 'CocWarningHighlight', 'CocInfoHighlight', 'CocHintHighlight', 'CocDeprecatedHighlight', 'CocUnusedHighlight']

export enum DiagnosticState {
  Enabled,
  Disabled
}

export enum DiagnosticHighlight {
  Error = 'CocErrorHighlight',
  Warning = 'CocWarningHighlight',
  Information = 'CocInfoHighlight',
  Hint = 'CocHintHighlight',
  Deprecated = 'CocDeprecatedHighlight',
  Unused = 'CocUnusedHighlight'
}

export interface DiagnosticConfig {
  highlighLimit: number
  autoRefresh: boolean
  enableSign: boolean
  locationlistUpdate: boolean
  enableHighlightLineNumber: boolean
  checkCurrentLine: boolean
  enableMessage: string
  displayByAle: boolean
  signPriority: number
  errorSign: string
  warningSign: string
  infoSign: string
  hintSign: string
  level: number
  messageTarget: string
  messageDelay: number
  maxWindowHeight: number
  maxWindowWidth: number
  refreshOnInsertMode: boolean
  virtualText: boolean
  virtualTextCurrentLineOnly: boolean
  virtualTextSrcId: number
  virtualTextPrefix: string
  virtualTextLines: number
  virtualTextLineSeparator: string
  filetypeMap: object
  showUnused?: boolean
  showDeprecated?: boolean
  format?: string
}

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
  private _state = DiagnosticState.Enabled
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
    }, 500)
  }

  private get displayByAle(): boolean {
    return this.config.displayByAle
  }

  public onChange(): void {
    this.refresh.clear()
  }

  public changeState(state: DiagnosticState): void {
    this._state = state
  }

  public get enabled(): boolean {
    return this._state == DiagnosticState.Enabled
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
    let { refreshOnInsertMode } = this.config
    let { nvim } = this
    if (this._state == DiagnosticState.Disabled) return
    let arr = await nvim.eval(`[coc#util#check_refresh(${this.bufnr}),mode(),line("."),getloclist(bufwinid(${this.bufnr}),{'title':1})]`) as [number, string, number, { title: string }]
    if (arr[0] == 0 || this._disposed) return
    let mode = arr[1]
    if (!refreshOnInsertMode && mode.startsWith('i') && diagnostics.length) return
    if (this.displayByAle) {
      this.refreshAle(diagnostics)
    } else {
      let lnum = arr[2]
      if (equals(this.diagnostics, diagnostics)) {
        this.updateHighlights(diagnostics)
        this.showVirtualText(diagnostics, lnum)
        if (isVim) this.nvim.command('redraw', true)
        return
      }
      this.diagnostics = diagnostics
      nvim.pauseNotification()
      this.setDiagnosticInfo(diagnostics)
      this.addSigns(diagnostics)
      this.updateHighlights(diagnostics)
      this.updateLocationList(arr[3], diagnostics)
      this.showVirtualText(diagnostics, lnum)
      if (isVim) this.nvim.command('redraw', true)
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
    this.buffer.unplaceSign({ group: signGroup })
    let signsMap: Map<number, DiagnosticSeverity[]> = new Map()
    for (let diagnostic of diagnostics) {
      let { range, severity } = diagnostic
      let line = range.start.line
      let exists = signsMap.get(line) || []
      if (exists.includes(severity)) {
        continue
      }
      exists.push(severity)
      signsMap.set(line, exists)
      let priority = this.config.signPriority + 4 - severity
      let name = getNameFromSeverity(severity)
      this.buffer.placeSign({ name, lnum: line + 1, group: signGroup, priority })
    }
  }

  private clearSigns(): void {
    this.buffer.unplaceSign({ group: signGroup })
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
    for (let diagnostic of [...diagnostics].reverse()) {
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

  public updateHighlights(diagnostics: ReadonlyArray<Diagnostic>): void {
    let items = this.getHighlightItems(diagnostics)
    this.buffer.updateHighlights(highlightNamespace, items)
  }

  private getHighlightItems(diagnostics: ReadonlyArray<Diagnostic>): HighlightItem[] {
    let doc = workspace.getDocument(this.bufnr)
    if (!doc) return []
    let res: HighlightItem[] = []
    for (let diagnostic of diagnostics.slice(0, this.config.highlighLimit)) {
      let { range } = diagnostic
      if (!range) continue
      let hlGroup = getHighlightGroup(diagnostic)
      doc.addHighlights(res, hlGroup, range)
    }
    // needed for iteration performance and since diagnostic highlight may cross lines.
    res.sort((a, b) => {
      if (a.lnum != b.lnum) return a.lnum - b.lnum
      if (a.colStart != b.colStart) return a.colStart - b.colStart
      return hlGroups.indexOf(b.hlGroup) - hlGroups.indexOf(a.hlGroup)
    })
    return res
  }

  private clearHighlight(): void {
    this.buffer.clearNamespace(highlightNamespace)
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
    this.diagnostics = []
    if (this.displayByAle) {
      let collections = getCollections(this.diagnostics)
      if (collections.size > 0) {
        for (let collection of collections) {
          let method = global.hasOwnProperty('__TEST__') ? 'MockAleResults' : 'ale#other_source#ShowResults'
          this.nvim.call(method, [this.bufnr, collection, []], true)
        }
      }
    } else {
      nvim.pauseNotification()
      this.clearHighlight()
      this.clearSigns()
      if (this.config.virtualText) {
        this.buffer.clearNamespace(this.config.virtualTextSrcId)
      }
      this.buffer.deleteVar('coc_diagnostic_info')
      void nvim.resumeNotification(false, true)
    }
  }

  /**
   * Get diagnostics at cursor position.
   */
  public getDiagnosticsAt(pos: Position, checkCurrentLine: boolean): Diagnostic[] {
    let diagnostics = this.diagnostics.slice()
    if (checkCurrentLine) {
      diagnostics = diagnostics.filter(o => lineInRange(pos.line, o.range))
    } else {
      diagnostics = diagnostics.filter(o => positionInRange(pos, o.range) == 0)
    }
    diagnostics.sort((a, b) => a.severity - b.severity)
    return diagnostics
  }

  public dispose(): void {
    this._disposed = true
    this.clear()
  }
}

function getHighlightGroup(diagnostic: Diagnostic): DiagnosticHighlight {
  let tags = diagnostic.tags || []
  if (tags.includes(DiagnosticTag.Deprecated)) {
    return DiagnosticHighlight.Deprecated
  }
  if (tags.includes(DiagnosticTag.Unnecessary)) {
    return DiagnosticHighlight.Unused
  }
  switch (diagnostic.severity) {
    case DiagnosticSeverity.Error:
      return DiagnosticHighlight.Error
    case DiagnosticSeverity.Warning:
      return DiagnosticHighlight.Warning
    case DiagnosticSeverity.Information:
      return DiagnosticHighlight.Information
    case DiagnosticSeverity.Hint:
      return DiagnosticHighlight.Hint
    default:
      return DiagnosticHighlight.Error
  }
}

function getCollections(diagnostics: ReadonlyArray<Diagnostic & { collection: string }>): Set<string> {
  let res: Set<string> = new Set()
  diagnostics.forEach(o => {
    res.add(o.collection)
  })
  return res
}
