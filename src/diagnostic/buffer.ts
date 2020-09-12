import { NeovimClient as Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import { Diagnostic, DiagnosticSeverity, Emitter, Event, Range } from 'vscode-languageserver-protocol'
import Document from '../model/document'
import workspace from '../workspace'
import { DiagnosticConfig } from './manager'
import { getNameFromSeverity, getLocationListItem } from './util'
import { LocationListItem } from '..'
const logger = require('../util/logger')('diagnostic-buffer')
const severityNames = ['CocError', 'CocWarning', 'CocInfo', 'CocHint']

// maintains sign and highlightId
export class DiagnosticBuffer {
  private readonly srdId: number
  private readonly signIds: Set<number> = new Set()
  private readonly _onDidRefresh = new Emitter<void>()
  public readonly matchIds: Set<number> = new Set()
  public readonly onDidRefresh: Event<void> = this._onDidRefresh.event
  /**
   * Refresh diagnostics with debounce
   */
  public refresh: Function & { clear(): void }

  constructor(
    public readonly bufnr: number,
    public readonly uri: string,
    private config: DiagnosticConfig) {
    this.srdId = workspace.createNameSpace('coc-diagnostic')
    this.refresh = debounce((diagnostics: Diagnostic[]) => {
      this._refresh(diagnostics).logError()
    }, 300)
  }

  /**
   * Refresh diagnostics without debounce
   */
  public forceRefresh(diagnostics: ReadonlyArray<Diagnostic>): void {
    this.refresh.clear()
    this._refresh(diagnostics).logError()
  }

  private async _refresh(diagnostics: ReadonlyArray<Diagnostic>): Promise<void> {
    let { refreshOnInsertMode } = this.config
    let { nvim } = this
    let arr = await nvim.eval(`[coc#util#check_refresh(${this.bufnr}),mode(),bufnr("%"),line("."),getloclist(bufwinid(${this.bufnr}),{'title':1})]`) as [number, string, number, number, { title: string }]
    if (arr[0] == 0) return
    let mode = arr[1]
    if (!refreshOnInsertMode && mode.startsWith('i') && diagnostics.length) return
    let bufnr = arr[2]
    let lnum = arr[3]
    nvim.pauseNotification()
    this.setDiagnosticInfo(diagnostics)
    this.addSigns(diagnostics)
    this.addHighlight(diagnostics, bufnr)
    this.updateLocationList(arr[4], diagnostics)
    if (this.bufnr == bufnr) {
      this.showVirtualText(diagnostics, lnum)
    }
    if (workspace.isVim) {
      this.nvim.command('redraw', true)
    }
    let res = await this.nvim.resumeNotification()
    if (Array.isArray(res) && res[1]) throw new Error(res[1])
    this._onDidRefresh.fire(void 0)
  }

  private clearSigns(): void {
    let { nvim, signIds, bufnr } = this
    if (signIds.size > 0) {
      nvim.call('coc#util#unplace_signs', [bufnr, Array.from(signIds)], true)
      signIds.clear()
    }
  }

  public async checkSigns(): Promise<void> {
    let { nvim, bufnr, signIds } = this
    try {
      let content = await this.nvim.call('execute', [`sign place buffer=${bufnr}`])
      let lines: string[] = content.split('\n')
      let ids = []
      for (let line of lines) {
        let ms = line.match(/^\s*line=\d+\s+id=(\d+)\s+name=(\w+)/)
        if (!ms) continue
        let [, id, name] = ms
        if (!signIds.has(Number(id)) && severityNames.includes(name)) {
          ids.push(id)
        }
      }
      await nvim.call('coc#util#unplace_signs', [bufnr, ids])
    } catch (e) {
      // noop
    }
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
    let { nvim, bufnr, signIds } = this
    let signId = this.config.signOffset
    let lines: Set<number> = new Set()
    for (let diagnostic of diagnostics) {
      let { range, severity } = diagnostic
      let line = range.start.line
      if (lines.has(line)) continue
      lines.add(line)
      let name = getNameFromSeverity(severity)
      nvim.command(`sign place ${signId} line=${line + 1} name=${name} buffer=${bufnr}`, true)
      signIds.add(signId)
      signId = signId + 1
    }
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
    let { bufnr, config } = this
    if (!config.virtualText) return
    let buffer = this.nvim.createBuffer(bufnr)
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

  public clearHighlight(): void {
    let { matchIds, document } = this
    if (document) {
      document.clearMatchIds(matchIds)
    }
    this.matchIds.clear()
  }

  public addHighlight(diagnostics: ReadonlyArray<Diagnostic>, bufnr: number): void {
    this.clearHighlight()
    if (diagnostics.length == 0) return
    // can't add highlight for old vim
    if (workspace.isVim && !workspace.env.textprop && bufnr != this.bufnr) return
    let { document } = this
    if (!document) return
    // TODO support DiagnosticTag
    const highlights: Map<string, Range[]> = new Map()
    for (let diagnostic of diagnostics) {
      let { range, severity } = diagnostic
      let hlGroup = getNameFromSeverity(severity) + 'Highlight'
      let ranges = highlights.get(hlGroup) || []
      ranges.push(range)
      highlights.set(hlGroup, ranges)
    }
    for (let [hlGroup, ranges] of highlights.entries()) {
      let matchIds = document.highlightRanges(ranges, hlGroup, this.srdId)
      for (let id of matchIds) this.matchIds.add(id)
    }
  }

  /**
   * Used on buffer unload
   *
   * @public
   * @returns {Promise<void>}
   */
  public async clear(): Promise<void> {
    this.refresh.clear()
    let { nvim } = this
    nvim.pauseNotification()
    this.clearHighlight()
    this.clearSigns()
    if (this.config.virtualText) {
      let buffer = nvim.createBuffer(this.bufnr)
      buffer.clearNamespace(this.config.virtualTextSrcId)
    }
    this.setDiagnosticInfo([])
    await nvim.resumeNotification(false, true)
  }

  public hasHighlights(): boolean {
    return this.matchIds.size > 0
  }

  public dispose(): void {
    this.refresh.clear()
    this._onDidRefresh.dispose()
  }

  private get document(): Document | null {
    return workspace.getDocument(this.uri)
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }
}
