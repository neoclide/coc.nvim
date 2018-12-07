import { Neovim } from '@chemzqm/neovim'
import { Diagnostic, Disposable, Range, TextDocument, DiagnosticSeverity } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import events from '../events'
import Document from '../model/document'
import { DiagnosticItem, DiagnosticItems, ConfigurationChangeEvent } from '../types'
import { disposeAll, wait } from '../util'
import workspace from '../workspace'
import { DiagnosticBuffer } from './buffer'
import DiagnosticCollection from './collection'
import { getSeverityName, severityLevel, getSeverityType } from './util'
const logger = require('../util/logger')('diagnostic-manager')

export interface DiagnosticConfig {
  displayByAle: boolean
  srcId: number
  locationlist: boolean
  signOffset: number
  errorSign: string
  warningSign: string
  infoSign: string
  hintSign: string
  level: number
}

export class DiagnosticManager {
  public config: DiagnosticConfig
  public enabled = true
  public insertMode = false
  public readonly buffers: DiagnosticBuffer[] = []
  private collections: DiagnosticCollection[] = []
  private disposables: Disposable[] = []
  private enableMessage = true
  private timer: NodeJS.Timer
  constructor() {
    // tslint:disable-next-line:no-floating-promises
    workspace.ready.then(async () => {
      this.setConfiguration()
      this.init().catch(err => {
        logger.error(err)
      })
      let { mode } = await workspace.nvim.mode
      this.insertMode = mode.startsWith('i')
    })

    events.on('CursorMoved', bufnr => {
      if (!this.enabled) return
      if (this.timer) clearTimeout(this.timer)
      this.timer = setTimeout(this.onHold.bind(this, bufnr), 500)
    }, null, this.disposables)

    events.on('InsertEnter', async () => {
      this.insertMode = true
      if (this.timer) clearTimeout(this.timer)
    }, null, this.disposables)

    events.on('InsertLeave', async () => {
      this.insertMode = false
      let { bufnr } = workspace
      let doc = workspace.getDocument(bufnr)
      if (!this.shouldValidate(doc)) return
      await wait(30)
      this.refreshBuffer(doc.uri)
    }, null, this.disposables)

    workspace.onDidChangeConfiguration(e => {
      this.setConfiguration(e)
    }, null, this.disposables)

    events.on('BufEnter', async bufnr => {
      if (this.timer) clearTimeout(this.timer)
      if (!this.config
        || !this.enabled
        || !this.config.locationlist) return
      let winid = await this.nvim.call('win_getid') as number
      let doc = workspace.getDocument(bufnr)
      // wait buffer create
      if (!doc) {
        await wait(100)
        doc = workspace.getDocument(bufnr)
      }
      if (!this.shouldValidate(doc)) return
      let refreshed = this.refreshBuffer(doc.uri)
      if (!refreshed) {
        let curr = await this.nvim.call('getloclist', [winid, { title: 1 }])
        if ((curr.title && curr.title.indexOf('Diagnostics of coc') != -1)) {
          this.nvim.call('setloclist', [winid, [], 'f'], true)
        }
      }
    }, null, this.disposables)

    events.on('BufUnload', async bufnr => {
      let idx = this.buffers.findIndex(buf => buf.bufnr == bufnr)
      if (idx == -1) return
      let buf = this.buffers[idx]
      this.buffers.splice(idx, 1)
      for (let collection of this.collections) {
        collection.delete(buf.uri)
      }
      await buf.clear()
    }, null, this.disposables)

    events.on('BufWritePost', async bufnr => {
      let buf = this.buffers.find(buf => buf.bufnr == bufnr)
      if (buf) await buf.checkSigns()
    }, null, this.disposables)

    this.disposables.push(Disposable.create(() => {
      if (this.timer) {
        clearTimeout(this.timer)
      }
    }))
  }

  public create(name: string): DiagnosticCollection {
    let collection = new DiagnosticCollection(name)
    this.collections.push(collection)
    let disposable = collection.onDidDiagnosticsChange(uri => {
      this.refreshBuffer(uri)
    })
    collection.onDispose(() => {
      disposable.dispose()
      let idx = this.collections.findIndex(o => o == collection)
      if (idx !== -1) this.collections.splice(idx, 1)
    })
    collection.onDidDiagnosticsClear(uris => {
      for (let uri of uris) {
        this.refreshBuffer(uri)
      }
    })
    return collection
  }

  public getSortedRanges(document: Document): Range[] {
    let collections = this.getCollections(document.uri)
    let res: Range[] = []
    for (let collection of collections) {
      let ranges = collection.get(document.uri).map(o => o.range)
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

  public getDiagnosticsInRange(document: TextDocument, range: Range): Diagnostic[] {
    let collections = this.getCollections(document.uri)
    let si = document.offsetAt(range.start)
    let ei = document.offsetAt(range.end)
    let res: Diagnostic[] = []
    for (let collection of collections) {
      let items = collection.get(document.uri)
      if (!items) continue
      for (let item of items) {
        let { range } = item
        if (withIn(document.offsetAt(range.start), si, ei)
          || withIn(document.offsetAt(range.end), si, ei)) {
          res.push(item)
        }
      }
    }
    return res
  }

  /**
   * Jump to previouse diagnostic position
   *
   * @public
   * @returns {Promise<void>}
   */
  public async jumpPrevious(): Promise<void> {
    let buffer = await this.nvim.buffer
    let document = workspace.getDocument(buffer.id)
    if (!document) return
    let offset = await workspace.getOffset()
    if (offset == null) return
    let ranges = this.getSortedRanges(document)
    if (ranges.length == 0) {
      workspace.showMessage('Empty diagnostics', 'warning')
      return
    }
    let { textDocument } = document
    for (let i = ranges.length - 1; i >= 0; i--) {
      if (textDocument.offsetAt(ranges[i].end) < offset) {
        await this.jumpTo(ranges[i])
        return
      }
    }
    await this.jumpTo(ranges[ranges.length - 1])
  }

  /**
   * Jump to next diagnostic position
   *
   * @public
   * @returns {Promise<void>}
   */
  public async jumpNext(): Promise<void> {
    let buffer = await this.nvim.buffer
    let document = workspace.getDocument(buffer.id)
    let offset = await workspace.getOffset()
    let ranges = this.getSortedRanges(document)
    if (ranges.length == 0) {
      workspace.showMessage('Empty diagnostics', 'warning')
      return
    }
    let { textDocument } = document
    for (let i = 0; i <= ranges.length - 1; i++) {
      if (textDocument.offsetAt(ranges[i].start) > offset) {
        await this.jumpTo(ranges[i])
        return
      }
    }
    await this.jumpTo(ranges[0])
  }

  public getBufferDiagnostic(uri: string): DiagnosticItems {
    let res: DiagnosticItems = {}
    let { level } = this.config
    for (let collection of this.getCollections(uri)) {
      let diagnostics = collection.get(uri)
      if (diagnostics && diagnostics.length) {
        diagnostics = diagnostics.filter(o => o.severity == null || o.severity <= level)
        res[collection.name] = diagnostics
      } else {
        res[collection.name] = []
      }
    }
    return res
  }

  /**
   * All diagnostic of current files
   *
   * @public
   * @returns {any}
   */
  public getDiagnosticList(): DiagnosticItem[] {
    let res: DiagnosticItem[] = []
    for (let collection of this.collections) {
      collection.forEach((uri, diagnostics) => {
        let file = Uri.parse(uri).fsPath
        for (let diagnostic of diagnostics) {
          let { start } = diagnostic.range
          let o: DiagnosticItem = {
            file,
            lnum: start.line + 1,
            col: start.character + 1,
            message: `[${collection.name}${diagnostic.code ? ' ' + diagnostic.code : ''}] ${diagnostic.message}`,
            severity: getSeverityName(diagnostic.severity),
            level: diagnostic.severity || 0
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

  /**
   * Echo diagnostic message of currrent position
   *
   * @private
   * @returns {Promise<void>}
   */
  public async echoMessage(truncate = false): Promise<void> {
    if (!this.enabled) return
    if (truncate && !this.enableMessage) return
    if (this.timer) clearTimeout(this.timer)
    let buffer = await this.nvim.buffer
    let document = workspace.getDocument(buffer.id)
    if (!document) return
    if (!this.shouldValidate(document)) return
    let offset = await workspace.getOffset()
    let diagnostics = this.diagnosticsAtOffset(offset, document.textDocument)
    if (diagnostics.length == 0) {
      diagnostics = this.diagnosticsAtOffset(offset + 1, document.textDocument)
    }
    if (diagnostics.length == 0) return
    let lines: string[] = []
    diagnostics.forEach(diagnostic => {
      let { source, code, severity, message } = diagnostic
      let s = getSeverityName(severity)[0]
      let str = `[${source}${code ? ' ' + code : ''}] [${s}] ${message}`
      lines.push(...str.split('\n'))
    })
    await workspace.echoLines(lines, truncate)
  }

  public dispose(): void {
    for (let collection of this.collections) {
      collection.dispose()
    }
    this.buffers.splice(0, this.buffers.length)
    this.collections = []
    disposeAll(this.disposables)
  }

  private diagnosticsAtOffset(offset: number, textDocument: TextDocument): Diagnostic[] {
    let res: Diagnostic[] = []
    let { uri } = textDocument
    let collections = this.getCollections(uri)
    for (let collection of collections) {
      let diagnostics = collection.get(uri)
      for (let diagnostic of diagnostics) {
        let { range } = diagnostic
        diagnostic.source = diagnostic.source || collection.name
        let start = textDocument.offsetAt(range.start)
        let end = textDocument.offsetAt(range.end)
        if (start <= offset && end >= offset) {
          res.push(diagnostic)
        }
      }
    }
    return res
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  private setConfiguration(event?: ConfigurationChangeEvent): void {
    if (event && !event.affectsConfiguration('coc.preferences.diagnostic')) return
    let config = workspace.getConfiguration('coc.preferences.diagnostic')
    this.enableMessage = config.get<boolean>('enableMessage', true)
    this.config = {
      displayByAle: config.get<boolean>('displayByAle', false),
      srcId: config.get<number>('highlightOffset', 1000),
      level: severityLevel(config.get<string>('level', 'hint')),
      locationlist: config.get<boolean>('locationlist', true),
      signOffset: config.get<number>('signOffset', 1000),
      errorSign: config.get<string>('errorSign', '>>'),
      warningSign: config.get<string>('warningSign', '>>'),
      infoSign: config.get<string>('infoSign', '>>'),
      hintSign: config.get<string>('hintSign', '>>'),
    }
    this.enabled = config.get<boolean>('enable', true)
    if (this.config.displayByAle) {
      this.enabled = false
    }
    if (event) {
      for (let severity of ['error', 'info', 'warning', 'hint']) {
        let key = `coc.preferences.diagnostic.${severity}Sign`
        if (event.affectsConfiguration(key)) {
          let text = config.get<string>(`${severity}Sign`, '>>')
          let name = severity[0].toUpperCase() + severity.slice(1)
          this.nvim.command(`sign define Coc${name}   text=${text}   linehl=Coc${name}Line texthl=Coc${name}Sign`, true)
        }
      }
    }
  }

  private async init(): Promise<void> {
    let { nvim } = workspace
    let { errorSign, warningSign, infoSign, hintSign } = this.config
    nvim.command(`sign define CocError   text=${errorSign}   linehl=CocErrorLine texthl=CocErrorSign`, true)
    nvim.command(`sign define CocWarning text=${warningSign} linehl=CocWarningLine texthl=CocWarningSign`, true)
    nvim.command(`sign define CocInfo    text=${infoSign}    linehl=CocInfoLine  texthl=CocInfoSign`, true)
    nvim.command(`sign define CocHint    text=${hintSign}    linehl=CocHintLine  texthl=CocHintSign`, true)
    // create buffers
    for (let doc of workspace.documents) {
      if (this.shouldValidate(doc)) {
        this.buffers.push(new DiagnosticBuffer(doc, this.config))
      }
    }
    workspace.onDidOpenTextDocument(textDocument => {
      let doc = workspace.getDocument(textDocument.uri)
      if (this.shouldValidate(doc)) {
        this.buffers.push(new DiagnosticBuffer(doc, this.config))
      }
    }, null, this.disposables)
  }

  private getCollections(uri: string): DiagnosticCollection[] {
    return this.collections.filter(c => c.has(uri))
  }

  private async onHold(bufnr: number): Promise<void> {
    if (workspace.bufnr != bufnr) return
    let mode = await this.nvim.call('mode') as string
    if (mode != 'n') return
    await this.echoMessage(true)
  }

  private shouldValidate(doc: Document | null): boolean {
    if (doc == null) return false
    let { buftype } = doc
    return ['terminal', 'quickfix', 'help'].indexOf(buftype) == -1
  }

  private _echoMessage(): void {
    setTimeout(() => {
      this.echoMessage().catch(e => {
        logger.error(e)
      })
    }, 100)
  }

  private refreshBuffer(uri: string): boolean {
    let { displayByAle } = this.config
    let buf = this.buffers.find(buf => buf.uri == uri)
    if (buf && !this.insertMode) {
      let items = this.getBufferDiagnostic(uri)
      if (this.enabled) {
        buf.refresh(items)
        return true
      }
      if (displayByAle) {
        Object.keys(items).forEach(key => {
          let diagnostics = items[key]
          let aleItems = diagnostics.map(o => {
            let { range } = o
            return {
              text: o.message,
              code: o.code,
              lnum: range.start.line + 1,
              col: range.start.character + 1,
              end_lnum: range.end.line + 1,
              enc_col: range.end.character + 1,
              type: getSeverityType(o.severity)
            }
          })
          this.nvim.call('ale#other_source#ShowResults', [buf.bufnr, key, aleItems], true)
        })
      }
    }
    return false
  }

  private async jumpTo(range: Range): Promise<void> {
    if (!range) return
    let { start } = range
    await this.nvim.call('cursor', [start.line + 1, start.character + 1])
    this._echoMessage()
  }
}

function withIn(a: number, s: number, e: number): boolean {
  return a >= s && a <= e
}

export default new DiagnosticManager()
