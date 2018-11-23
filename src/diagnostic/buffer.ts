import { NeovimClient as Neovim } from '@chemzqm/neovim'
import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver-protocol'
import Document from '../model/document'
import { DiagnosticItems, LocationListItem } from '../types'
import { equals } from '../util/object'
import { byteIndex, byteLength } from '../util/string'
import workspace from '../workspace'
import { DiagnosticManager } from './manager'
const logger = require('../util/logger')('diagnostic-buffer')

const severityNames = ['CocError', 'CocWarning', 'CocInfo', 'CocHint']

function getNameFromSeverity(severity: DiagnosticSeverity): string {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return 'CocError'
    case DiagnosticSeverity.Warning:
      return 'CocWarning'
    case DiagnosticSeverity.Information:
      return 'CocInfo'
    case DiagnosticSeverity.Hint:
      return 'CocHint'
    default:
      return 'CocError'
  }
}

// maintains sign and highlightId
export class DiagnosticBuffer {
  private matchIds: Set<number> = new Set()
  private signIds: Set<number> = new Set()
  private signId: number
  private diagnosticItems: DiagnosticItems = {}
  private promise: Promise<void> = Promise.resolve(void 0)
  public refresh: () => void

  constructor(public readonly bufnr: number, public readonly uri: string, private manager: DiagnosticManager) {
    this.signId = manager.config.signOffset || 1000
    let timer: NodeJS.Timer = null
    this.refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        this.promise = this.promise.then(() => {
          return this._refresh()
        }, e => {
          logger.error(e)
        })
      }, 100)
    }
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  private get document(): Document {
    return workspace.getDocument(this.uri)
  }

  private enableLoclist(): boolean {
    return this.manager.config.locationlist
  }

  private async _refresh(): Promise<void> {
    if (!this.manager.enabled) return
    if (this.manager.insertMode) return
    let diagnosticItems = this.manager.getBufferDiagnostic(this.uri)
    let diagnostics = this.getDiagnostics(diagnosticItems)
    if (equals(diagnosticItems, this.diagnosticItems)) {
      await this.setLocationlist(diagnostics)
      return
    }
    this.diagnosticItems = diagnosticItems
    this.setDiagnosticInfo(diagnostics)
    await this.setLocationlist(diagnostics)
    await this.addHighlight(diagnostics)
    await this.addSigns(diagnostics)
    await this.nvim.command('silent doautocmd User CocDiagnosticChange')
  }

  public async setLocationlist(diagnostics: Diagnostic[]): Promise<void> {
    if (!this.enableLoclist) return
    let { nvim, document } = this
    if (!document) return
    let { bufnr } = document
    let winid = await nvim.call('bufwinid', bufnr) as number
    // not shown
    if (winid == -1) return
    let items: LocationListItem[] = []
    for (let diagnostic of diagnostics) {
      let item = this.getLocationListItem(diagnostic.source, bufnr, diagnostic)
      items.push(item)
    }
    let curr = await nvim.call('getloclist', [winid, { title: 1 }])
    let action = (curr.title && curr.title.indexOf('Diagnostics of coc') != -1) ? 'r' : ' '
    await nvim.call('setloclist', [winid, [], action, { title: 'Diagnostics of coc', items }])
  }

  private async clearSigns(): Promise<void> {
    let { nvim, signIds, bufnr } = this
    await nvim.call('coc#util#unplace_signs', [bufnr, Array.from(signIds)])
  }

  public async checkSigns(): Promise<void> {
    let { nvim, bufnr, signIds } = this
    let buffers = await nvim.buffers
    if (!buffers) return
    let buffer = buffers.find(buf => buf.id == bufnr)
    if (!buffer) return
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
  }

  private async addSigns(diagnostics: Diagnostic[]): Promise<void> {
    await this.clearSigns()
    let { signId, signIds } = this
    signIds.clear()
    let lines: Set<number> = new Set()
    for (let diagnostic of diagnostics) {
      let { range, severity } = diagnostic
      let line = range.start.line
      if (lines.has(line)) continue
      lines.add(line)
      this.addSign(signId, line, severity)
      signIds.add(signId)
      signId = signId + 1
    }
  }

  private addSign(signId: number, line: number, severity: DiagnosticSeverity): void {
    let { document, nvim } = this
    if (!document) return
    let { buffer } = document
    let name = getNameFromSeverity(severity)
    nvim.command(`sign place ${signId} line=${line + 1} name=${name} buffer=${buffer.id}`, true)
  }

  private setDiagnosticInfo(diagnostics: Diagnostic[]): void {
    let { document } = this
    if (!document) return
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
    document.buffer.setVar('coc_diagnostic_info', info, true)
    if (workspace.bufnr == this.bufnr) {
      this.nvim.command('redraws', true)
    }
  }

  private async clearHighlight(): Promise<void> {
    let { bufnr, nvim, matchIds } = this
    if (workspace.isNvim) {
      let buffer = nvim.createBuffer(bufnr)
      for (let srcId of matchIds) {
        buffer.clearHighlight({ srcId })
      }
    } else {
      await nvim.call('coc#util#clearmatches', [bufnr, Array.from(matchIds)])
    }
    this.matchIds.clear()
  }

  private async addHighlight(diagnostics: Diagnostic[]): Promise<void> {
    await this.clearHighlight()
    let winid = await this.nvim.call('bufwinid', this.bufnr) as number
    if (winid == -1) return
    for (let diagnostic of diagnostics.reverse()) {
      let { range, severity } = diagnostic
      if (workspace.isVim) {
        await this.addHighlightVim(winid, range, severity)
      } else {
        await this.addHighlightNvim(range, severity)
      }
    }
  }

  private async addHighlightNvim(range: Range, severity: DiagnosticSeverity): Promise<void> {
    let { srcId } = this.manager
    let { start, end } = range
    let { document } = this
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
    let { document, matchIds } = this
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

  public getLocationListItem(owner: string, bufnr: number, diagnostic: Diagnostic): LocationListItem {
    let { start } = diagnostic.range
    let msg = diagnostic.message.split('\n')[0]
    let type = this.manager.getSeverityName(diagnostic.severity).slice(0, 1).toUpperCase()
    return {
      bufnr,
      lnum: start.line + 1,
      col: start.character + 1,
      text: `[${owner}${diagnostic.code ? ' ' + diagnostic.code : ''}] ${msg} [${type}]`,
      type
    }
  }
}
