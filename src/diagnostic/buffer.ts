import { NeovimClient as Neovim } from '@chemzqm/neovim'
import { Diagnostic, DiagnosticSeverity, Range, ApplyWorkspaceEditRequest } from 'vscode-languageserver-protocol'
import { DiagnosticItems, LocationListItem } from '../types'
import { equals } from '../util/object'
import { byteIndex, byteLength } from '../util/string'
import CallSequence from '../util/callSequence'
import workspace from '../workspace'
import { DiagnosticConfig } from './manager'
import { getNameFromSeverity, getLocationListItem } from './util'
import Document from '../model/document'
const logger = require('../util/logger')('diagnostic-buffer')
const severityNames = ['CocError', 'CocWarning', 'CocInfo', 'CocHint']

// maintains sign and highlightId
export class DiagnosticBuffer {
  private matchIds: Set<number> = new Set()
  private signIds: Set<number> = new Set()
  private _diagnosticItems: DiagnosticItems = {}
  private sequence: CallSequence = null
  private isVim: boolean
  public vTextNameSpace: number = null
  public readonly bufnr: number
  public readonly uri: string
  public refresh: (diagnosticItems: DiagnosticItems) => void

  constructor(doc: Document, private config: DiagnosticConfig) {
    this.bufnr = doc.bufnr
    this.isVim = workspace.isVim
    this.uri = doc.uri
    let timer: NodeJS.Timer = null
    let time = Date.now()
    this.refresh = (diagnosticItems: DiagnosticItems) => {
      time = Date.now()
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        let current = time
        if (this.sequence) {
          await this.sequence.cancel()
        }
        // staled
        if (current != time) return
        this._refresh(diagnosticItems)
      }, global.hasOwnProperty('__TEST__') ? 30 : 50)
    }
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  private _refresh(diagnosticItems: DiagnosticItems): void {
    let diagnostics = this.getDiagnostics(diagnosticItems)
    if (this.equalDiagnostics(diagnosticItems)) return
    let sequence = this.sequence = new CallSequence()
    sequence.addFunction(async () => {
      let valid = await this.nvim.call('coc#util#valid_state')
      return valid ? false : true
    })
    this.nvim.pauseNotification()
    sequence.addFunction(this.setDiagnosticInfo.bind(this, diagnostics))
    sequence.addFunction(this.addVTextDiagnostics.bind(this, diagnostics))
    sequence.addFunction(this.setLocationlist.bind(this, diagnostics))
    sequence.addFunction(this.addSigns.bind(this, diagnostics))
    sequence.addFunction(this.addHighlight.bind(this, diagnostics))
    sequence.start().then(canceled => {
      this.nvim.resumeNotification(canceled)
      if (this.isVim) this.nvim.command('redraw', true)
      if (!canceled) {
        this._diagnosticItems = diagnosticItems
      }
    }, e => {
      logger.error(e)
    })
  }

  private equalDiagnostics(diagnosticItems: DiagnosticItems): boolean {
    for (let key of Object.keys(diagnosticItems)) {
      let diagnostics = diagnosticItems[key]
      let curr = this._diagnosticItems[key]
      if ((diagnostics == null || diagnostics.length == 0) && (!curr || curr.length == 0)) {
        continue
      }
      if (!equals(diagnostics, curr)) {
        return false
      }
    }
    return true
  }

  public async setLocationlist(diagnostics: Diagnostic[]): Promise<void> {
    if (!this.config.locationlist) return
    let { nvim, bufnr } = this
    let winid = await nvim.call('bufwinid', bufnr) as number
    // not shown
    if (winid == -1) return
    let items: LocationListItem[] = []
    for (let diagnostic of diagnostics) {
      let item = getLocationListItem(diagnostic.source, bufnr, diagnostic)
      items.push(item)
    }
    let curr = await nvim.call('getloclist', [winid, { title: 1 }])
    let action = (curr.title && curr.title.indexOf('Diagnostics of coc') != -1) ? 'r' : ' '
    nvim.call('setloclist', [winid, [], action, { title: 'Diagnostics of coc', items }], true)
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

  public addSigns(diagnostics: Diagnostic[]): void {
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

  public async setDiagnosticInfo(diagnostics: Diagnostic[]): Promise<void> {
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
    let bufnr = await this.nvim.call('bufnr', '%')
    if (!workspace.getDocument(this.bufnr)) return
    if (bufnr == this.bufnr) this.nvim.command('redraws', true)
    this.nvim.command('silent doautocmd User CocDiagnosticChange', true)
  }

  // Add a virtual text diagnostic if in neovim
  private async addVTextDiagnostics(diagnostics: Diagnostic[]) {
    if (this.isVim || !this.config.virtualText) {
      return
    }

    let { bufnr, nvim, vTextNameSpace } = this
    let newVTextNameSpace = await workspace.createNameSpace();

    for (let diagnostic of diagnostics) {
      let setVirtualText = (highlight:String) => {
          nvim.call("nvim_buf_set_virtual_text", [bufnr, newVTextNameSpace, diagnostic.range.start.line, [[diagnostic.message, highlight]], {}])
      }
      switch (diagnostic.severity) {
        case DiagnosticSeverity.Warning:
          setVirtualText("CocWarningSign")
          break
        case DiagnosticSeverity.Information:
          setVirtualText("CocInfoSign")
          break
        case DiagnosticSeverity.Hint:
          setVirtualText("CocHintSign")
          break
        default: {
          setVirtualText("CocErrorSign")
        }
      }
    }
    let buffer = this.nvim.createBuffer(bufnr)
    buffer.clearNamespace(vTextNameSpace)
    this.vTextNameSpace = newVTextNameSpace
  }

  public async clearHighlight(): Promise<void> {
    let { bufnr, nvim, matchIds } = this
    if (this.isVim) {
      await nvim.call('coc#util#clearmatches', [bufnr, Array.from(matchIds)])
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

  public async addHighlight(diagnostics: Diagnostic[]): Promise<void> {
    await this.clearHighlight()
    if (diagnostics.length == 0) return
    let winid = await this.nvim.call('bufwinid', this.bufnr) as number
    if (winid == -1 && this.isVim) return
    for (let diagnostic of diagnostics.reverse()) {
      let { range, severity } = diagnostic
      if (this.isVim) {
        await this.addHighlightVim(winid, range, severity)
      } else {
        await this.addHighlightNvim(range, severity)
      }
    }
  }

  private async addHighlightNvim(range: Range, severity: DiagnosticSeverity): Promise<void> {
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
      await buffer.addHighlight({
        srcId,
        hlGroup: getNameFromSeverity(severity) + 'Highlight',
        line: i,
        colStart: s == 0 ? 0 : byteIndex(line, s),
        colEnd: e == -1 ? -1 : byteIndex(line, e),
      })
    }
    this.matchIds.add(srcId)
  }

  private async addHighlightVim(winid: number, range: Range, severity: DiagnosticSeverity): Promise<void> {
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
      let id = await workspace.nvim.call('matchaddpos', [getNameFromSeverity(severity) + 'highlight', list, 99, -1, { window: winid }])
      matchIds.add(id)
    } catch (e) {
      logger.error(e.stack)
    }
  }

  private getDiagnostics(diagnosticItems: DiagnosticItems): Diagnostic[] {
    let res: Diagnostic[] = []
    for (let owner of Object.keys(diagnosticItems)) {
      for (let diagnostic of diagnosticItems[owner]) {
        res.push(diagnostic)
      }
    }
    res.sort((a, b) => {
      if (a.severity == b.severity) {
        return a.range.start.line - b.range.start.line
      }
      return a.severity - b.severity
    })
    return res
  }

  /**
   * Used on buffer unload
   *
   * @public
   * @returns {Promise<void>}
   */
  public async clear(): Promise<void> {
    let info = { error: 0, warning: 0, information: 0, hint: 0 }
    if (this.sequence) {
      await this.sequence.cancel()
    }
    let buffer = this.nvim.createBuffer(this.bufnr)
    buffer.setVar('coc_diagnostic_info', info, true)
    let bufnr = await this.nvim.call('bufnr', '%')
    if (bufnr == this.bufnr) this.nvim.command('redraws', true)
    await this.clearHighlight()
    this.clearSigns()
    // clear locationlist
    if (this.config.locationlist) {
      let winid = await this.nvim.call('bufwinid', bufnr) as number
      // not shown
      if (winid == -1) return
      let curr = await this.nvim.call('getloclist', [winid, { title: 1 }])
      if ((curr.title && curr.title.indexOf('Diagnostics of coc') != -1)) {
        this.nvim.call('setloclist', [winid, [], 'f'], true)
      }
    }
    this.nvim.command('silent doautocmd User CocDiagnosticChange', true)
  }

  public hasMatch(match: number): boolean {
    return this.matchIds.has(match)
  }
}
