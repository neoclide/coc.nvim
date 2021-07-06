import { Neovim } from '@chemzqm/neovim'
import debounce from 'debounce'
import semver from 'semver'
import { Diagnostic, DiagnosticSeverity, DiagnosticTag, Disposable, Emitter, Event, Location, Position, Range } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import events from '../events'
import BufferSync from '../model/bufferSync'
import FloatFactory from '../model/floatFactory'
import { ConfigurationChangeEvent, LocationListItem } from '../types'
import { disposeAll } from '../util'
import { comparePosition, rangeIntersect } from '../util/position'
import window from '../window'
import workspace from '../workspace'
import { DiagnosticBuffer, DiagnosticState, DiagnosticConfig } from './buffer'
import DiagnosticCollection from './collection'
import { getLocationListItem, getSeverityName, severityLevel } from './util'
const logger = require('../util/logger')('diagnostic-manager')

export interface DiagnosticEventParams {
  bufnr: number
  uri: string
  diagnostics: ReadonlyArray<Diagnostic>
}

export interface DiagnosticItem {
  file: string
  lnum: number
  col: number
  source: string
  code: string | number
  message: string
  severity: string
  level: number
  location: Location
}

export class DiagnosticManager implements Disposable {
  public config: DiagnosticConfig
  private enabled = true
  private readonly _onDidRefresh = new Emitter<DiagnosticEventParams>()
  public readonly onDidRefresh: Event<DiagnosticEventParams> = this._onDidRefresh.event
  private buffers: BufferSync<DiagnosticBuffer>
  private lastMessage = ''
  private floatFactory: FloatFactory
  private collections: DiagnosticCollection[] = []
  private disposables: Disposable[] = []
  private timer: NodeJS.Timer

  public init(): void {
    this.setConfiguration()
    workspace.onDidChangeConfiguration(e => {
      this.setConfiguration(e)
    }, null, this.disposables)

    this.floatFactory = new FloatFactory(this.nvim)
    this.buffers = workspace.registerBufferSync(doc => {
      if (doc.buftype !== '') return undefined
      let buf = new DiagnosticBuffer(
        this.nvim, doc.bufnr, doc.uri, this.config,
        diagnostics => {
          this._onDidRefresh.fire({ diagnostics, uri: buf.uri, bufnr: buf.bufnr })
          if (['never', 'jump'].includes(this.config.enableMessage)) {
            return
          }
          this.echoMessage(true).logError()
        })
      let diagnostics = this.getDiagnostics(doc.uri)
      if (this.enabled && diagnostics.length) buf.forceRefresh(diagnostics)
      return buf
    })

    events.on('CursorMoved', bufnr => {
      if (this.config.enableMessage != 'always') return
      if (this.timer) clearTimeout(this.timer)
      if (bufnr == this.floatFactory.bufnr) return
      this.timer = setTimeout(async () => {
        await this.echoMessage(true)
      }, this.config.messageDelay)
    }, null, this.disposables)

    let fn = debounce((bufnr, cursor) => {
      if (!this.config.virtualText || !this.config.virtualTextCurrentLineOnly) {
        return
      }
      let buf = this.buffers.getItem(bufnr)
      if (buf) {
        let diagnostics = this.getDiagnostics(buf.uri)
        buf.showVirtualText(diagnostics, cursor[0])
      }
    }, 100)
    events.on('CursorMoved', fn, null, this.disposables)
    this.disposables.push(Disposable.create(() => {
      fn.clear()
    }))
    events.on('InsertLeave', async bufnr => {
      if (this.config.refreshOnInsertMode) return
      this.refreshBuffer(bufnr)
    }, null, this.disposables)
    events.on('BufEnter', async () => {
      if (this.timer) clearTimeout(this.timer)
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

  /**
   * Fill location list with diagnostics
   */
  public async setLocationlist(bufnr: number): Promise<void> {
    let buf = this.buffers.getItem(bufnr)
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
    let collection = this.getCollectionByName(name)
    if (collection) return collection
    collection = new DiagnosticCollection(name)
    this.collections.push(collection)
    collection.onDidDiagnosticsChange(uri => {
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
  public getDiagnostics(uri: string): (Diagnostic & { collection: string })[] {
    let collections = this.getCollections(uri)
    let { level, showUnused, showDeprecated } = this.config
    let res: (Diagnostic & { collection: string })[] = []
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
      items.forEach(item => {
        res.push(Object.assign({ collection: collection.name }, item))
      })
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
    let diagnostics = await this.getCurrentDiagnostics()
    if (diagnostics.length == 0) {
      this.nvim.command('pclose', true)
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
    this.nvim.call('coc#util#preview_info', [lines, 'txt'], true)
  }

  /**
   * Jump to previous diagnostic position
   */
  public async jumpPrevious(severity?: string): Promise<void> {
    let buffer = await this.nvim.buffer
    let document = workspace.getDocument(buffer.id)
    if (!document) return
    let curpos = await window.getCursorPosition()
    let ranges = this.getSortedRanges(document.uri, severity)
    if (ranges.length == 0) {
      window.showMessage('Empty diagnostics', 'warning')
      return
    }
    let pos: Position
    for (let i = ranges.length - 1; i >= 0; i--) {
      let end = ranges[i].end
      if (comparePosition(end, curpos) < 0) {
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
    let curpos = await window.getCursorPosition()
    let ranges = this.getSortedRanges(document.uri, severity)
    if (ranges.length == 0) {
      window.showMessage('Empty diagnostics', 'warning')
      return
    }
    let pos: Position
    for (let i = 0; i <= ranges.length - 1; i++) {
      let start = ranges[i].start
      if (comparePosition(start, curpos) > 0) {
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

  private getDiagnosticsAt(bufnr: number, cursor: [number, number], atEnd = false, lastline = false): Diagnostic[] {
    let buffer = this.buffers.getItem(bufnr)
    if (!buffer) return []
    let pos = Position.create(cursor[0], cursor[1])
    let res = buffer.getDiagnosticsAt(pos, this.config.checkCurrentLine)
    if (this.config.checkCurrentLine || res.length) return res
    // check next character when cursor at end of line.
    if (atEnd) {
      pos = Position.create(cursor[0], cursor[1] + 1)
      res = buffer.getDiagnosticsAt(pos, false)
      if (res.length) return res
    }
    // check next line when cursor at the beginning of last line.
    if (lastline && cursor[1] == 0) {
      pos = Position.create(cursor[0] + 1, 0)
      res = buffer.getDiagnosticsAt(pos, false)
    }
    return res
  }

  public async getCurrentDiagnostics(): Promise<Diagnostic[]> {
    let [bufnr, cursor, eol, lastline] = await this.nvim.eval(`[bufnr("%"),coc#util#cursor(),col('.')==col('$')-1,line('.')==line('$')]`) as [number, [number, number], number, number]
    return this.getDiagnosticsAt(bufnr, cursor, eol == 1, lastline == 1)
  }

  /**
   * Echo diagnostic message under cursor.
   */
  public async echoMessage(truncate = false): Promise<void> {
    const config = this.config
    if (!this.enabled || config.displayByAle) return
    if (this.timer) clearTimeout(this.timer)
    let useFloat = config.messageTarget == 'float'
    // echo
    let [filetype, mode] = await this.nvim.eval(`[&filetype,mode()]`) as [string, string]
    if (mode != 'n') return
    let diagnostics = await this.getCurrentDiagnostics()
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
    let docs = []
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

  public reset(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.buffers.reset()
    for (let collection of this.collections) {
      collection.dispose()
    }
    this.collections = []
  }

  public dispose(): void {
    this.buffers.dispose()
    if (this.timer) {
      clearTimeout(this.timer)
    }
    for (let collection of this.collections) {
      collection.dispose()
    }
    this.floatFactory?.close()
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
      highlighLimit: config.get<number>('highlighLimit', 1000),
      autoRefresh: config.get<boolean>('autoRefresh', false),
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
      refreshOnInsertMode: config.get<boolean>('refreshOnInsertMode', false),
      filetypeMap: config.get<object>('filetypeMap', {}),
      showUnused: config.get<boolean>('showUnused', true),
      showDeprecated: config.get<boolean>('showDeprecated', true),
      format: config.get<string>('format', '[%source%code] [%severity] %message'),
    }
    this.enabled = config.get<boolean>('enable', true)
    this.defineSigns()
  }

  public getCollectionByName(name: string): DiagnosticCollection {
    return this.collections.find(o => o.name == name)
  }

  private getCollections(uri: string): DiagnosticCollection[] {
    return this.collections.filter(c => c.has(uri))
  }

  public toggleDiagnostic(): void {
    let { enabled } = this
    this.enabled = !enabled
    for (let buf of this.buffers.items) {
      if (this.enabled) {
        let diagnostics = this.getDiagnostics(buf.uri)
        buf.forceRefresh(diagnostics)
      } else {
        buf.clear()
      }
    }
  }

  public toggleDiagnosticBuffer(bufnr: number): void {
    if (!this.enabled) return
    let buf = this.buffers.getItem(bufnr)
    if (buf) {
      if (buf.enabled) {
        buf.changeState(DiagnosticState.Disabled)
        buf.clear()
      } else {
        buf.changeState(DiagnosticState.Enabled)
        let diagnostics = this.getDiagnostics(buf.uri)
        buf.forceRefresh(diagnostics)
      }
    }
  }

  /**
   * Refresh diagnostics by uri or bufnr
   */
  public refreshBuffer(uri: string | number, force = false): boolean {
    if (!this.enabled || !this.config.autoRefresh) return false
    let buf = this.buffers.getItem(uri)
    if (!buf) return false
    let diagnostics = this.getDiagnostics(buf.uri)
    if (force) {
      buf.forceRefresh(diagnostics)
    } else {
      buf.refresh(diagnostics)
    }
    return true
  }

  public refresh(bufnr?: number): void {
    if (!bufnr) {
      for (let item of this.buffers.items) {
        let diagnostics = this.getDiagnostics(item.uri)
        item.forceRefresh(diagnostics)
      }
    } else {
      let item = this.buffers.getItem(bufnr)
      if (item) {
        let diagnostics = this.getDiagnostics(item.uri)
        item.forceRefresh(diagnostics)
      }
    }
  }
}

export default new DiagnosticManager()
