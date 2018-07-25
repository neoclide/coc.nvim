import {Neovim} from '@chemzqm/neovim'
import {Diagnostic, DiagnosticSeverity, Range, TextDocument} from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import Document from '../model/document'
import {DiagnosticItem, LocationListItem} from '../types'
import workspace from '../workspace'
import {DiagnosticBuffer, DiagnosticConfig} from './buffer'
import DiagnosticCollection from './collection'
import debounce from 'debounce'
const logger = require('../util/logger')('diagnostic-manager')

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

// maintain buffers
export class DiagnosticManager {
  private enabled = true
  public config: DiagnosticConfig
  private buffers: DiagnosticBuffer[] = []
  private collections: DiagnosticCollection[] = []
  private nvim: Neovim
  public showMessage: () => void
  constructor() {
    workspace.onDidWorkspaceInitialized(() => {
      this.nvim = workspace.nvim
      this.setConfiguration()
      if (this.enabled) {
        this.init().catch(err => {
          logger.error(err.stack)
        })
      }
    })

    workspace.onDidSaveTextDocument(document => {
      let buf = this.buffers.find(buf => buf.uri == document.uri)
      if (buf) {
        buf.checkSigns().catch(e => {
          logger.error(e.stack)
        })
      }
    })

    workspace.onDidChangeConfiguration(() => {
      this.setConfiguration()
    })

    workspace.onDidCloseTextDocument(textDocument => {
      let {uri} = textDocument
      for (let collection of this.collections) {
        collection.delete(uri)
      }
      let idx = this.buffers.findIndex(buf => buf.uri == uri)
      if (idx !== -1) this.buffers.splice(idx, 1)
    })

    this.showMessage = debounce(() => {
      this.echoMessage().catch(e => {
        logger.error(e.stack)
      })
    }, 200)
  }

  private setConfiguration(): void {
    let config = workspace.getConfiguration('coc.preferences.diagnostic')
    this.config = {
      locationlist: config.get<boolean>('locationlist', true),
      signOffset: config.get<number>('signOffset', 1000),
      errorSign: config.get<string>('errorSign', '>>'),
      warningSign: config.get<string>('warningSign', '>>'),
      infoSign: config.get<string>('infoSign', '>>'),
      hintSign: config.get<string>('hintSign', '>>'),
    }
    this.enabled = config.get<boolean>('enable')
  }

  private async init(): Promise<void> {
    let {nvim} = workspace
    let {documents} = workspace
    let {errorSign, warningSign, infoSign, hintSign} = this.config
    await nvim.command(`sign define CocError   text=${errorSign}   texthl=CocErrorSign`)
    await nvim.command(`sign define CocWarning text=${warningSign} texthl=CocWarningSign`)
    await nvim.command(`sign define CocInfo    text=${infoSign}    texthl=CocInfoSign`)
    await nvim.command(`sign define CocHint    text=${hintSign}    texthl=CocHintSign`)
    // create buffers
    for (let doc of documents) {
      this.buffers.push(new DiagnosticBuffer(doc.uri, this))
    }
    workspace.onDidOpenTextDocument(textDocument => {
      this.buffers.push(new DiagnosticBuffer(textDocument.uri, this))
    })
    workspace.onDidCloseTextDocument(textDocument => {
      let idx = this.buffers.findIndex(buf => textDocument.uri == buf.uri)
      if (idx !== -1) this.buffers.splice(idx, 1)
    })
  }

  public create(name: string): DiagnosticCollection {
    let collection = new DiagnosticCollection(name)
    this.collections.push(collection)
    return collection
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
        let {range} = item
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
    let {textDocument} = document
    for (let i = ranges.length - 1; i >= 0; i--) {
      if (textDocument.offsetAt(ranges[i].end) < offset) {
        let {start} = ranges[i]
        await this.nvim.call('cursor', [start.line + 1, start.character + 1])
        break
      }
    }
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
    let {textDocument} = document
    for (let i = 0; i <= ranges.length - 1; i++) {
      if (textDocument.offsetAt(ranges[i].start) > offset) {
        let {start} = ranges[i]
        await this.nvim.call('cursor', [start.line + 1, start.character + 1])
        break
      }
    }
  }

  public getLocationList(uri: string, bufnr: number): LocationListItem[] {
    let res: LocationListItem[] = []
    for (let collection of this.collections) {
      collection.forEach((u, diagnostics) => {
        if (u != uri) return
        for (let diagnostic of diagnostics) {
          let {start} = diagnostic.range
          let o: LocationListItem = {
            bufnr,
            lnum: start.line + 1,
            col: start.character + 1,
            text: `[${collection.name}${diagnostic.code ? ' ' + diagnostic.code : ''}] ${diagnostic.message}`,
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
          let {start} = diagnostic.range
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
  private async echoMessage(): Promise<void> {
    if (!this.enabled) return
    let buffer = await this.nvim.buffer
    let document = workspace.getDocument(buffer.id)
    if (!document) return
    let offset = await workspace.getOffset()
    let {textDocument} = document
    let collections = this.getCollections(document.uri)
    let res: Diagnostic[] = []
    for (let collection of collections) {
      let diagnostics = collection.get(document.uri)
      for (let diagnostic of diagnostics) {
        let {range} = diagnostic
        diagnostic.source = diagnostic.source || collection.name
        let start = textDocument.offsetAt(range.start)
        let end = textDocument.offsetAt(range.end)
        if (start <= offset && end >= offset) {
          res.push(diagnostic)
        }
      }
    }
    if (res.length == 0) return
    res = res.slice(0, 2)
    let lines: string[] = res.map(diagnostic => {
      let {source, code, severity, message} = diagnostic
      let s = severityName(severity)[0]
      let msg = message.replace(/\n/g, ' ')
      return `[${source}${code ? ' ' + code : ''}] ${msg} [${s}]`
    })
    await workspace.echoLines(lines)
  }

  public clear(owner: string, uri?: string): void {
    let {buffers} = this
    for (let buffer of buffers) {
      if (!uri || buffer.uri == uri) {
        buffer.clear(owner).catch(e => {
          logger.error(e.stack)
        })
      }
    }
  }

  public clearAll(): void {
    let {buffers} = this
    for (let buf of buffers) {
      buf.clear().catch(e => {
        logger.error(e.message)
      })
    }
  }

  public dispose(): void {
    this.clearAll()
    this.buffers = []
    this.collections = []
  }

  private getBuffer(uri: string): DiagnosticBuffer {
    return this.buffers.find(buf => buf.uri == uri)
  }

  private getCollections(uri: string): DiagnosticCollection[] {
    return this.collections.filter(c => c.has(uri))
  }
}

export default new DiagnosticManager()
