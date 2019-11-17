import { NeovimClient as Neovim } from '@chemzqm/neovim'
import { Diagnostic, DiagnosticSeverity, Emitter, Event, Range, Disposable } from 'vscode-languageserver-protocol'
import Document from '../model/document'
import { LocationListItem } from '../types'
import CallSequence from '../util/callSequence'
import { equals } from '../util/object'
import { byteIndex, byteLength } from '../util/string'
import workspace from '../workspace'
import { DiagnosticConfig } from './manager'
import { getLocationListItem, getNameFromSeverity } from './util'
const logger = require('../util/logger')('diagnostic-buffer')
const severityNames = ['CocError', 'CocWarning', 'CocInfo', 'CocHint']

// maintains sign and highlightId
export class DiagnosticBuffer implements Disposable {
  private readonly srdId: number
  private readonly signIds: Set<number> = new Set()
  private sequence: CallSequence = null
  private readonly _onDidRefresh = new Emitter<void>()
  public readonly matchIds: Set<number> = new Set()
  public diagnostics: ReadonlyArray<Diagnostic> = []
  public readonly onDidRefresh: Event<void> = this._onDidRefresh.event
  public readonly bufnr: number
  public readonly refresh: (diagnosticItems: ReadonlyArray<Diagnostic>) => void

  constructor(bufnr: number, private config: DiagnosticConfig) {
    this.bufnr = bufnr
    this.srdId = workspace.createNameSpace('coc-diagnostic')
    let timer: NodeJS.Timer = null
    let time = Date.now()
    this.refresh = (diagnostics: ReadonlyArray<Diagnostic>) => {
      time = Date.now()
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        let current = time
        if (this.sequence) {
          await this.sequence.cancel()
        }
        // staled
        if (current != time || !this.document) return
        diagnostics.forEach(o => {
          o.range = this.fixRange(o.range)
        })
        this._refresh(diagnostics)
      }, 30)
    }
  }

  private _refresh(diagnostics: ReadonlyArray<Diagnostic>): void {
    if (equals(this.diagnostics, diagnostics)) return
    let { nvim } = this
    let sequence = this.sequence = new CallSequence()
    let winid: number
    let bufnr: number
    sequence.addFunction(async () => {
      let arr = await nvim.eval(`[coc#util#valid_state(), bufwinid(${this.bufnr}), bufnr("%")]`) as [number, number, number]
      if (arr[0] == 0 || !this.document) return false
      winid = arr[1]
      bufnr = arr[2]
    })
    sequence.addFunction(async () => {
      nvim.pauseNotification()
      this.setDiagnosticInfo(bufnr, diagnostics)
      this.addSigns(diagnostics)
      this.setLocationlist(diagnostics, winid)
      this.addHighlight(diagnostics, winid)
      this.addDiagnosticVText(diagnostics)
      let [, err] = await this.nvim.resumeNotification()
      if (err) logger.error('Diagnostic error:', err)
    })
    sequence.start().then(async canceled => {
      if (!canceled) {
        this.diagnostics = diagnostics
        this._onDidRefresh.fire(void 0)
      }
    }, e => {
      logger.error(e)
    })
  }

  public setLocationlist(diagnostics: ReadonlyArray<Diagnostic>, winid: number): void {
    if (!this.config.locationlist) return
    let { nvim, bufnr } = this
    // not shown
    if (winid == -1) return
    let items: LocationListItem[] = []
    for (let diagnostic of diagnostics) {
      let item = getLocationListItem(diagnostic.source, bufnr, diagnostic)
      items.push(item)
    }
    nvim.call('setloclist', [winid, [], ' ', { title: 'Diagnostics of coc', items }], true)
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
        if (!signIds.has(Number(id)) && severityNames.indexOf(name) != -1) {
          ids.push(id)
        }
      }
      await nvim.call('coc#util#unplace_signs', [bufnr, ids])
    } catch (e) {
      // noop
    }
  }

  public addSigns(diagnostics: ReadonlyArray<Diagnostic>): void {
    if (!this.config.enableSign) return
    this.clearSigns()
    let { nvim, bufnr, signIds } = this
    let signId = this.config.signOffset
    signIds.clear()
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

  public setDiagnosticInfo(bufnr: number, diagnostics: ReadonlyArray<Diagnostic>): void {
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
    if (bufnr == this.bufnr) {
      this.nvim.call('coc#util#do_autocmd', ['CocDiagnosticChange'], true)
    }
  }

  private addDiagnosticVText(diagnostics: ReadonlyArray<Diagnostic>): void {
    let { bufnr, nvim } = this
    if (!this.config.virtualText) return
    if (!nvim.hasFunction('nvim_buf_set_virtual_text')) return
    let buffer = this.nvim.createBuffer(bufnr)
    let lines: Set<number> = new Set()
    let srcId = this.config.virtualTextSrcId
    let prefix = this.config.virtualTextPrefix
    buffer.clearNamespace(srcId)
    for (let diagnostic of diagnostics) {
      let { line } = diagnostic.range.start
      if (lines.has(line)) continue
      lines.add(line)
      let highlight = getNameFromSeverity(diagnostic.severity) + 'VirtualText'
      let msg =
        diagnostic.message.split(/\n/)
          .map((l: string) => l.trim())
          .filter((l: string) => l.length > 0)
          .slice(0, this.config.virtualTextLines)
          .join(this.config.virtualTextLineSeparator)
      buffer.setVirtualText(srcId, line, [[prefix + msg, highlight]], {}).logError()
    }
  }

  public clearHighlight(): void {
    let { matchIds } = this
    if (!this.document) return
    this.document.clearMatchIds(matchIds)
    this.matchIds.clear()
  }

  public addHighlight(diagnostics: ReadonlyArray<Diagnostic>, winid): void {
    this.clearHighlight()
    if (diagnostics.length == 0) return
    if (winid == -1 && workspace.isVim && !workspace.env.textprop) return
    const highlights: Map<string, Range[]> = new Map()
    for (let diagnostic of diagnostics) {
      let { range, severity } = diagnostic
      let hlGroup = getNameFromSeverity(severity) + 'Highlight'
      let ranges = highlights.get(hlGroup) || []
      ranges.push(range)
      highlights.set(hlGroup, ranges)
    }
    for (let [hlGroup, ranges] of highlights.entries()) {
      let matchIds = this.document.highlightRanges(ranges, hlGroup, this.srdId)
      for (let id of matchIds) this.matchIds.add(id)
    }
  }

  // fix range out of total characters
  private fixRange(range: Range): Range {
    let { start, end } = range
    if (start.line != end.line) return range
    let line = this.document.getline(start.line)
    if (start.character < line.length) return range
    return Range.create(start.line, line.length - 1, start.line, line.length)
  }

  /**
   * Used on buffer unload
   *
   * @public
   * @returns {Promise<void>}
   */
  public async clear(): Promise<void> {
    if (this.sequence) this.sequence.cancel().logError()
    let { nvim } = this
    nvim.pauseNotification()
    this.clearHighlight()
    this.clearSigns()
    if (this.config.virtualText
      && nvim.hasFunction('nvim_buf_set_virtual_text')
      && this.document) {
      this.document.buffer.clearNamespace(this.config.virtualTextSrcId)
    }
    this.setDiagnosticInfo(workspace.bufnr, [])
    await nvim.resumeNotification(false, true)
  }

  public dispose(): void {
    if (this.sequence) {
      this.sequence.cancel().logError()
    }
    this._onDidRefresh.dispose()
  }

  private get document(): Document | null {
    if (!this.bufnr) return null
    return workspace.getDocument(this.bufnr)
  }

  public get uri(): string | null {
    if (!this.document) return null
    return this.document.uri
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }
}
