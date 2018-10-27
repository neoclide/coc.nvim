import { Neovim } from '@chemzqm/neovim'
import { DiagnosticSeverity, Range } from 'vscode-languageserver-protocol'
import Document from '../model/document'
import { DiagnosticInfo, DiagnosticItems, LocationListItem } from '../types'
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
      }, 30)
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
    this.diagnosticItems = diagnosticItems
    this.setDiagnosticInfo()
    await this.setLocationlist()
    await this.clearHighlight()
    await this.addHighlight()
    await this.clearSigns()
    this.addSigns()
  }

  public async setLocationlist(): Promise<void> {
    if (!this.enableLoclist) return
    let { nvim, document, diagnosticItems } = this
    if (!document) return
    let { bufnr } = document
    let winid = await nvim.call('bufwinid', bufnr) as number
    // not shown
    if (winid == -1) return
    let items: LocationListItem[] = []
    for (let name of Object.keys(diagnosticItems)) {
      for (let diagnostic of diagnosticItems[name]) {
        let item = this.manager.getLocationListItem(name, bufnr, diagnostic)
        items.push(item)
      }
    }
    items.sort((a, b) => {
      if (a.lnum != b.lnum) {
        return a.lnum - b.lnum
      }
      return a.col - b.col
    })
    let curr = await nvim.call('getloclist', [winid, { title: 1 }])
    let action = (curr.title && curr.title.indexOf('Diagnostics of coc') != -1) ? 'r' : ' '
    await nvim.call('setloclist', [winid, [], action, { title: 'Diagnostics of coc', items }])
  }

  private async clearSigns(): Promise<void> {
    let { nvim, bufnr } = this
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
      if (severityNames.indexOf(name) != -1) {
        ids.push(id)
      }
    }
    nvim.call('coc#util#unplace_signs', [bufnr, ids], true)
  }

  private addSigns(): void {
    let { diagnosticItems, signId } = this
    let lines: Set<number> = new Set()
    for (let owner of Object.keys(diagnosticItems)) {
      for (let diagnostic of diagnosticItems[owner]) {
        let { range, severity } = diagnostic
        let line = range.start.line
        if (lines.has(line)) continue
        lines.add(line)
        this.addSign(signId, line, severity)
        signId = signId + 1
      }
    }
  }

  private addSign(signId: number, line: number, severity: DiagnosticSeverity): void {
    let { document, nvim } = this
    if (!document) return
    let { buffer } = document
    let name = getNameFromSeverity(severity)
    nvim.command(`sign place ${signId} line=${line + 1} name=${name} buffer=${buffer.id}`, true)
  }

  private setDiagnosticInfo(): void {
    let { document } = this
    if (!document) return
    let info = this.getDiagnosticInfo()
    document.buffer.setVar('coc_diagnostic_info', info, true)
    if (workspace.bufnr == this.bufnr) {
      this.nvim.command('redraws', true)
    }
  }

  private async clearHighlight(): Promise<void> {
    let { bufnr, nvim, matchIds } = this
    if (workspace.isNvim) {
      let { srcId } = this.manager
      let buffers = await nvim.buffers
      if (!buffers) return
      let buffer = buffers.find(buf => buf.id == bufnr)
      if (buffer) buffer.clearHighlight({ srcId })
    } else {
      if (workspace.bufnr != bufnr) return
      await nvim.call('coc#util#matchdelete', [Array.from(matchIds)])
      this.matchIds = new Set()
    }
  }

  private async addHighlight(): Promise<void> {
    let { diagnosticItems, nvim } = this
    let winid = await nvim.call('bufwinid', this.bufnr) as number
    if (winid == -1) return
    for (let owner of Object.keys(diagnosticItems)) {
      for (let diagnostic of diagnosticItems[owner]) {
        let { range, severity } = diagnostic
        if (workspace.isVim) {
          await this.addHighlightVim(winid, range, severity)
        } else {
          await this.addHighlightNvim(range, severity)
        }
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

  private getDiagnosticInfo(): DiagnosticInfo {
    let { diagnosticItems } = this
    let error = 0
    let warning = 0
    let information = 0
    let hint = 0
    for (let owner of Object.keys(diagnosticItems)) {
      let diagnostics = diagnosticItems[owner]
      for (let diagnostic of diagnostics) {
        switch (diagnostic.severity) {
          case DiagnosticSeverity.Error:
            error = error + 1
            break
          case DiagnosticSeverity.Warning:
            warning = warning + 1
            break
          case DiagnosticSeverity.Information:
            information = information + 1
            break
          case DiagnosticSeverity.Hint:
            hint = hint + 1
            break
          default:
            error = error + 1
        }
      }
    }
    return { error, warning, information, hint }
  }
}
