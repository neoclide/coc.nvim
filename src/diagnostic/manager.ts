import { Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import semver from 'semver'
import { Diagnostic, DiagnosticSeverity, DiagnosticTag, Disposable, Location, Position, Range } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import events from '../events'
import Document from '../model/document'
import FloatFactory from '../model/floatFactory'
import { ConfigurationChangeEvent, DiagnosticItem, Documentation, LocationListItem } from '../types'
import { disposeAll } from '../util'
import { comparePosition, lineInRange, positionInRange, rangeIntersect } from '../util/position'
import workspace from '../workspace'
import window from '../window'
import { DiagnosticBuffer } from './buffer'
import DiagnosticCollection from './collection'
import { getSeverityName, getSeverityType, severityLevel, getLocationListItem } from './util'
const logger = require('../util/logger')('diagnostic-manager')

export interface DiagnosticConfig {
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
  refreshAfterSave: boolean
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

export class DiagnosticManager implements Disposable {
  public config: DiagnosticConfig
  public enabled = true
  private readonly buffers: Map<number, DiagnosticBuffer> = new Map()
  private lastMessage = ''
  private floatFactory: FloatFactory
  private collections: DiagnosticCollection[] = []
  private disposables: Disposable[] = []
  private timer: NodeJS.Timer

  public init(): void {
    this.setConfiguration()
    let { nvim } = workspace
    this.floatFactory = new FloatFactory(nvim)
    this.disposables.push(Disposable.create(() => {
      if (this.timer) clearTimeout(this.timer)
    }))
    events.on('CursorMoved', () => {
      if (this.config.enableMessage != 'always') return
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(async () => {
        await this.echoMessage(true)
      }, this.config.messageDelay)
    }, null, this.disposables)

    let fn = debounce((bufnr, cursor) => {
      if (!this.config.virtualText || !this.config.virtualTextCurrentLineOnly) {
        return
      }
      let buf = this.buffers.get(bufnr)
      if (buf) {
        let diagnostics = this.getDiagnostics(buf.uri)
        buf.showVirtualText(diagnostics, cursor[0])
      }
    }, 100)
    events.on('CursorMoved', fn, null, this.disposables)
    this.disposables.push(Disposable.create(() => {
      fn.clear()
    }))

    events.on('InsertEnter', () => {
      if (this.timer) clearTimeout(this.timer)
      this.floatFactory.close()
    }, null, this.disposables)

    events.on('InsertLeave', async bufnr => {
      this.floatFactory.close()
      if (!this.buffers.has(bufnr)) return
      let doc = workspace.getDocument(bufnr)
      if (!doc) return
      doc.forceSync()
      let { refreshOnInsertMode, refreshAfterSave } = this.config
      if (!refreshOnInsertMode && !refreshAfterSave) {
        this.refreshBuffer(doc.uri)
      }
    }, null, this.disposables)

    events.on('BufEnter', async () => {
      if (this.timer) clearTimeout(this.timer)
    }, null, this.disposables)

    events.on('BufWritePost', async bufnr => {
      let buf = this.buffers.get(bufnr)
      if (!buf) return
      if (!this.config.refreshAfterSave) return
      this.refreshBuffer(buf.uri)
    }, null, this.disposables)

    workspace.onDidChangeConfiguration(e => {
      this.setConfiguration(e)
    }, null, this.disposables)

    // create buffers
    for (let doc of workspace.documents) {
      this.createDiagnosticBuffer(doc)
    }
    workspace.onDidOpenTextDocument(textDocument => {
      let doc = workspace.getDocument(textDocument.uri)
      this.createDiagnosticBuffer(doc)
    }, null, this.disposables)
    workspace.onDidCloseTextDocument(({ uri }) => {
      let doc = workspace.getDocument(uri)
      if (!doc) return
      this.disposeBuffer(doc.bufnr)
    }, null, this.disposables)
    this.setConfigurationErrors(true)
    workspace.configurations.onError(() => {
      this.setConfigurationErrors()
    }, null, this.disposables)
  }

  private defineSigns(): void {
    let { nvim } = this
    let { enableHighlightLineNumber, enableSign } = this.config
    if (!enableSign) return
    nvim.pauseNotification()
    for (let kind of ['Error', 'Warning', 'Info', 'Hint']) {
      let signText = this.config[kind.toLowerCase() + 'Sign']
      let cmd = `sign define Coc${kind} linehl=Coc${kind}Line`
      if (signText) cmd += ` texthl=Coc${kind}Sign text=${signText}`
      if (enableHighlightLineNumber) cmd += ` numhl=Coc${kind}Sign`
      nvim.command(cmd, true)
    }
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    nvim.resumeNotification(false, true)
  }

  private createDiagnosticBuffer(doc: Document): void {
    if (!this.shouldValidate(doc)) return
    let { bufnr } = doc
    let buf = this.buffers.get(bufnr)
    if (buf) {
      buf.clear()
      buf.dispose()
    }
    buf = new DiagnosticBuffer(bufnr, doc.uri, this.config)
    this.buffers.set(bufnr, buf)
    if (this.enabled) {
      let diagnostics = this.getDiagnostics(buf.uri)
      if (diagnostics.length) buf.forceRefresh(diagnostics)
    }
    buf.onDidRefresh(() => {
      if (['never', 'jump'].includes(this.config.enableMessage)) {
        return
      }
      this.echoMessage(true).logError()
    })
  }

  public async setLocationlist(bufnr: number): Promise<void> {
    let buf = this.buffers.get(bufnr)
    let diagnostics = buf ? this.getDiagnostics(buf.uri) : []
    let items: LocationListItem[] = []
    for (let diagnostic of diagnostics) {
      let item = getLocationListItem(bufnr, diagnostic)
      items.push(item)
    }
    let curr = await this.nvim.call('getloclist', [0, { title: 1 }]) as any
    let action = curr.title && curr.title.indexOf('Diagnostics of coc') != -1 ? 'r' : ' '
    await this.nvim.call('setloclist', [0, [], action, { title: 'Diagnostics of coc', items }])
  }

  public setConfigurationErrors(init?: boolean): void {
    let collections = this.collections
    let collection = collections.find(o => o.name == 'config')
    if (!collection) {
      collection = this.create('config')
    } else {
      collection.clear()
    }
    let { errorItems } = workspace.configurations
    if (errorItems && errorItems.length) {
      if (init) window.showMessage(`settings file parse error, run ':CocList diagnostics'`, 'error')
      let entries: Map<string, Diagnostic[]> = new Map()
      for (let item of errorItems) {
        let { uri } = item.location
        let diagnostics: Diagnostic[] = entries.get(uri) || []
        diagnostics.push(Diagnostic.create(item.location.range, item.message, DiagnosticSeverity.Error))
        entries.set(uri, diagnostics)
      }
      collection.set(Array.from(entries))
    }
  }

  /**
   * Create collection by name
   */
  public create(name: string): DiagnosticCollection {
    let collection = new DiagnosticCollection(name)
    this.collections.push(collection)
    // Used for refresh diagnostics on buferEnter when refreshAfterSave is true
    // Note we can't make sure it work as expected when there're multiple sources
    let createTime = Date.now()
    let refreshed = false
    collection.onDidDiagnosticsChange(uri => {
      if (this.config.refreshAfterSave &&
        (refreshed || Date.now() - createTime > 5000)) return
      refreshed = true
      this.refreshBuffer(uri)
    })
    collection.onDidDiagnosticsClear(uris => {
      for (let uri of uris) {
        this.refreshBuffer(uri, true)
      }
    })
    collection.onDispose(() => {
      let idx = this.collections.findIndex(o => o == collection)
      if (idx !== -1) this.collections.splice(idx, 1)
    })
    return collection
  }

  /**
   * Get diagnostics ranges from document
   */
  public getSortedRanges(uri: string, severity?: string): Range[] {
    let collections = this.getCollections(uri)
    let res: Range[] = []
    let level = severity ? severityLevel(severity) : 0
    for (let collection of collections) {
      let diagnostics = collection.get(uri)
      if (level) diagnostics = diagnostics.filter(o => o.severity == level)
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
  public getDiagnostics(uri: string): Diagnostic[] {
    let collections = this.getCollections(uri)
    let { level, showUnused, showDeprecated } = this.config
    let res: Diagnostic[] = []
    for (let collection of collections) {
      let items = collection.get(uri)
      if (!items) continue

      items = items.filter(d => {
        if (level && level < DiagnosticSeverity.Hint && d.severity && d.severity > level) {
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

      res.push(...items)
    }
    res.sort((a, b) => {
      if (a.severity == b.severity) {
        let d = comparePosition(a.range.start, b.range.start)
        if (d != 0) return d
        if (a.source == b.source) return a.message > b.message ? 1 : -1
        return a.source > b.source ? 1 : -1
      }
      return a.severity - b.severity
    })
    return res
  }

  public getDiagnosticsInRange(document: TextDocument, range: Range): Diagnostic[] {
    let collections = this.getCollections(document.uri)
    let res: Diagnostic[] = []
    for (let collection of collections) {
      let items = collection.get(document.uri)
      if (!items) continue
      for (let item of items) {
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
    let [bufnr, cursor] = await this.nvim.eval('[bufnr("%"),coc#util#cursor()]') as [number, [number, number]]
    let { nvim } = this
    let diagnostics = this.getDiagnosticsAt(bufnr, cursor)
    if (diagnostics.length == 0) {
      nvim.command('pclose', true)
      window.showMessage(`Empty diagnostics`, 'warning')
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
    lines = lines.slice(0, -1)
    // let content = lines.join('\n').trim()
    nvim.call('coc#util#preview_info', [lines, 'txt'], true)
  }

  /**
   * Jump to previous diagnostic position
   */
  public async jumpPrevious(severity?: string): Promise<void> {
    let buffer = await this.nvim.buffer
    let document = workspace.getDocument(buffer.id)
    if (!document) return
    let offset = await window.getOffset()
    if (offset == null) return
    let ranges = this.getSortedRanges(document.uri, severity)
    if (ranges.length == 0) {
      window.showMessage('Empty diagnostics', 'warning')
      return
    }
    let { textDocument } = document
    let pos: Position
    for (let i = ranges.length - 1; i >= 0; i--) {
      if (textDocument.offsetAt(ranges[i].end) < offset) {
        pos = ranges[i].start
        break
      } else if (i == 0) {
        let wrapscan = await this.nvim.getOption('wrapscan')
        if (wrapscan) pos = ranges[ranges.length - 1].start
      }
    }
    if (pos) {
      await window.moveTo(pos)
      if (this.config.enableMessage == 'never') return
      await this.echoMessage(false)
    }
  }

  /**
   * Jump to next diagnostic position
   */
  public async jumpNext(severity?: string): Promise<void> {
    let buffer = await this.nvim.buffer
    let document = workspace.getDocument(buffer.id)
    let offset = await window.getOffset()
    let ranges = this.getSortedRanges(document.uri, severity)
    if (ranges.length == 0) {
      window.showMessage('Empty diagnostics', 'warning')
      return
    }
    let { textDocument } = document
    let pos: Position
    for (let i = 0; i <= ranges.length - 1; i++) {
      if (textDocument.offsetAt(ranges[i].start) > offset) {
        pos = ranges[i].start
        break
      } else if (i == ranges.length - 1) {
        let wrapscan = await this.nvim.getOption('wrapscan')
        if (wrapscan) pos = ranges[0].start
      }
    }
    if (pos) {
      await window.moveTo(pos)
      if (this.config.enableMessage == 'never') return
      await this.echoMessage(false)
    }
  }

  /**
   * All diagnostics of current workspace
   */
  public getDiagnosticList(): DiagnosticItem[] {
    let res: DiagnosticItem[] = []
    const { level, showUnused, showDeprecated } = this.config
    for (let collection of this.collections) {
      collection.forEach((uri, diagnostics) => {
        let file = URI.parse(uri).fsPath
        for (let diagnostic of diagnostics) {
          if (diagnostic.severity && diagnostic.severity > level) {
            continue
          }
          if (!showUnused && diagnostic.tags?.includes(DiagnosticTag.Unnecessary)) {
            continue
          }
          if (!showDeprecated && diagnostic.tags?.includes(DiagnosticTag.Deprecated)) {
            continue
          }
          let { start } = diagnostic.range
          let o: DiagnosticItem = {
            file,
            lnum: start.line + 1,
            col: start.character + 1,
            code: diagnostic.code,
            source: diagnostic.source || collection.name,
            message: diagnostic.message,
            severity: getSeverityName(diagnostic.severity),
            level: diagnostic.severity || 0,
            location: Location.create(uri, diagnostic.range)
          }
          res.push(o)
        }
      })
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

  private getDiagnosticsAt(bufnr: number, cursor: [number, number]): Diagnostic[] {
    let pos = Position.create(cursor[0], cursor[1])
    let buffer = this.buffers.get(bufnr)
    if (!buffer) return []
    let diagnostics = this.getDiagnostics(buffer.uri)
    let { checkCurrentLine } = this.config
    if (checkCurrentLine) {
      diagnostics = diagnostics.filter(o => lineInRange(pos.line, o.range))
    } else {
      diagnostics = diagnostics.filter(o => positionInRange(pos, o.range) == 0)
    }
    diagnostics.sort((a, b) => a.severity - b.severity)
    return diagnostics
  }

  public async getCurrentDiagnostics(): Promise<Diagnostic[]> {
    let [bufnr, cursor] = await this.nvim.eval('[bufnr("%"),coc#util#cursor()]') as [number, [number, number]]
    return this.getDiagnosticsAt(bufnr, cursor)
  }

  /**
   * Echo diagnostic message of currrent position
   */
  public async echoMessage(truncate = false): Promise<void> {
    const config = this.config
    if (!this.enabled) return
    if (this.timer) clearTimeout(this.timer)
    let useFloat = config.messageTarget == 'float'
    let [bufnr, cursor, filetype, mode, disabled, isFloat] = await this.nvim.eval('[bufnr("%"),coc#util#cursor(),&filetype,mode(),get(b:,"coc_diagnostic_disable",0),get(w:,"float",0)]') as [number, [number, number], string, string, number, number]
    if (mode != 'n' || isFloat == 1 || disabled) return
    let diagnostics = this.getDiagnosticsAt(bufnr, cursor)
    if (diagnostics.length == 0) {
      if (useFloat) {
        this.floatFactory.close()
      } else {
        let echoLine = await this.nvim.call('coc#util#echo_line') as string
        if (this.lastMessage && echoLine.startsWith(this.lastMessage)) {
          this.nvim.command('echo ""', true)
        }
      }
      return
    }
    if (truncate && workspace.insertMode) return
    let docs: Documentation[] = []
    let ft = ''
    if (Object.keys(config.filetypeMap).length > 0) {
      const defaultFiletype = config.filetypeMap['default'] || ''
      ft = config.filetypeMap[filetype] || (defaultFiletype == 'bufferType' ? filetype : defaultFiletype)
    }
    diagnostics.forEach(diagnostic => {
      let { source, code, severity, message } = diagnostic
      let s = getSeverityName(severity)[0]
      const codeStr = code ? ' ' + code : ''
      const str = config.format.replace('%source', source).replace('%code', codeStr).replace('%severity', s).replace('%message', message)
      let filetype = 'Error'
      if (ft === '') {
        switch (severity) {
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
      docs.push({ filetype, content: str })
    })
    if (useFloat) {
      let { maxWindowHeight, maxWindowWidth } = this.config
      await this.floatFactory.show(docs, { maxWidth: maxWindowWidth, maxHeight: maxWindowHeight, modes: ['n'] })
    } else {
      let lines = docs.map(d => d.content).join('\n').split(/\r?\n/)
      if (lines.length) {
        await this.nvim.command('echo ""')
        this.lastMessage = lines[0].slice(0, 30)
        await window.echoLines(lines, truncate)
      }
    }
  }

  public async jumpRelated(): Promise<void> {
    let diagnostics = await this.getCurrentDiagnostics()
    if (!diagnostics) return
    let diagnostic = diagnostics.find(o => o.relatedInformation != null)
    if (!diagnostic) return
    let locations = diagnostic.relatedInformation.map(o => o.location)
    if (locations.length == 1) {
      await workspace.jumpTo(locations[0].uri, locations[0].range.start)
    } else if (locations.length > 1) {
      await workspace.showLocations(locations)
    }
  }

  private disposeBuffer(bufnr: number): void {
    let buf = this.buffers.get(bufnr)
    if (!buf) return
    buf.clear()
    buf.dispose()
    this.buffers.delete(bufnr)
    for (let collection of this.collections) {
      collection.delete(buf.uri)
    }
  }

  public hideFloat(): void {
    if (this.floatFactory) {
      this.floatFactory.close()
    }
  }

  public dispose(): void {
    for (let buf of this.buffers.values()) {
      buf.clear()
      buf.dispose()
    }
    for (let collection of this.collections) {
      collection.dispose()
    }
    this.hideFloat()
    this.buffers.clear()
    this.collections = []
    disposeAll(this.disposables)
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  private setConfiguration(event?: ConfigurationChangeEvent): void {
    if (event && !event.affectsConfiguration('diagnostic')) return
    let config = workspace.getConfiguration('diagnostic')
    let messageTarget = config.get<string>('messageTarget', 'float')
    if (messageTarget == 'float' && !workspace.env.floating && !workspace.env.textprop) {
      messageTarget = 'echo'
    }
    let enableHighlightLineNumber = config.get<boolean>('enableHighlightLineNumber', true)
    if (!workspace.isNvim || semver.lt(workspace.env.version, 'v0.3.2')) {
      enableHighlightLineNumber = false
    }
    this.config = {
      messageTarget,
      enableHighlightLineNumber,
      virtualTextSrcId: workspace.createNameSpace('diagnostic-virtualText'),
      checkCurrentLine: config.get<boolean>('checkCurrentLine', false),
      enableSign: workspace.env.sign && config.get<boolean>('enableSign', true),
      locationlistUpdate: config.get<boolean>('locationlistUpdate', true),
      maxWindowHeight: config.get<number>('maxWindowHeight', 10),
      maxWindowWidth: config.get<number>('maxWindowWidth', 80),
      enableMessage: config.get<string>('enableMessage', 'always'),
      messageDelay: config.get<number>('messageDelay', 200),
      virtualText: config.get<boolean>('virtualText', false) && this.nvim.hasFunction('nvim_buf_set_virtual_text'),
      virtualTextCurrentLineOnly: config.get<boolean>('virtualTextCurrentLineOnly', true),
      virtualTextPrefix: config.get<string>('virtualTextPrefix', " "),
      virtualTextLineSeparator: config.get<string>('virtualTextLineSeparator', " \\ "),
      virtualTextLines: config.get<number>('virtualTextLines', 3),
      displayByAle: config.get<boolean>('displayByAle', false),
      level: severityLevel(config.get<string>('level', 'hint')),
      signPriority: config.get<number>('signPriority', 10),
      errorSign: config.get<string>('errorSign', '>>'),
      warningSign: config.get<string>('warningSign', '>>'),
      infoSign: config.get<string>('infoSign', '>>'),
      hintSign: config.get<string>('hintSign', '>>'),
      refreshAfterSave: config.get<boolean>('refreshAfterSave', false),
      refreshOnInsertMode: config.get<boolean>('refreshOnInsertMode', false),
      filetypeMap: config.get<object>('filetypeMap', {}),
      showUnused: config.get<boolean>('showUnused', true),
      showDeprecated: config.get<boolean>('showDeprecated', true),
      format: config.get<string>('format', '[%source%code] [%severity] %message'),
    }
    this.enabled = config.get<boolean>('enable', true)
    if (this.config.displayByAle) {
      this.enabled = false
    }
    this.defineSigns()
  }

  public getCollectionByName(name: string): DiagnosticCollection {
    return this.collections.find(o => o.name == name)
  }

  private getCollections(uri: string): DiagnosticCollection[] {
    return this.collections.filter(c => c.has(uri))
  }

  private shouldValidate(doc: Document | null): boolean {
    return doc != null && doc.buftype == '' && doc.attached
  }

  public clearDiagnostic(bufnr: number): void {
    let buf = this.buffers.get(bufnr)
    if (!buf) return
    for (let collection of this.collections) {
      collection.delete(buf.uri)
    }
    buf.clear()
  }

  public toggleDiagnostic(): void {
    let { enabled } = this
    this.enabled = !enabled
    for (let buf of this.buffers.values()) {
      if (this.enabled) {
        let diagnostics = this.getDiagnostics(buf.uri)
        buf.forceRefresh(diagnostics)
      } else {
        buf.clear()
      }
    }
  }

  public refreshBuffer(uri: string, force = false): boolean {
    let buf = Array.from(this.buffers.values()).find(o => o.uri == uri)
    if (!buf) return false
    let { displayByAle, refreshOnInsertMode } = this.config
    if (!refreshOnInsertMode && workspace.insertMode) return false
    if (!displayByAle) {
      let diagnostics = this.getDiagnostics(uri)
      if (this.enabled) {
        if (force) {
          buf.forceRefresh(diagnostics)
        } else {
          buf.refresh(diagnostics)
        }
        return true
      }
    } else {
      let { nvim } = this
      nvim.pauseNotification()
      for (let collection of this.collections) {
        let diagnostics = collection.get(uri)
        const { level } = this.config
        if (level) {
          diagnostics = diagnostics.filter(o => o.severity && o.severity <= level)
        }
        let aleItems = diagnostics.map(o => {
          let { range } = o
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
        nvim.call('ale#other_source#ShowResults', [buf.bufnr, collection.name, aleItems], true)
      }
      nvim.resumeNotification(false, true).logError()
    }
    return false
  }
}

export default new DiagnosticManager()
