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
const STARTMATCHID = 1090

// maintains sign and highlightId
export class DiagnosticBuffer implements Disposable {
  private matchIds: Set<number> = new Set()
  private signIds: Set<number> = new Set()
  private sequence: CallSequence = null
  private matchId = STARTMATCHID
  private readonly _onDidRefresh = new Emitter<void>()
  public diagnostics: ReadonlyArray<Diagnostic> = []
  public readonly onDidRefresh: Event<void> = this._onDidRefresh.event
  public readonly bufnr: number
  public readonly uri: string
  public refresh: (diagnosticItems: ReadonlyArray<Diagnostic>) => void

  constructor(doc: Document, private config: DiagnosticConfig) {
    this.bufnr = doc.bufnr
    this.uri = doc.uri
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
        if (current != time) return
        this._refresh(diagnostics)
      }, global.hasOwnProperty('__TEST__') ? 30 : 50)
    }
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  private _refresh(diagnostics: ReadonlyArray<Diagnostic>): void {
    if (equals(this.diagnostics, diagnostics)) return
    let sequence = this.sequence = new CallSequence()
    let winid: number
    sequence.addFunction(async () => {
      let valid = await this.nvim.call('coc#util#valid_state')
      return valid ? false : true
    })
    sequence.addFunction(async () => {
      let { nvim, bufnr } = this
      winid = await nvim.call('bufwinid', bufnr) as number
    })
    sequence.addFunction(async () => {
      this.nvim.pauseNotification()
      this.setDiagnosticInfo(diagnostics)
      this.addDiagnosticVText(diagnostics)
      this.setLocationlist(diagnostics, winid)
      this.addSigns(diagnostics)
      this.addHighlight(diagnostics, winid)
      await this.nvim.resumeNotification()
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

  public setDiagnosticInfo(diagnostics: ReadonlyArray<Diagnostic>): void {
    let info = { error: 0, warning: 0, information: 0, hint: 0 }
    for (let diagnostic of diagnostics) {
      switch (diagnostic.severity) {
        case DiagnosticSeverity.Warning:
          info.warning = info.warning + 1
          break
        case DiagnosticSeverity.Information:
          info.information = info.information + 1
          break
        case DiagnosticSeverity.Hint:
          info.hint = info.hint + 1
          break
        default:
          info.error = info.error + 1
      }
    }
    let buffer = this.nvim.createBuffer(this.bufnr)
    buffer.setVar('coc_diagnostic_info', info, true)
    if (!workspace.getDocument(this.bufnr)) return
    if (workspace.bufnr == this.bufnr) this.nvim.command('redraws', true)
    this.nvim.command('silent doautocmd User CocDiagnosticChange', true)
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
      let highlight = getNameFromSeverity(diagnostic.severity) + 'Sign'
      let msg =
        diagnostic.message.split(/\n/)
          .map((l: string) => l.trim())
          .filter((l: string) => l.length > 0)
          .slice(0, this.config.virtualTextLines)
          .join(this.config.virtualTextLineSeparator)
      buffer.setVirtualText(srcId, line, [[prefix + msg, highlight]], {}).catch(_e => {
        // noop
      })
    }
  }

  public clearHighlight(): void {
    let { bufnr, nvim, matchIds } = this
    if (workspace.isVim) {
      nvim.call('coc#util#clearmatches', [Array.from(matchIds)], true)
      this.matchId = STARTMATCHID
    } else {
      let buffer = nvim.createBuffer(bufnr)
      if (this.nvim.hasFunction('nvim_create_namespace')) {
        buffer.clearNamespace(this.config.srcId)
      } else {
        buffer.clearHighlight({ srcId: this.config.srcId })
      }
    }
    this.matchIds.clear()
  }

  public addHighlight(diagnostics: ReadonlyArray<Diagnostic>, winid): void {
    this.clearHighlight()
    if (diagnostics.length == 0) return
    if (winid == -1 && workspace.isVim) return
    for (let diagnostic of diagnostics.slice().reverse()) {
      let { range, severity } = diagnostic
      if (workspace.isVim) {
        this.addHighlightVim(winid, range, severity)
      } else {
        this.addHighlightNvim(range, severity)
      }
    }
  }

  private addHighlightNvim(range: Range, severity: DiagnosticSeverity): void {
    let { srcId } = this.config
    let { start, end } = range
    let document = workspace.getDocument(this.bufnr)
    if (!document) return
    let { buffer } = document
    for (let i = start.line; i <= end.line; i++) {
      let line = document.getline(i)
      if (!line || !line.length) continue
      let s = i == start.line ? start.character : 0
      let e = i == end.line ? end.character : -1
      buffer.addHighlight({
        srcId,
        hlGroup: getNameFromSeverity(severity) + 'Highlight',
        line: i,
        colStart: s == 0 ? 0 : byteIndex(line, s),
        colEnd: e == -1 ? -1 : byteIndex(line, e),
      }).catch(_e => {
        // noop
      })
    }
    this.matchIds.add(srcId)
  }

  private addHighlightVim(winid: number, range: Range, severity: DiagnosticSeverity): void {
    let { start, end } = range
    let { matchIds } = this
    let document = workspace.getDocument(this.bufnr)
    if (!document) return
    try {
      let list: any[] = []
      for (let i = start.line; i <= end.line; i++) {
        let line = document.getline(i)
        if (!line || !line.length) continue
        if (list.length == 8) break
        if (i == start.line && i == end.line) {
          let s = byteIndex(line, start.character) + 1
          let e = byteIndex(line, end.character) + 1
          list.push([i + 1, s, e - s])
        } else if (i == start.line) {
          let s = byteIndex(line, start.character) + 1
          let l = byteLength(line)
          list.push([i + 1, s, l - s + 1])
        } else if (i == end.line) {
          let e = byteIndex(line, end.character) + 1
          list.push([i + 1, 0, e])
        } else {
          list.push(i + 1)
        }
      }
      this.nvim.callTimer('matchaddpos', [getNameFromSeverity(severity) + 'highlight', list, 99, this.matchId, { window: winid }], true)
      matchIds.add(this.matchId)
      this.matchId = this.matchId + 1
    } catch (e) {
      logger.error(e.stack)
    }
  }

  /**
   * Used on buffer unload
   *
   * @public
   * @returns {Promise<void>}
   */
  public async clear(): Promise<void> {
    if (this.sequence) await this.sequence.cancel()
    this.setDiagnosticInfo([])
    this.clearHighlight()
    this.clearSigns()
    // clear locationlist
    if (this.config.locationlist) {
      let winid = await this.nvim.call('bufwinid', this.bufnr) as number
      // not shown
      if (winid == -1) return
      let curr = await this.nvim.call('getloclist', [winid, { title: 1 }])
      if ((curr.title && curr.title.indexOf('Diagnostics of coc') != -1)) {
        this.nvim.call('setloclist', [winid, [], 'f'], true)
      }
    }
    if (this.config.virtualText) {
      let buffer = this.nvim.createBuffer(this.bufnr)
      buffer.clearNamespace(this.config.virtualTextSrcId)
    }
    this.nvim.command('silent doautocmd User CocDiagnosticChange', true)
  }

  public hasMatch(match: number): boolean {
    return this.matchIds.has(match)
  }

  public dispose(): void {
    if (this.sequence) {
      this.sequence.cancel().catch(_e => {
        // noop
      })
    }
    this._onDidRefresh.dispose()
  }
}
