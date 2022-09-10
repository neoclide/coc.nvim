'use strict'
import { Buffer, Neovim } from '@chemzqm/neovim'
import { debounce } from 'debounce'
import { Diagnostic, DiagnosticSeverity, Emitter, Event, Position, TextEdit } from 'vscode-languageserver-protocol'
import events from '../events'
import { SyncItem } from '../model/bufferSync'
import Document from '../model/document'
import { DidChangeTextDocumentParams, Documentation, FloatFactory, HighlightItem, LocationListItem, VirtualTextOption } from '../types'
import { lineInRange, positionInRange } from '../util/position'
import window from '../window'
import workspace from '../workspace'
import { adjustDiagnostics, DiagnosticConfig, formatDiagnostic, getHighlightGroup, getLocationListItem, getNameFromSeverity, getSeverityType, severityLevel, sortDiagnostics } from './util'
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

interface SignItem {
  name: string
  lnum: number
  priority?: number
}

const delay = global.__TEST__ ? 10 : 300
const aleMethod = global.__TEST__ ? 'MockAleResults' : 'ale#other_source#ShowResults'
let virtualTextSrcId: number | undefined

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
  private _disposed = false
  private _dirty = false
  private _changeTs = 0
  private _config: DiagnosticConfig
  public refreshHighlights: Function & { clear(): void }
  private readonly _onDidRefresh = new Emitter<ReadonlyArray<Diagnostic>>()
  public readonly onDidRefresh: Event<ReadonlyArray<Diagnostic>> = this._onDidRefresh.event
  constructor(
    private readonly nvim: Neovim,
    public readonly doc: Document,
    private floatFactory?: FloatFactory
  ) {
    this.loadConfiguration()
    this.refreshHighlights = debounce(this._refresh.bind(this), delay)
  }

  public get config(): Readonly<DiagnosticConfig> {
    return this._config
  }

  public loadConfiguration(): void {
    let config = workspace.getConfiguration('diagnostic', this.doc)
    let changed = this._config && config.enable != this._config.enable
    this._config = {
      enable: config.get<boolean>('enable', true),
      floatConfig: config.get('floatConfig', {}),
      messageTarget: config.get<string>('messageTarget', 'float'),
      enableHighlightLineNumber: config.get<boolean>('enableHighlightLineNumber', true),
      highlightLimit: config.get<number>('highlightLimit', 1000),
      highlightPriority: config.get<number>('highlightPriority'),
      autoRefresh: config.get<boolean>('autoRefresh', true),
      checkCurrentLine: config.get<boolean>('checkCurrentLine', false),
      enableSign: workspace.env.sign && config.get<boolean>('enableSign', true),
      locationlistUpdate: config.get<boolean>('locationlistUpdate', true),
      enableMessage: config.get<string>('enableMessage', 'always'),
      virtualText: config.get<boolean>('virtualText', false),
      virtualTextAlign: config.get<VirtualTextOption['text_align']>('virtualTextAlign', 'after'),
      virtualTextWinCol: workspace.has('nvim-0.5.1') ? config.get<number | null>('virtualTextWinCol', null) : null,
      virtualTextCurrentLineOnly: config.get<boolean>('virtualTextCurrentLineOnly'),
      virtualTextPrefix: config.get<string>('virtualTextPrefix', " "),
      virtualTextFormat: config.get<string>('virtualTextFormat', "%message"),
      virtualTextLimitInOneLine: config.get<number>('virtualTextLimitInOneLine', 999),
      virtualTextLineSeparator: config.get<string>('virtualTextLineSeparator', " \\ "),
      virtualTextLines: config.get<number>('virtualTextLines', 3),
      displayByAle: config.get<boolean>('displayByAle', false),
      level: severityLevel(config.get<string>('level', 'hint')),
      locationlistLevel: severityLevel(config.get<string>('locationlistLevel')),
      signLevel: severityLevel(config.get<string>('signLevel')),
      virtualTextLevel: severityLevel(config.get<string>('virtualTextLevel')),
      messageLevel: severityLevel(config.get<string>('messageLevel')),
      signPriority: config.get<number>('signPriority', 10),
      refreshOnInsertMode: config.get<boolean>('refreshOnInsertMode', false),
      filetypeMap: config.get<object>('filetypeMap', {}),
      showUnused: config.get<boolean>('showUnused', true),
      showDeprecated: config.get<boolean>('showDeprecated', true),
      format: config.get<string>('format', '[%source%code] [%severity] %message'),
    }
    if (this._config.virtualText && !virtualTextSrcId) {
      void this.nvim.createNamespace('coc-diagnostic-virtualText').then(id => {
        virtualTextSrcId = id
      })
    }
    if (changed) {
      if (this.config.enable) {
        void this._refresh()
      } else {
        this.clear()
      }
    }
  }

  public async setState(enable: boolean): Promise<void> {
    let curr = this._config.enable
    if (curr == enable) return
    this._config.enable = enable
    if (enable) {
      await this._refresh()
    } else {
      this.clear()
    }
  }

  public get dirty(): boolean {
    return this._dirty
  }

  public get bufnr(): number {
    return this.doc.bufnr
  }

  public get uri(): string {
    return this.doc.uri
  }

  public onChange(e: DidChangeTextDocumentParams): void {
    let changes = e.contentChanges
    if (changes.length > 0) {
      this._changeTs = Date.now()
      let edit = TextEdit.replace(changes[0].range, changes[0].text)
      for (let [collection, diagnostics] of this.diagnosticsMap.entries()) {
        let arr = adjustDiagnostics(diagnostics, edit)
        this.diagnosticsMap.set(collection, arr)
      }
    }
    if (!this.config.autoRefresh) return
    this.refreshHighlights()
  }

  public onTextChange(): void {
    this._dirty = true
    this.refreshHighlights.clear()
  }

  private get displayByAle(): boolean {
    return this._config.displayByAle
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
   * Update diagnostics when diagnostics change on collection.
   *
   * @param {string} collection
   * @param {Diagnostic[]} diagnostics
   */
  public async update(collection: string, diagnostics: ReadonlyArray<Diagnostic>): Promise<void> {
    let { diagnosticsMap } = this
    let curr = diagnosticsMap.get(collection) || []
    if (!this._dirty && diagnostics.length == 0 && curr.length == 0) return
    diagnosticsMap.set(collection, diagnostics)
    void this.checkFloat()
    if (!this.config.enable || this._dirty || Date.now() - this._changeTs < delay) {
      this._dirty = true
      return
    }
    let info = await this.getDiagnosticInfo()
    // avoid highlights on invalid state or buffer hidden.
    if (this._dirty || !info || info.winid == -1) {
      this._dirty = true
      return
    }
    let map: Map<string, ReadonlyArray<Diagnostic>> = new Map()
    map.set(collection, diagnostics)
    this.refresh(map, info)
  }

  private async checkFloat(): Promise<void> {
    if (workspace.bufnr != this.bufnr) return
    let pos = await window.getCursorPosition()
    let diagnostics = this.getDiagnosticsAtPosition(pos)
    if (diagnostics.length == 0 && this.floatFactory) {
      this.floatFactory.close()
    }
  }

  /**
   * Reset all diagnostics of current buffer
   */
  public async reset(diagnostics: { [collection: string]: Diagnostic[] }, force?: boolean): Promise<void> {
    this._changeTs = Date.now()
    let { diagnosticsMap } = this
    for (let key of diagnosticsMap.keys()) {
      // make sure clear collection when it's empty.
      if (diagnostics[key] == null) diagnostics[key] = []
    }
    for (let [key, value] of Object.entries(diagnostics)) {
      this.diagnosticsMap.set(key, value)
    }
    let info = await this.getDiagnosticInfo(force)
    if (!info || !this.config.enable) {
      this._dirty = true
      return
    }
    this.refresh(this.diagnosticsMap, info)
  }

  /**
   * Echo diagnostic message under cursor.
   */
  public async echoMessage(truncate = false, position: Position): Promise<boolean> {
    const config = this.config
    if (!config.enable || config.enableMessage === 'never' || config.displayByAle) return false
    let useFloat = config.messageTarget == 'float'
    let diagnostics = this.getDiagnosticsAtPosition(position)
    if (config.messageLevel) {
      diagnostics = diagnostics.filter(diagnostic => {
        return diagnostic.severity && diagnostic.severity <= config.messageLevel
      })
    }
    if (useFloat) {
      await this.showFloat(diagnostics)
    } else {
      const lines = []
      diagnostics.forEach(diagnostic => {
        lines.push(formatDiagnostic(config.format, diagnostic))
      })
      if (lines.length) {
        await this.nvim.command('echo ""')
        await window.echoLines(lines, truncate)
      }
    }
    return true
  }

  public async showVirtualTextCurrentLine(lnum: number): Promise<boolean> {
    let { config } = this
    if (!config.virtualTextCurrentLineOnly || (events.insertMode && !config.refreshOnInsertMode)) return false
    let enabled = await this.isEnabled()
    if (!enabled) return false
    this.showVirtualText(lnum)
    return true
  }

  public async showFloat(diagnostics: Diagnostic[]): Promise<boolean> {
    if (this.config.messageTarget !== 'float' || !this.floatFactory) return false
    if (diagnostics.length == 0) {
      this.floatFactory.close()
      return false
    }
    if (events.insertMode) return false
    let config = this.config
    let ft = ''
    let docs: Documentation[] = []
    if (Object.keys(config.filetypeMap).length > 0) {
      let filetype = this.doc.filetype
      const defaultFiletype = config.filetypeMap['default'] || ''
      ft = config.filetypeMap[filetype] || (defaultFiletype == 'bufferType' ? filetype : defaultFiletype)
    }
    diagnostics.forEach(diagnostic => {
      let filetype = 'Error'
      if (ft === '') {
        switch (diagnostic.severity) {
          case DiagnosticSeverity.Hint:
            filetype = 'Hint'
            break
          case DiagnosticSeverity.Warning:
            filetype = 'Warning'
            break
          case DiagnosticSeverity.Information:
            filetype = 'Info'
            break
        }
      } else {
        filetype = ft
      }
      docs.push({ filetype, content: formatDiagnostic(config.format, diagnostic) })
      if (diagnostic.codeDescription?.href) {
        docs.push({ filetype: 'txt', content: diagnostic.codeDescription.href })
      }
    })
    await this.floatFactory.show(docs, this.config.floatConfig)
    return true
  }

  /**
   * Get buffer info needed for refresh.
   */
  private async getDiagnosticInfo(force?: boolean): Promise<DiagnosticInfo | undefined> {
    let { refreshOnInsertMode } = this._config
    let { nvim, bufnr } = this
    let checkInsert = !refreshOnInsertMode
    if (force) {
      checkInsert = false
    } else {
      let disabledByInsert = events.insertMode && !refreshOnInsertMode
      if (disabledByInsert) return undefined
    }
    return await nvim.call('coc#util#diagnostic_info', [bufnr, checkInsert])
  }

  /**
   * Refresh changed diagnostics to UI.
   */
  private refresh(diagnosticsMap: Map<string, ReadonlyArray<Diagnostic>>, info: DiagnosticInfo): void {
    let { nvim, displayByAle } = this
    this._dirty = false
    if (displayByAle) {
      nvim.pauseNotification()
      for (let [collection, diagnostics] of diagnosticsMap.entries()) {
        this.refreshAle(collection, diagnostics)
      }
      nvim.resumeNotification(true, true)
    } else {
      let emptyCollections: string[] = []
      nvim.pauseNotification()
      for (let [collection, diagnostics] of diagnosticsMap.entries()) {
        if (diagnostics.length == 0) emptyCollections.push(collection)
        this.addSigns(collection, diagnostics)
        this.updateHighlights(collection, diagnostics)
      }
      this.showVirtualText(info.lnum)
      this.updateLocationList(info.winid, info.locationlist)
      this.setDiagnosticInfo()
      nvim.resumeNotification(true, true)
      // cleanup unnecessary collections
      emptyCollections.forEach(name => {
        this.diagnosticsMap.delete(name)
      })
    }
    this._onDidRefresh.fire(this.diagnostics)
  }

  public updateLocationList(winid: number, title: string): void {
    if (!this._config.locationlistUpdate || winid == -1 || title !== 'Diagnostics of coc') return
    let items = this.toLocationListItems(this.diagnostics)
    this.nvim.call('setloclist', [winid, [], 'r', { title: 'Diagnostics of coc', items }], true)
  }

  public toLocationListItems(diagnostics: Diagnostic[]): LocationListItem[] {
    let { locationlistLevel } = this._config
    let items: LocationListItem[] = []
    let lines = this.doc.textDocument.lines
    diagnostics.sort(sortDiagnostics)
    for (let diagnostic of diagnostics) {
      if (locationlistLevel && diagnostic.severity && diagnostic.severity > locationlistLevel) continue
      items.push(getLocationListItem(this.bufnr, diagnostic, lines))
    }
    return items
  }

  public addSigns(collection: string, diagnostics: ReadonlyArray<Diagnostic>): void {
    let { enableSign, signLevel } = this._config
    if (!enableSign) return
    let group = signGroup + collection
    let signs: SignItem[] = []
    // this.buffer.unplaceSign({ group })
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
      let priority = this._config.signPriority + 4 - severity
      signs.push({ name: getNameFromSeverity(severity), lnum: line + 1, priority })
    }
    this.nvim.call('coc#ui#update_signs', [this.bufnr, group, signs], true)
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

  public showVirtualText(lnum: number): void {
    let { _config: config } = this
    let { virtualText, virtualTextLevel } = config
    if (!virtualText) return
    let { virtualTextPrefix, virtualTextLimitInOneLine, virtualTextCurrentLineOnly } = this._config
    let { diagnostics, buffer } = this
    if (virtualTextCurrentLineOnly) {
      diagnostics = diagnostics.filter(d => {
        let { start, end } = d.range
        return start.line <= lnum - 1 && end.line >= lnum - 1
      })
    }
    diagnostics.sort(sortDiagnostics)
    buffer.clearNamespace(virtualTextSrcId)
    let map: Map<number, [string, string][]> = new Map()
    let opts: VirtualTextOption = {}
    if (typeof config.virtualTextAlign === 'string') {
      opts.text_align = config.virtualTextAlign
    }
    if (typeof config.virtualTextWinCol === 'number') {
      opts.virt_text_win_col = config.virtualTextWinCol
    }
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
        .slice(0, this._config.virtualTextLines)
        .join(this._config.virtualTextLineSeparator)
      let arr = map.get(line) ?? []
      arr.unshift([virtualTextPrefix + formatDiagnostic(this._config.virtualTextFormat, {
        ...diagnostic,
        message: msg
      }), highlight])
      map.set(line, arr)
    }
    for (let [line, blocks] of map.entries()) {
      buffer.setVirtualText(virtualTextSrcId, line, blocks.slice(0, virtualTextLimitInOneLine), opts)
    }
  }

  public updateHighlights(collection: string, diagnostics: ReadonlyArray<Diagnostic>): void {
    if (!diagnostics.length) {
      this.clearHighlight(collection)
    } else {
      let items = this.getHighlightItems(diagnostics)
      let priority = this._config.highlightPriority
      this.buffer.updateHighlights(NAMESPACE + collection, items, { priority })
    }
  }

  /**
   * Refresh all diagnostics
   */
  private async _refresh(): Promise<void> {
    if (!this._dirty) return
    let info = await this.getDiagnosticInfo()
    let noHighlights = !info || info.winid == -1
    if (noHighlights) return
    this.refresh(this.diagnosticsMap, info)
  }

  public getHighlightItems(diagnostics: ReadonlyArray<Diagnostic>): HighlightItem[] {
    let doc = workspace.getDocument(this.uri)
    if (!doc) return []
    let res: HighlightItem[] = []
    for (let diagnostic of diagnostics.slice(0, this._config.highlightLimit)) {
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
    this._dirty = collections.length > 0
    this.refreshHighlights.clear()
    if (this.displayByAle) {
      for (let collection of collections) {
        this.nvim.call(aleMethod, [this.bufnr, collection, []], true)
      }
    } else {
      nvim.pauseNotification()
      this.buffer.deleteVar('coc_diagnostic_info')
      for (let collection of collections) {
        this.clearHighlight(collection)
        this.clearSigns(collection)
      }
      if (this._config.virtualText) {
        this.buffer.clearNamespace(virtualTextSrcId)
      }
      nvim.resumeNotification(true, true)
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

  public getDiagnosticsAtPosition(pos: Position): Diagnostic[] {
    let { config, doc } = this
    let res = this.getDiagnosticsAt(pos, config.checkCurrentLine)
    if (config.checkCurrentLine || res.length) return res
    // check next character when cursor at end of line.
    let total = doc.getline(pos.line).length
    if (pos.character + 1 == total) {
      res = this.getDiagnosticsAt(Position.create(pos.line, pos.character + 1), false)
      if (res.length) return res
    }
    // check next line when cursor at the beginning of last line.
    if (pos.line === doc.lineCount - 1 && pos.character == 0) {
      pos = Position.create(pos.line + 1, 0)
      res = this.getDiagnosticsAt(pos, true)
    }
    return res
  }

  public async isEnabled(): Promise<boolean> {
    if (this._disposed || !this.config.enable) return false
    let buf = this.nvim.createBuffer(this.bufnr)
    let res = await buf.getVar('coc_diagnostic_disable')
    return res != 1
  }

  public dispose(): void {
    this.clear()
    this.diagnosticsMap.clear()
    this._onDidRefresh.dispose()
    this._disposed = true
    this.refreshHighlights.clear()
  }
}
