import { Neovim } from '@chemzqm/neovim'
import { Diagnostic, DiagnosticSeverity, Disposable, Range, TextDocument } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import events from '../events'
import Document from '../model/document'
import { DiagnosticItem, LocationListItem, DiagnosticInfo } from '../types'
import { disposeAll } from '../util'
import workspace from '../workspace'
import { DiagnosticBuffer } from './buffer'
import DiagnosticCollection from './collection'
const logger = require('../util/logger')('diagnostic-manager')

export interface DiagnosticConfig {
  locationlist: boolean,
  signOffset: number
  errorSign: string
  warningSign: string
  infoSign: string
  hintSign: string
}

function severityName(severity: DiagnosticSeverity): string {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return 'Error'
    case DiagnosticSeverity.Warning:
      return 'Warning'
    case DiagnosticSeverity.Information:
      return 'Information'
    case DiagnosticSeverity.Hint:
      return 'Hint'
    default:
      return 'Error'
  }
}

export class DiagnosticManager {
  public config: DiagnosticConfig
  private enabled = true
  private timer: NodeJS.Timer
  private buffers: DiagnosticBuffer[] = []
  private collections: DiagnosticCollection[] = []
  private disposables: Disposable[] = []
  private srcId = 1000
  private srcIdMap: Map<string, number> = new Map()
  private enableMessage = true
  constructor() {

    workspace.onDidWorkspaceInitialized(() => {
      this.setConfiguration()
      if (this.enabled) {
        this.init().catch(err => {
          logger.error(err.stack)
        })
      }
    }, null, this.disposables)

    events.on('CursorMoved', bufnr => {
      if (this.timer) {
        clearTimeout(this.timer)
      }
      this.timer = setTimeout(this.onHold.bind(this, bufnr), 500)
    }, null, this.disposables)

    events.on(['InsertEnter', 'TextChanged'], () => {
      if (this.timer) {
        clearTimeout(this.timer)
      }
    }, null, this.disposables)

    workspace.onDidChangeConfiguration(() => {
      this.setConfiguration()
    }, null, this.disposables)

    events.on('BufWinEnter', async (bufnr, winid) => {
      if (!this.config.locationlist) return
      let doc = workspace.getDocument(bufnr)
      let buf = doc ? this.buffers.find(buf => buf.uri == doc.uri) : null
      if (buf) {
        buf.setLocationlist()
      } else {
        let bufs = await this.nvim.buffers
        let buf = bufs.find(buf => buf.id == bufnr)
        if (buf) {
          let buftype = await buf.getOption('buftype')
          if (buftype == 'quickfix') return
          let curr = await this.nvim.call('getloclist', [winid, { title: 1 }])
          if ((curr.title && curr.title.indexOf('Diagnostics of coc') != -1)) {
            this.nvim.call('setloclist', [winid, [], 'f'], true)
          }
        }
      }
    }, null, this.disposables)

    events.on('BufUnload', async bufnr => {
      let idx = this.buffers.findIndex(buf => buf.bufnr == bufnr)
      if (idx == -1) return
      let buf = this.buffers[idx]
      for (let collection of this.collections) {
        await collection.delete(buf.uri)
      }
      await this.nvim.command(`sign unplace * buffer=${bufnr}`)
      this.buffers.splice(idx, 1)
    }, null, this.disposables)

    workspace.onWillSaveTextDocument(e => {
      let { uri } = e.document
      let buf = this.buffers.find(buf => buf.uri == uri)
      if (buf) {
        buf.clearSigns().catch(e => {
          logger.error(e)
        })
      }
    })

    this.disposables.push(Disposable.create(() => {
      if (this.timer) {
        clearTimeout(this.timer)
      }
    }))
  }

  private get nvim(): Neovim {
    return workspace.nvim
  }

  private setConfiguration(): void {
    let config = workspace.getConfiguration('coc.preferences.diagnostic')
    this.enableMessage = config.get<boolean>('enableMessage', true)
    this.srcId = config.get<number>('highlightOffset', 1000)
    this.config = {
      locationlist: config.get<boolean>('locationlist', true),
      signOffset: config.get<number>('signOffset', 1000),
      errorSign: config.get<string>('errorSign', '>>'),
      warningSign: config.get<string>('warningSign', '>>'),
      infoSign: config.get<string>('infoSign', '>>'),
      hintSign: config.get<string>('hintSign', '>>'),
    }
    this.enabled = config.get<boolean>('enable', true)
  }

  private async init(): Promise<void> {
    let { nvim } = workspace
    let { documents } = workspace
    let { errorSign, warningSign, infoSign, hintSign } = this.config
    nvim.command(`sign define CocError   text=${errorSign}   texthl=CocErrorSign`, true)
    nvim.command(`sign define CocWarning text=${warningSign} texthl=CocWarningSign`, true)
    nvim.command(`sign define CocInfo    text=${infoSign}    texthl=CocInfoSign`, true)
    nvim.command(`sign define CocHint    text=${hintSign}    texthl=CocHintSign`, true)
    // create buffers
    for (let doc of documents) {
      this.buffers.push(new DiagnosticBuffer(doc.bufnr, doc.uri, this))
    }

    workspace.onDidOpenTextDocument(textDocument => {
      let doc = workspace.getDocument(textDocument.uri)
      this.buffers.push(new DiagnosticBuffer(doc.bufnr, doc.uri, this))
    }, null, this.disposables)

    workspace.onDidCloseTextDocument(textDocument => {
      let idx = this.buffers.findIndex(buf => textDocument.uri == buf.uri)
      if (idx !== -1) this.buffers.splice(idx, 1)
    }, null, this.disposables)
  }

  public create(name: string): DiagnosticCollection {
    let collection = new DiagnosticCollection(name)
    this.collections.push(collection)
    if (workspace.isNvim) {
      let { srcId } = this
      this.srcId = this.srcId + 1
      this.srcIdMap.set(name, srcId)
    }
    return collection
  }

  public getSrcId(name: string): number {
    return this.srcIdMap.get(name)
  }

  public removeCollection(owner: string): void {
    let idx = this.collections.findIndex(c => c.name == owner)
    if (idx !== -1) this.collections.splice(idx, 1)
  }

  /**
   * Add diagnostics for owner and uri
   *
   * @public
   * @param {string} owner
   * @param {string} uri
   * @param {Diagnostic[]|null} diagnostics
   * @returns {void}
   */
  public add(owner: string, uri: string, diagnostics: Diagnostic[] | null): void {
    if (!this.enabled) return
    let buffer = this.getBuffer(uri)
    if (!buffer) return
    buffer.set(owner, diagnostics || [])
  }

  public getSortedRanges(document: Document): Range[] {
    let collections = this.getCollections(document.uri)
    let res: Range[] = []
    for (let collection of collections) {
      let ranges = collection.get(document.uri).map(o => o.range)
      res.push(...ranges)
    }
    res.sort((a, b) => {
      if (a.start.line < b.start.line) {
        return -1
      }
      if (a.start.line > b.start.line) {
        return 1
      }
      return b.start.character - a.start.character
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
      for (let item of items) {
        let { range } = item
        if (document.offsetAt(range.start) >= si
          && document.offsetAt(range.end) <= ei) {
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
    if (!this.enabled) return
    let buffer = await this.nvim.buffer
    let document = workspace.getDocument(buffer.id)
    if (!document) return
    let offset = await workspace.getOffset()
    if (offset == null) return
    let ranges = this.getSortedRanges(document)
    let { textDocument } = document
    for (let i = ranges.length - 1; i >= 0; i--) {
      if (textDocument.offsetAt(ranges[i].end) < offset) {
        let { start } = ranges[i]
        await this.nvim.call('cursor', [start.line + 1, start.character + 1])
        break
      }
    }
    this._echoMessage()
  }

  /**
   * Jump to next diagnostic position
   *
   * @public
   * @returns {Promise<void>}
   */
  public async jumpNext(): Promise<void> {
    if (!this.enabled) return
    let buffer = await this.nvim.buffer
    let document = workspace.getDocument(buffer.id)
    let offset = await workspace.getOffset()
    let ranges = this.getSortedRanges(document)
    let { textDocument } = document
    for (let i = 0; i <= ranges.length - 1; i++) {
      if (textDocument.offsetAt(ranges[i].start) > offset) {
        let { start } = ranges[i]
        await this.nvim.call('cursor', [start.line + 1, start.character + 1])
        break
      }
    }
    this._echoMessage()
  }

  public getLocationList(uri: string, bufnr: number): LocationListItem[] {
    let res: LocationListItem[] = []
    for (let collection of this.collections) {
      collection.forEach((u, diagnostics) => {
        if (u != uri) return
        for (let diagnostic of diagnostics) {
          let { start } = diagnostic.range
          let msg = diagnostic.message.split('\n')[0]
          let o: LocationListItem = {
            bufnr,
            lnum: start.line + 1,
            col: start.character + 1,
            text: `[${collection.name}${diagnostic.code ? ' ' + diagnostic.code : ''}] ${msg}`,
            type: severityName(diagnostic.severity).slice(0, 1).toUpperCase(),
          }
          res.push(o)
        }
      })
    }
    res.sort((a, b) => {
      if (a.lnum != b.lnum) {
        return a.lnum - b.lnum
      }
      return a.col - b.col
    })
    return res
  }

  /**
   * All diagnostic of current files
   *
   * @public
   * @returns {any}
   */
  public diagnosticList(): DiagnosticItem[] {
    let res = []
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
            severity: severityName(diagnostic.severity),
          }
          res.push(o)
        }
      })
    }
    res.sort((a, b) => {
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
    let offset = await workspace.getOffset()
    let diagnostics = this.diagnosticsAtOffset(offset, document.textDocument)
    if (diagnostics.length == 0) {
      diagnostics = this.diagnosticsAtOffset(offset + 1, document.textDocument)
    }
    if (diagnostics.length == 0) return
    let lines: string[] = []
    diagnostics.forEach(diagnostic => {
      let { source, code, severity, message } = diagnostic
      let s = severityName(severity)[0]
      let str = `[${source}${code ? ' ' + code : ''}] [${s}] ${message}`
      lines.push(...str.split('\n'))
    })
    await workspace.echoLines(lines, truncate)
  }

  private diagnosticsAtOffset(offset:number, textDocument:TextDocument):Diagnostic[] {
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

  public async clearBuffer(owner: string, uri: string): Promise<void> {
    let buf = this.getBuffer(uri)
    if (buf) await buf.clear(owner)
  }

  public async clear(owner: string, uri?: string): Promise<void> {
    let collection = this.collections.find(o => o.name == owner)
    if (!collection) return
    if (!uri) {
      await collection.clear()
    } else {
      await collection.delete(uri)
    }
  }

  public dispose(): void {
    for (let collection of this.collections) {
      collection.dispose()
    }
    this.buffers = []
    this.collections = []
    disposeAll(this.disposables)
  }

  public getBuffer(uri: string): DiagnosticBuffer {
    return this.buffers.find(buf => buf.uri == uri)
  }

  private getCollections(uri: string): DiagnosticCollection[] {
    return this.collections.filter(c => c.has(uri))
  }

  public getDiagnosticInfo(uri: string): DiagnosticInfo {
    let diagnostics = []
    let collections = this.getCollections(uri)
    collections.forEach(collection => {
      let arr = collection.get(uri)
      if (arr && arr.length) {
        diagnostics.push(...arr)
      }
    })
    return getDiagnosticInfo(diagnostics)
  }

  private async onHold(bufnr: number): Promise<void> {
    if (workspace.bufnr != bufnr) return
    let m = await this.nvim.mode
    if (m.blocking || m.mode != 'n') return
    await this.echoMessage(true)
  }

  private _echoMessage(): void {
    setTimeout(() => {
      this.echoMessage().catch(e => {
        logger.error(e)
      })
    }, 100)
  }
}

function getDiagnosticInfo(diagnostics: Diagnostic[]): DiagnosticInfo {
  let error = 0
  let warning = 0
  let information = 0
  let hint = 0
  if (diagnostics && diagnostics.length) {
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

export default new DiagnosticManager()
