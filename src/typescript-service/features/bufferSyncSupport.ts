import * as fs from 'fs'
import workspace from '../../workspace'
import {
  Uri,
  disposeAll
} from '../../util'
import {
  TextDocument,
  DidChangeTextDocumentParams,
  TextDocumentContentChangeEvent,
  Disposable,
} from 'vscode-languageserver-protocol'
import * as Proto from '../protocol'
import {ITypeScriptServiceClient} from '../typescriptService'
import {Delayer} from '../utils/async'
import * as languageModeIds from '../utils/languageModeIds'
const logger = require('../../util/logger')('typescript-service-bufferSyncSupport')

interface IDiagnosticRequestor {
  requestDiagnostic(resource: Uri): void
}

function mode2ScriptKind(
  mode: string
): 'TS' | 'TSX' | 'JS' | 'JSX' | undefined {
  switch (mode) {
    case languageModeIds.typescript:
      return 'TS'
    case languageModeIds.typescriptreact:
      return 'TSX'
    case languageModeIds.javascript:
      return 'JS'
    case languageModeIds.javascriptreact:
      return 'JSX'
  }
  return undefined
}

class SyncedBuffer {
  constructor(
    private readonly document: TextDocument,
    private readonly filepath: string,
    private readonly diagnosticRequestor: IDiagnosticRequestor,
    private readonly client: ITypeScriptServiceClient
  ) {}

  public open(): void {
    const args: Proto.OpenRequestArgs = {
      file: this.filepath,
      fileContent: this.document.getText()
    }

    if (this.client.apiVersion.has203Features()) {
      const scriptKind = mode2ScriptKind(this.document.languageId)
      if (scriptKind) {
        args.scriptKindName = scriptKind
      }
    }
    this.client.execute('open', args, false) // tslint:disable-line
  }

  public get lineCount(): number {
    return this.document.lineCount
  }

  public close(): void {
    const args: Proto.FileRequestArgs = {
      file: this.filepath
    }
    this.client.execute('close', args, false) // tslint:disable-line
  }

  public onContentChanged(events:TextDocumentContentChangeEvent[]): void {
    let uri = Uri.parse(this.document.uri)
    const filePath = uri.fsPath
    if (!filePath) return
    for (const { range, text } of events) {
      const args: Proto.ChangeRequestArgs = {
        file: this.filepath,
        line: range ? range.start.line + 1 : 1,
        offset: range ? range.start.character + 1 : 1,
        endLine: range ? range.end.line + 1 : 2**24,
        endOffset: range ? range.end.character + 1 : 1,
        insertString: text
      }
      this.client.execute('change', args, false) // tslint:disable-line
    }
    this.diagnosticRequestor.requestDiagnostic(uri)
  }
}

class SyncedBufferMap {
  private readonly _map = new Map<string, SyncedBuffer>()

  constructor(
    private readonly _normalizePath: (resource: Uri) => string | null
  ) {}

  public has(resource: Uri): boolean {
    const file = this._normalizePath(resource)
    return !!file && this._map.has(file)
  }

  public get(resource: Uri): SyncedBuffer | undefined {
    const file = this._normalizePath(resource)
    return file ? this._map.get(file) : undefined
  }

  public set(resource: Uri, buffer: SyncedBuffer):void {
    const file = this._normalizePath(resource)
    if (file) {
      this._map.set(file, buffer)
    }
  }

  public delete(resource: Uri): void {
    const file = this._normalizePath(resource)
    if (file) {
      this._map.delete(file)
    }
  }

  public get allBuffers(): Iterable<SyncedBuffer> {
    return this._map.values()
  }

  public get allResources(): Iterable<string> {
    return this._map.keys()
  }
}

export interface Diagnostics {
  delete(resource: Uri): void
}

export default class BufferSyncSupport {
  private readonly client: ITypeScriptServiceClient

  private _validate: boolean
  private readonly modeIds: Set<string>
  private readonly diagnostics: Diagnostics
  private readonly disposables: Disposable[] = []
  private readonly syncedBuffers: SyncedBufferMap

  private readonly pendingDiagnostics = new Map<string, number>()
  private readonly diagnosticDelayer: Delayer<any>

  constructor(
    client: ITypeScriptServiceClient,
    modeIds: string[],
    diagnostics: Diagnostics,
    validate: boolean
  ) {
    this.client = client
    this.modeIds = new Set<string>(modeIds)
    this.diagnostics = diagnostics
    this._validate = validate || false

    this.diagnosticDelayer = new Delayer<any>(300)

    this.syncedBuffers = new SyncedBufferMap(path =>
      this.client.normalizePath(path)
    )
  }

  public listen(): void {
    workspace.onDidOpenTextDocument(
      this.onDidOpenTextDocument,
      this,
      this.disposables
    )
    workspace.onDidCloseTextDocument(
      this.onDidCloseTextDocument,
      this,
      this.disposables
    )
    workspace.onDidChangeTextDocument(
      this.onDidChangeTextDocument,
      this,
      this.disposables
    )
    workspace.textDocuments.forEach(this.onDidOpenTextDocument, this)
  }

  public set validate(value: boolean) {
    this._validate = value
  }

  public handles(resource: Uri): boolean {
    return this.syncedBuffers.has(resource)
  }

  public reOpenDocuments(): void {
    for (const buffer of this.syncedBuffers.allBuffers) {
      buffer.open()
    }
  }

  public dispose(): void {
    disposeAll(this.disposables)
  }

  private onDidOpenTextDocument(document: TextDocument): void {
    if (!this.modeIds.has(document.languageId)) {
      return
    }
    const resource = Uri.parse(document.uri)
    const filepath = this.client.normalizePath(resource)
    if (!filepath) {
      return
    }

    if (this.syncedBuffers.has(resource)) {
      return
    }

    const syncedBuffer = new SyncedBuffer(document, filepath, this, this.client)
    this.syncedBuffers.set(resource, syncedBuffer)
    syncedBuffer.open()
    this.requestDiagnostic(resource)
  }

  private onDidCloseTextDocument(document: TextDocument): void {
    const resource = Uri.file(document.uri)
    const syncedBuffer = this.syncedBuffers.get(resource)
    if (!syncedBuffer) {
      return
    }
    this.diagnostics.delete(resource)
    this.syncedBuffers.delete(resource)
    syncedBuffer.close()
    if (!fs.existsSync(resource.fsPath)) {
      this.requestAllDiagnostics()
    }
  }

  private onDidChangeTextDocument(e: DidChangeTextDocumentParams): void {
    const uri = Uri.parse(e.textDocument.uri)
    const syncedBuffer = this.syncedBuffers.get(uri)
    if (syncedBuffer) {
      syncedBuffer.onContentChanged(e.contentChanges)
    }
  }

  public requestAllDiagnostics():void {
    if (!this._validate) {
      return
    }
    for (const filePath of this.syncedBuffers.allResources) {
      this.pendingDiagnostics.set(filePath, Date.now())
    }
    this.diagnosticDelayer.trigger(() => { // tslint:disable-line
      this.sendPendingDiagnostics()
    }, 200)
  }

  public requestDiagnostic(resource: Uri): void {
    if (!this._validate) {
      return
    }
    const file = resource.fsPath
    if (!file) return
    this.pendingDiagnostics.set(file, Date.now())
    const buffer = this.syncedBuffers.get(resource)
    let delay = 300
    if (buffer) {
      const lineCount = buffer.lineCount
      delay = Math.min(Math.max(Math.ceil(lineCount / 20), 300), 800)
    }
    this.diagnosticDelayer.trigger(() => {
      this.sendPendingDiagnostics()
    }, delay) // tslint:disable-line
  }

  public hasPendingDiagnostics(resource: Uri): boolean {
    const file = resource.fsPath
    return !file || this.pendingDiagnostics.has(file)
  }

  private sendPendingDiagnostics(): void {
    if (!this._validate) {
      return
    }
    const files = Array.from(this.pendingDiagnostics.entries())
      .filter(f => f.indexOf('node_modules') == -1)
      .sort((a, b) => a[1] - b[1])
      .map(entry => entry[0])

    // Add all open TS buffers to the geterr request. They might be visible
    for (const file of this.syncedBuffers.allResources) {
      if (!this.pendingDiagnostics.get(file)) {
        files.push(file)
      }
    }
    if (files.length) {
      const args: Proto.GeterrRequestArgs = {
        delay: 0,
        files
      }
      this.client.execute('geterr', args, false) // tslint:disable-line
    }
    this.pendingDiagnostics.clear()
  }
}
