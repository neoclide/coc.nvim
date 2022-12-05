'use strict'
import type { Neovim } from '@chemzqm/neovim'
import { Diagnostic, DiagnosticSeverity, DiagnosticTag, Location, Position, Range, TextDocumentIdentifier } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import commands from '../commands'
import events from '../events'
import BufferSync from '../model/bufferSync'
import { disposeAll } from '../util'
import { isFalsyOrEmpty } from '../util/array'
import { isVim } from '../util/constants'
import { readFileLines } from '../util/fs'
import { comparePosition, rangeIntersect } from '../util/position'
import { Disposable, Emitter, Event } from '../util/protocol'
import { byteIndex } from '../util/string'
import window from '../window'
import workspace from '../workspace'
import { DiagnosticBuffer } from './buffer'
import DiagnosticCollection from './collection'
import { getSeverityName, severityLevel } from './util'

export interface DiagnosticEventParams {
  bufnr: number
  uri: string
  diagnostics: ReadonlyArray<Diagnostic>
}

interface DiagnosticSignConfig {
  messageDelay?: number
  errorSign?: string
  warningSign?: string
  infoSing?: string
  hintSign?: string
  enableHighlightLineNumber?: boolean
}

export interface DiagnosticItem {
  file: string
  lnum: number
  end_lnum: number
  col: number
  end_col: number
  source: string
  code: string | number
  message: string
  severity: string
  level: number
  location: Location
}

interface PrepareResult {
  item: DiagnosticBuffer
  wrapscan: boolean
  ranges: ReadonlyArray<Range>
  curpos: Position
}

class DiagnosticManager implements Disposable {
  private readonly _onDidRefresh = new Emitter<DiagnosticEventParams>()
  public readonly onDidRefresh: Event<DiagnosticEventParams> = this._onDidRefresh.event
  private enabled = true
  private buffers: BufferSync<DiagnosticBuffer> | undefined
  private collections: DiagnosticCollection[] = []
  private disposables: Disposable[] = []
  private messageTimer: NodeJS.Timeout

  public init(): void {
    commands.register({
      id: 'workspace.diagnosticRelated',
      execute: () => this.jumpRelated()
    }, false, 'jump to related locations of current diagnostic.')
    this.defineSigns(workspace.initialConfiguration.get<DiagnosticSignConfig>('diagnostic'))
    this.buffers = workspace.registerBufferSync(doc => {
      let buf = new DiagnosticBuffer(this.nvim, doc)
      buf.onDidRefresh(diagnostics => {
        this._onDidRefresh.fire({ diagnostics, uri: buf.uri, bufnr: buf.bufnr })
      })
      let diagnostics = this.getDiagnostics(buf)
      // ignore empty diagnostics on first time.
      if (Object.keys(diagnostics).length > 0 && buf.config.autoRefresh) {
        void buf.reset(diagnostics)
      }
      return buf
    })
    workspace.onDidChangeConfiguration(e => {
      if (this.buffers && e.affectsConfiguration('diagnostic')) {
        for (let item of this.buffers.items) {
          item.loadConfiguration()
        }
      }
    }, null, this.disposables)
    let config = workspace.initialConfiguration.get<any>('diagnostic')
    events.on('CursorMoved', (bufnr, cursor) => {
      if (this.messageTimer) clearTimeout(this.messageTimer)
      this.messageTimer = setTimeout(() => {
        let buf = this.buffers.getItem(bufnr)
        if (buf == null || buf.dirty) return
        void Promise.allSettled([
          buf.onCursorHold(cursor[0], cursor[1]),
          buf.showVirtualTextCurrentLine(cursor[0])])
      }, config.messageDelay)
    }, null, this.disposables)
    events.on(['InsertEnter', 'BufEnter'], () => {
      clearTimeout(this.messageTimer)
    }, null, this.disposables)
    events.on('InsertLeave', bufnr => {
      let buf = this.buffers.getItem(bufnr)
      if (!buf || buf.config.refreshOnInsertMode) return
      for (let buf of this.buffers.items) {
        buf.refreshHighlights()
      }
    }, null, this.disposables)
    events.on('BufWinEnter', (bufnr: number) => {
      let buf = this.buffers.getItem(bufnr)
      if (buf) buf.refreshHighlights()
    }, null, this.disposables)
    this.checkConfigurationErrors()
    workspace.configurations.onError(ev => {
      const collection = this.create('config')
      collection.set(ev.uri, ev.diagnostics)
    }, null, this.disposables)
  }

  public checkConfigurationErrors(): void {
    const errors = workspace.configurations.errors
    if (!isFalsyOrEmpty(errors)) {
      const collection = this.create('config')
      for (let [uri, diagnostics] of errors.entries()) {
        let fsPath = URI.parse(uri).fsPath
        void window.showErrorMessage(`Error detected for config file ${fsPath}, please check diagnostics list.`)
        collection.set(uri, diagnostics)
      }
    }
  }

  public defineSigns(config: DiagnosticSignConfig): void {
    let { nvim } = this
    nvim.pauseNotification()
    for (let kind of ['Error', 'Warning', 'Info', 'Hint']) {
      let cmd = `sign define Coc${kind} linehl=Coc${kind}Line`
      let signText = config[kind.toLowerCase() + 'Sign']
      if (signText) cmd += ` texthl=Coc${kind}Sign text=${signText}`
      if (!isVim && config.enableHighlightLineNumber) cmd += ` numhl=Coc${kind}Sign`
      nvim.command(cmd, true)
    }
    nvim.resumeNotification(false, true)
  }

  public getItem(bufnr: number): DiagnosticBuffer | undefined {
    return this.buffers.getItem(bufnr)
  }

  /**
   * Fill location list with diagnostics
   */
  public async setLocationlist(bufnr: number): Promise<void> {
    let doc = workspace.getAttachedDocument(bufnr)
    let buf = this.buffers.getItem(doc.bufnr)
    let diagnostics: Diagnostic[] = []
    for (let diags of Object.values(this.getDiagnostics(buf))) {
      diagnostics.push(...diags)
    }
    let items = buf.toLocationListItems(diagnostics)
    await this.nvim.call('coc#ui#setloclist', [0, items, ' ', 'Diagnostics of coc'])
  }

  /**
   * Create collection by name
   */
  public create(name: string): DiagnosticCollection {
    let collection = this.getCollectionByName(name)
    if (collection) return collection
    collection = new DiagnosticCollection(name, () => {
      let idx = this.collections.findIndex(o => o == collection)
      if (idx !== -1) this.collections.splice(idx, 1)
    })
    this.collections.push(collection)
    collection.onDidDiagnosticsChange(uri => {
      let buf = this.buffers?.getItem(uri)
      if (buf && buf.config.autoRefresh) void buf.update(name, this.getDiagnosticsByCollection(buf, collection))
    })
    return collection
  }

  /**
   * Get diagnostics ranges from document
   */
  public getSortedRanges(uri: string, minLevel: number | undefined, severity?: string): Range[] {
    let collections = this.getCollections(uri)
    let res: Range[] = []
    let level = severity ? severityLevel(severity) : 0
    for (let collection of collections) {
      let diagnostics = collection.get(uri)
      if (level) {
        diagnostics = diagnostics.filter(o => o.severity == level)
      } else {
        if (minLevel && minLevel < DiagnosticSeverity.Hint) {
          diagnostics = diagnostics.filter(o => {
            return o.severity && o.severity > minLevel ? false : true
          })
        }
      }
      let ranges = diagnostics.map(o => o.range)
      res.push(...ranges)
    }
    res.sort((a, b) => {
      if (a.start.line != b.start.line) {
        return a.start.line - b.start.line
      }
      return a.start.character - b.start.character
    })
    return res
  }

  /**
   * Get readonly diagnostics for a buffer
   */
  public getDiagnostics(buf: DiagnosticBuffer): { [collection: string]: Diagnostic[] } {
    let res: { [collection: string]: Diagnostic[] } = {}
    for (let collection of this.collections) {
      if (!collection.has(buf.uri)) continue
      res[collection.name] = this.getDiagnosticsByCollection(buf, collection)
    }
    return res
  }

  /**
   * Get filtered diagnostics by collection.
   */
  public getDiagnosticsByCollection(buf: DiagnosticBuffer, collection: DiagnosticCollection): Diagnostic[] {
    // let config = this.buffers.getItem(uri)
    let { level, showUnused, showDeprecated } = buf.config
    let items = collection.get(buf.uri) ?? []
    if (items.length) {
      items = items.filter(d => {
        if (level && d.severity && d.severity > level) {
          return false
        }
        if (!showUnused && d.tags?.includes(DiagnosticTag.Unnecessary)) {
          return false
        }
        if (!showDeprecated && d.tags?.includes(DiagnosticTag.Deprecated)) {
          return false
        }
        return true
      })
      items.sort((a, b) => {
        return comparePosition(a.range.start, b.range.start)
      })
    }
    return items
  }

  public getDiagnosticsInRange(document: TextDocumentIdentifier, range: Range): Diagnostic[] {
    let res: Diagnostic[] = []
    for (let collection of this.collections) {
      for (let item of collection.get(document.uri) ?? []) {
        if (rangeIntersect(item.range, range)) {
          res.push(item)
        }
      }
    }
    return res
  }

  /**
   * Show diagnostics under curosr in preview window
   */
  public async preview(): Promise<void> {
    let diagnostics = await this.getCurrentDiagnostics()
    if (diagnostics.length == 0) {
      this.nvim.command('pclose', true)
      return
    }
    let lines: string[] = []
    for (let diagnostic of diagnostics) {
      let { source, code, severity, message } = diagnostic
      let s = getSeverityName(severity)[0]
      lines.push(`[${source}${code ? ' ' + code : ''}] [${s}]`)
      lines.push(...message.split(/\r?\n/))
      lines.push('')
    }
    this.nvim.call('coc#ui#preview_info', [lines, 'txt'], true)
  }

  private async prepareJump(severity?: string): Promise<PrepareResult | undefined> {
    let bufnr = await this.nvim.call('bufnr', ['%']) as number
    let item = this.buffers.getItem(bufnr)
    if (!item) return
    let ranges = this.getSortedRanges(item.uri, item.config.level, severity)
    if (isFalsyOrEmpty(ranges)) return
    let curpos = await window.getCursorPosition()
    let wrapscan = await this.nvim.getOption('wrapscan')
    return {
      item,
      curpos,
      wrapscan: wrapscan != 0,
      ranges
    }
  }

  /**
   * Jump to previous diagnostic position
   */
  public async jumpPrevious(severity?: string): Promise<void> {
    let result = await this.prepareJump(severity)
    if (!result) return
    let { curpos, item, wrapscan, ranges } = result
    let pos: Position
    for (let i = ranges.length - 1; i >= 0; i--) {
      let end = ranges[i].end
      if (comparePosition(end, curpos) < 0) {
        pos = ranges[i].start
        break
      }
    }
    if (!pos && wrapscan) pos = ranges[ranges.length - 1].start
    if (pos) {
      await window.moveTo(pos)
      await item.echoMessage(false, pos)
    } else {
      void window.showWarningMessage(`No more diagnostic before cursor position`)
    }
  }

  /**
   * Jump to next diagnostic position
   */
  public async jumpNext(severity?: string): Promise<void> {
    let result = await this.prepareJump(severity)
    if (!result) return
    let { curpos, item, wrapscan, ranges } = result
    let pos: Position
    for (let i = 0; i <= ranges.length - 1; i++) {
      let start = ranges[i].start
      if (comparePosition(start, curpos) > 0) {
        // The position could be invalid (ex: exceed end of line)
        let arr = await this.nvim.call('coc#util#valid_position', [start.line, start.character])
        if ((arr[0] != start.line || arr[1] != start.character)
          && comparePosition(Position.create(arr[0], arr[1]), curpos) <= 0) {
          continue
        }
        pos = Position.create(arr[0], arr[1])
        break
      }
    }
    if (!pos && wrapscan) pos = ranges[0].start
    if (pos) {
      await window.moveTo(pos)
      await item.echoMessage(false, pos)
    } else {
      void window.showWarningMessage(`No more diagnostic after cursor position`)
    }
  }

  /**
   * Get all sorted diagnostics
   */
  public async getDiagnosticList(): Promise<DiagnosticItem[]> {
    let res: DiagnosticItem[] = []
    let config = workspace.getConfiguration('diagnostic')
    let level = severityLevel(config.get<string>('level', 'hint'))
    for (let collection of this.collections) {
      for (let [uri, diagnostics] of collection.entries()) {
        if (diagnostics.length == 0) continue
        let u = URI.parse(uri)
        let doc = workspace.getDocument(uri)
        let lines = doc && doc.attached ? doc.textDocument.lines : undefined
        if (!lines && u.scheme === 'file') {
          try {
            const max = diagnostics.reduce((p, c) => {
              return Math.max(c.range.end.line, p)
            }, 0)
            lines = await readFileLines(u.fsPath, 0, max)
          } catch (e) {}
        }
        for (let diagnostic of diagnostics) {
          if (diagnostic.severity && diagnostic.severity > level) continue
          let { start, end } = diagnostic.range
          let o: DiagnosticItem = {
            file: u.fsPath,
            lnum: start.line + 1,
            end_lnum: end.line + 1,
            col: Array.isArray(lines) ? byteIndex(lines[start.line] ?? '', start.character) + 1 : start.character + 1,
            end_col: Array.isArray(lines) ? byteIndex(lines[end.line] ?? '', end.character) + 1 : end.character + 1,
            code: diagnostic.code,
            source: diagnostic.source ?? collection.name,
            message: diagnostic.message,
            severity: getSeverityName(diagnostic.severity),
            level: diagnostic.severity ?? 0,
            location: Location.create(uri, diagnostic.range)
          }
          res.push(o)
        }
      }
    }
    res.sort((a, b) => {
      if (a.level !== b.level) {
        return a.level - b.level
      }
      if (a.file !== b.file) {
        return a.file > b.file ? 1 : -1
      } else {
        if (a.lnum != b.lnum) {
          return a.lnum - b.lnum
        }
        return a.col - b.col
      }
    })
    return res
  }

  private async getBufferAndPosition(): Promise<[DiagnosticBuffer, Position] | undefined> {
    let [bufnr, lnum, col] = await this.nvim.eval(`[bufnr("%"),line('.'),col('.')]`) as [number, number, number]
    let item = this.buffers.getItem(bufnr)
    if (!item) return
    let pos = item.doc.getPosition(lnum, col)
    return [item, pos]
  }

  public async getCurrentDiagnostics(): Promise<Diagnostic[] | undefined> {
    let res = await this.getBufferAndPosition()
    if (!res) return
    return res[0].getDiagnosticsAtPosition(res[1])
  }

  public async echoCurrentMessage(): Promise<void> {
    let res = await this.getBufferAndPosition()
    if (!res) return
    let [item, position] = res
    await item.echoMessage(false, position)
  }

  public async jumpRelated(): Promise<void> {
    let diagnostics = await this.getCurrentDiagnostics()
    let diagnostic = diagnostics.find(o => o.relatedInformation != null)
    let locations = diagnostic ? diagnostic.relatedInformation.map(o => o.location) : []
    if (locations.length == 1) {
      await workspace.jumpTo(locations[0].uri, locations[0].range.start)
    } else if (locations.length > 1) {
      await workspace.showLocations(locations)
    } else {
      void window.showWarningMessage('No related information found.')
    }
  }

  public reset(): void {
    clearTimeout(this.messageTimer)
    this.buffers.reset()
    for (let collection of this.collections) {
      collection.dispose()
    }
    this.collections = []
  }

  public dispose(): void {
    clearTimeout(this.messageTimer)
    this.buffers.dispose()
    for (let collection of this.collections) {
      collection.dispose()
    }
    this.collections = []
    disposeAll(this.disposables)
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  public getCollectionByName(name: string): DiagnosticCollection {
    return this.collections.find(o => o.name == name)
  }

  private getCollections(uri: string): DiagnosticCollection[] {
    return this.collections.filter(c => c.has(uri))
  }

  public async toggleDiagnostic(enable?: number): Promise<void> {
    this.enabled = enable == undefined ? !this.enabled : enable != 0
    await Promise.allSettled(this.buffers.items.map(buf => {
      return buf.setState(this.enabled)
    }))
  }

  public async toggleDiagnosticBuffer(bufnr?: number, enable?: number): Promise<void> {
    bufnr = bufnr ?? workspace.bufnr
    let buf = this.buffers.getItem(bufnr)
    if (buf) {
      let isEnabled = enable == undefined ? await buf.isEnabled() : enable == 0
      await this.nvim.call('setbufvar', [bufnr, 'coc_diagnostic_disable', isEnabled ? 1 : 0])
      await buf.setState(!isEnabled)
    }
  }

  /**
   * Refresh diagnostics by uri or bufnr
   */
  public async refreshBuffer(uri: string | number): Promise<boolean> {
    let buf = this.buffers.getItem(uri)
    if (!buf) return false
    await buf.reset(this.getDiagnostics(buf))
    return true
  }

  /**
   * Force diagnostics refresh.
   */
  public async refresh(bufnr?: number): Promise<void> {
    let items: Iterable<DiagnosticBuffer>
    if (!bufnr) {
      items = this.buffers.items
    } else {
      let item = this.buffers.getItem(bufnr)
      items = item ? [item] : []
    }
    for (let item of items) {
      await this.refreshBuffer(item.uri)
    }
  }
}

export default new DiagnosticManager()
