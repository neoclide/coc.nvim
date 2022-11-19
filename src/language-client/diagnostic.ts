'use strict'
import { minimatch } from '../util/node'
import { v4 as uuid } from 'uuid'
import type {
  CancellationToken, ClientCapabilities, Diagnostic, DiagnosticOptions, DiagnosticRegistrationOptions, DocumentDiagnosticParams, DocumentDiagnosticReport, DocumentSelector, PreviousResultId, ServerCapabilities, WorkspaceDiagnosticParams, WorkspaceDiagnosticReport, WorkspaceDiagnosticReportPartialResult
} from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import DiagnosticCollection from '../diagnostic/collection'
import languages from '../languages'
import { DiagnosticProvider, ProviderResult, ResultReporter } from '../provider'
import { TextDocumentMatch } from '../types'
import { CancellationError } from '../util/errors'
import { LinkedMap, Touch } from '../util/map'
import { CancellationTokenSource, DiagnosticRefreshRequest, DiagnosticServerCancellationData, DidChangeTextDocumentNotification, DidCloseTextDocumentNotification, DidOpenTextDocumentNotification, DidSaveTextDocumentNotification, Disposable, DocumentDiagnosticReportKind, DocumentDiagnosticRequest, Emitter, RAL, WorkspaceDiagnosticRequest } from '../util/protocol'
import window from '../window'
import workspace from '../workspace'
import { BaseFeature, ensure, FeatureClient, LSPCancellationError, TextDocumentLanguageFeature } from './features'
import { getConditionValue } from '../util'

interface HandleDiagnosticsSignature {
  (this: void, uri: string, diagnostics: Diagnostic[]): void
}
export type ProvideDiagnosticSignature = (this: void, document: TextDocument | URI, previousResultId: string | undefined, token: CancellationToken) => ProviderResult<DocumentDiagnosticReport>

export type ProvideWorkspaceDiagnosticSignature = (this: void, resultIds: PreviousResultId[], token: CancellationToken, resultReporter: ResultReporter) => ProviderResult<WorkspaceDiagnosticReport>

export interface DiagnosticProviderMiddleware {
  handleDiagnostics?: (this: void, uri: string, diagnostics: Diagnostic[], next: HandleDiagnosticsSignature) => void
  provideDiagnostics?: (this: void, document: TextDocument | URI, previousResultId: string | undefined, token: CancellationToken, next: ProvideDiagnosticSignature) => ProviderResult<DocumentDiagnosticReport>
  provideWorkspaceDiagnostics?: (this: void, resultIds: PreviousResultId[], token: CancellationToken, resultReporter: ResultReporter, next: ProvideWorkspaceDiagnosticSignature) => ProviderResult<WorkspaceDiagnosticReport>
}

export interface DiagnosticProviderShape {
  onDidChangeDiagnosticsEmitter: Emitter<void>
  knows: (kind: PullState, textDocument: TextDocument) => boolean
  diagnostics: DiagnosticProvider
}

export enum DiagnosticPullMode {
  onType = 'onType',
  onSave = 'onSave'
}

export interface DiagnosticPullOptions {

  /**
   * Whether to pull for diagnostics on document change.
   */
  onChange?: boolean

  /**
   * Whether to pull for diagnostics on document save.
   */
  onSave?: boolean

  /**
   * Whether to pull workspace diagnostics.
   */
  workspace?: boolean
  /**
   * Minimatch patterns to match full filepath that should be ignored for pullDiagnostic.
   */
  ignored?: string[]

  /**
   * An optional filter method that is consulted when triggering a
   * diagnostic pull during document change or document save.
   *
   * @param document the document that changes or got save
   * @param mode the mode
   */
  filter?(document: TextDocumentMatch, mode: DiagnosticPullMode): boolean
}

export interface $DiagnosticPullOptions {
  diagnosticPullOptions?: DiagnosticPullOptions
}

enum RequestStateKind {
  active = 'open',
  reschedule = 'reschedule',
  outDated = 'drop'
}

type RequestState = {
  state: RequestStateKind.active
  document: TextDocument | URI
  version: number | undefined
  tokenSource: CancellationTokenSource
} | {
  state: RequestStateKind.reschedule
  document: TextDocument | URI
} | {
  state: RequestStateKind.outDated
  document: TextDocument | URI
}

interface DocumentPullState {
  document: URI
  pulledVersion: number | undefined
  resultId: string | undefined
}

export enum PullState {
  document = 1,
  workspace = 2
}

interface Requestor {
  pull: (document: TextDocument, cb?: () => void) => void
}

const pullDebounce = getConditionValue(3000, 10)

export class DocumentPullStateTracker {
  private readonly documentPullStates: Map<string, DocumentPullState>
  private readonly workspacePullStates: Map<string, DocumentPullState>

  constructor() {
    this.documentPullStates = new Map()
    this.workspacePullStates = new Map()
  }

  public track(kind: PullState, textDocument: TextDocument): DocumentPullState
  public track(kind: PullState, uri: URI, version: number | undefined): DocumentPullState
  public track(kind: PullState, document: TextDocument | URI, arg1?: number | undefined): DocumentPullState {
    const states = kind === PullState.document ? this.documentPullStates : this.workspacePullStates
    const [key, uri, version] = document instanceof URI
      ? [document.toString(), document, arg1 as number | undefined]
      : [document.uri.toString(), URI.parse(document.uri), document.version]
    let state = states.get(key)
    if (state === undefined) {
      state = { document: uri, pulledVersion: version, resultId: undefined }
      states.set(key, state)
    }
    return state
  }

  public update(kind: PullState, textDocument: TextDocument, resultId: string | undefined): void
  public update(kind: PullState, uri: URI, version: number | undefined, resultId: string | undefined): void
  public update(kind: PullState, document: TextDocument | URI, arg1: string | number | undefined, arg2?: string | undefined): void {
    const states = kind === PullState.document ? this.documentPullStates : this.workspacePullStates
    const [key, uri, version, resultId] = document instanceof URI
      ? [document.toString(), document, arg1 as number | undefined, arg2]
      : [document.uri, URI.parse(document.uri), document.version, arg1 as string | undefined]
    let state = states.get(key)
    if (state === undefined) {
      state = { document: uri, pulledVersion: version, resultId }
      states.set(key, state)
    } else {
      state.pulledVersion = version
      state.resultId = resultId
    }
  }

  public unTrack(kind: PullState, document: TextDocument | URI): void {
    const key = document instanceof URI ? document.toString() : document.uri
    const states = kind === PullState.document ? this.documentPullStates : this.workspacePullStates
    states.delete(key)
  }

  public tracks(kind: PullState, document: TextDocument | URI): boolean {
    const key = document instanceof URI ? document.toString() : document.uri
    const states = kind === PullState.document ? this.documentPullStates : this.workspacePullStates
    return states.has(key)
  }

  public trackingDocuments(): string[] {
    return Array.from(this.documentPullStates.keys())
  }

  public getResultId(kind: PullState, document: TextDocument | URI): string | undefined {
    const key = document instanceof URI ? document.toString() : document.uri
    const states = kind === PullState.document ? this.documentPullStates : this.workspacePullStates
    return states.get(key)?.resultId
  }

  public getAllResultIds(): PreviousResultId[] {
    const result: PreviousResultId[] = []
    for (let [uri, value] of this.workspacePullStates) {
      if (this.documentPullStates.has(uri)) {
        value = this.documentPullStates.get(uri)!
      }
      if (value.resultId !== undefined) {
        result.push({ uri, value: value.resultId })
      }
    }
    return result
  }
}

export class DiagnosticRequestor extends BaseFeature<DiagnosticProviderMiddleware, $DiagnosticPullOptions> implements Disposable {
  private isDisposed: boolean
  private enableWorkspace: boolean
  private readonly client: FeatureClient<DiagnosticProviderMiddleware, $DiagnosticPullOptions>
  private readonly options: DiagnosticRegistrationOptions

  public readonly onDidChangeDiagnosticsEmitter: Emitter<void>
  public readonly provider: DiagnosticProvider
  private readonly diagnostics: DiagnosticCollection
  private readonly openRequests: Map<string, RequestState>
  private readonly documentStates: DocumentPullStateTracker

  private workspaceErrorCounter: number
  private workspaceCancellation: CancellationTokenSource | undefined
  private workspaceTimeout: Disposable | undefined

  public constructor(client: FeatureClient<DiagnosticProviderMiddleware, $DiagnosticPullOptions>, options: DiagnosticRegistrationOptions) {
    super(client)
    this.client = client
    this.options = options
    this.enableWorkspace = options.workspaceDiagnostics && this.client.clientOptions.diagnosticPullOptions?.workspace !== false

    this.isDisposed = false
    this.onDidChangeDiagnosticsEmitter = new Emitter<void>()
    this.provider = this.createProvider()

    this.diagnostics = languages.createDiagnosticCollection(options.identifier ? options.identifier : client.id)
    this.openRequests = new Map()
    this.documentStates = new DocumentPullStateTracker()
    this.workspaceErrorCounter = 0
  }

  public knows(kind: PullState, textDocument: TextDocument): boolean {
    return this.documentStates.tracks(kind, textDocument)
  }

  public trackingDocuments(): string[] {
    return this.documentStates.trackingDocuments()
  }

  public forget(kind: PullState, document: TextDocument): void {
    this.documentStates.unTrack(kind, document)
  }

  public pull(document: TextDocument, cb?: () => void): void {
    this.pullAsync(document).then(() => {
      if (cb) {
        cb()
      }
    }, error => {
      this.client.error(`Document pull failed for text document ${document.uri}`, error)
    })
  }

  private async pullAsync(document: TextDocument): Promise<void> {
    if (this.isDisposed) return
    const uri = document.uri
    const version = document.version
    const currentRequestState = this.openRequests.get(uri)
    const documentState = this.documentStates.track(PullState.document, document)
    if (currentRequestState === undefined) {
      const tokenSource = new CancellationTokenSource()
      this.openRequests.set(uri, { state: RequestStateKind.active, document, version, tokenSource })
      let report: DocumentDiagnosticReport | undefined
      let afterState: RequestState | undefined
      try {
        report = await this.provider.provideDiagnostics(document, documentState.resultId, tokenSource.token) ?? { kind: DocumentDiagnosticReportKind.Full, items: [] }
      } catch (error) {
        if (error instanceof LSPCancellationError && error.data && DiagnosticServerCancellationData.is(error.data) && error.data.retriggerRequest === false) {
          afterState = { state: RequestStateKind.outDated, document }
        }
        if (afterState === undefined && error instanceof CancellationError) {
          afterState = { state: RequestStateKind.reschedule, document }
        } else {
          throw error
        }
      }
      afterState = afterState ?? this.openRequests.get(uri)
      if (afterState === undefined) {
        // This shouldn't happen. Log it
        this.client.error(`Lost request state in diagnostic pull model. Clearing diagnostics for ${uri}`)
        this.diagnostics.delete(uri)
        return
      }
      this.openRequests.delete(uri)
      const visible = window.visibleTextEditors.some(editor => editor.document.uri === uri)
      if (!visible) {
        this.documentStates.unTrack(PullState.document, document)
        return
      }
      if (afterState.state === RequestStateKind.outDated) return

      // report is only undefined if the request has thrown.
      if (report !== undefined) {
        if (report.kind === DocumentDiagnosticReportKind.Full) {
          this.diagnostics.set(uri, report.items)
        }
        documentState.pulledVersion = version
        documentState.resultId = report.resultId
      }
      if (afterState.state === RequestStateKind.reschedule) {
        this.pull(document)
      }
    } else {
      if (currentRequestState.state === RequestStateKind.active) {
        // Cancel the current request and reschedule a new one when the old one returned.
        currentRequestState.tokenSource.cancel()
        this.openRequests.set(uri, { state: RequestStateKind.reschedule, document: currentRequestState.document })
      } else if (currentRequestState.state === RequestStateKind.outDated) {
        this.openRequests.set(uri, { state: RequestStateKind.reschedule, document: currentRequestState.document })
      }
    }
  }

  public forgetDocument(document: TextDocument): void {
    const uri = document.uri
    const request = this.openRequests.get(uri)
    if (this.enableWorkspace) {
      // If we run workspace diagnostic pull a last time for the diagnostics
      // and the rely on getting them from the workspace result.
      if (request !== undefined) {
        this.openRequests.set(uri, { state: RequestStateKind.reschedule, document })
      } else {
        this.pull(document, () => {
          this.forget(PullState.document, document)
        })
      }
    } else {
      // We have normal pull or inter file dependencies. In this case we
      // clear the diagnostics (to have the same start as after startup).
      // We also cancel outstanding requests.
      if (request !== undefined) {
        if (request.state === RequestStateKind.active) {
          request.tokenSource.cancel()
        }
        this.openRequests.delete(uri)
      }
      this.diagnostics.delete(uri.toString())
      this.forget(PullState.document, document)
    }
  }

  public pullWorkspace(): void {
    if (!this.enableWorkspace) return
    this.pullWorkspaceAsync().then(() => {
      this.workspaceTimeout = RAL().timer.setTimeout(() => {
        this.pullWorkspace()
      }, pullDebounce)
    }, error => {
      if (!(error instanceof LSPCancellationError) && !DiagnosticServerCancellationData.is(error.data)) {
        this.client.error(`Workspace diagnostic pull failed.`, error)
        this.workspaceErrorCounter++
      }
      if (this.workspaceErrorCounter <= 5) {
        this.workspaceTimeout = RAL().timer.setTimeout(() => {
          this.pullWorkspace()
        }, pullDebounce)
      }
    })
  }

  private async pullWorkspaceAsync(): Promise<void> {
    if (!this.provider.provideWorkspaceDiagnostics) {
      return
    }
    if (this.workspaceCancellation !== undefined) {
      this.workspaceCancellation.cancel()
      this.workspaceCancellation = undefined
    }
    this.workspaceCancellation = new CancellationTokenSource()
    const previousResultIds: PreviousResultId[] = this.documentStates.getAllResultIds()
    await this.provider.provideWorkspaceDiagnostics(previousResultIds, this.workspaceCancellation.token, chunk => {
      if (!chunk || this.isDisposed) {
        return
      }
      for (const item of chunk.items) {
        if (item.kind === DocumentDiagnosticReportKind.Full) {
          // Favour document pull result over workspace results. So skip if it is tracked
          // as a document result.
          if (!this.documentStates.tracks(PullState.document, URI.parse(item.uri))) {
            this.diagnostics.set(item.uri.toString(), item.items)
          }
        }
        this.documentStates.update(PullState.workspace, URI.parse(item.uri), item.version ?? undefined, item.resultId)
      }
    })
  }

  private createProvider(): DiagnosticProvider {
    const provider: DiagnosticProvider = {
      onDidChangeDiagnostics: this.onDidChangeDiagnosticsEmitter.event,
      provideDiagnostics: (document, previousResultId, token) => {
        const middleware = this.client.middleware!
        const provideDiagnostics: ProvideDiagnosticSignature = (document, previousResultId, token) => {
          const uri = document instanceof URI ? document.toString() : document.uri
          const params: DocumentDiagnosticParams = {
            identifier: this.options.identifier,
            textDocument: { uri },
            previousResultId
          }
          return this.sendRequest(DocumentDiagnosticRequest.type, params, token, { kind: DocumentDiagnosticReportKind.Full, items: [] }).then(async result => {
            if (result === undefined || result === null || this.isDisposed) {
              return { kind: DocumentDiagnosticReportKind.Full, items: [] }
            }
            // make handleDiagnostics middleware works
            if (middleware.handleDiagnostics && result.kind == DocumentDiagnosticReportKind.Full) {
              middleware.handleDiagnostics(uri, result.items, (_, diagnostics) => {
                result.items = diagnostics
              })
            }
            return result
          })
        }
        return middleware.provideDiagnostics
          ? middleware.provideDiagnostics(document, previousResultId, token, provideDiagnostics)
          : provideDiagnostics(document, previousResultId, token)
      }
    }
    if (this.options.workspaceDiagnostics) {
      provider.provideWorkspaceDiagnostics = (resultIds, token, resultReporter): ProviderResult<WorkspaceDiagnosticReport> => {
        const provideWorkspaceDiagnostics: ProvideWorkspaceDiagnosticSignature = (resultIds, token): ProviderResult<WorkspaceDiagnosticReport> => {
          const partialResultToken = uuid()
          const disposable = this.client.onProgress(WorkspaceDiagnosticRequest.partialResult, partialResultToken, partialResult => {
            if (partialResult == undefined) {
              resultReporter(null)
              return
            }
            resultReporter(partialResult as WorkspaceDiagnosticReportPartialResult)
          })
          const params: WorkspaceDiagnosticParams & { __token?: string } = {
            identifier: this.options.identifier,
            previousResultIds: resultIds,
            partialResultToken
          }
          return this.sendRequest(WorkspaceDiagnosticRequest.type, params, token, { items: [] }).then(async (result): Promise<WorkspaceDiagnosticReport> => {
            resultReporter(result)
            return { items: [] }
          }).finally(() => {
            disposable.dispose()
          })
        }
        const middleware: DiagnosticProviderMiddleware = this.client.middleware!
        return middleware.provideWorkspaceDiagnostics
          ? middleware.provideWorkspaceDiagnostics(resultIds, token, resultReporter, provideWorkspaceDiagnostics)
          : provideWorkspaceDiagnostics(resultIds, token, resultReporter)
      }
    }
    return provider
  }

  public dispose(): void {
    this.isDisposed = true
    // Cancel and clear workspace pull if present.
    this.workspaceCancellation?.cancel()
    this.workspaceTimeout?.dispose()
    // Cancel all request and mark open requests as outdated.
    for (const request of this.openRequests.values()) {
      if (request.state === RequestStateKind.active) {
        request.tokenSource.cancel()
      }
    }
    this.openRequests.clear()
  }
}

export class BackgroundScheduler implements Disposable {

  private readonly diagnosticRequestor: Requestor
  private endDocument: TextDocument | undefined
  private readonly documents: LinkedMap<string, TextDocument>
  private intervalHandle: Disposable | undefined

  public constructor(diagnosticRequestor: Requestor) {
    this.diagnosticRequestor = diagnosticRequestor
    this.documents = new LinkedMap()
  }

  public add(document: TextDocument): void {
    const key = document.uri
    if (this.documents.has(key)) return
    this.documents.set(key, document, Touch.AsNew)
    this.trigger()
  }

  public remove(document: TextDocument): void {
    const key = document.uri
    if (this.documents.has(key)) {
      this.documents.delete(key)
      // Do a last pull
      this.diagnosticRequestor.pull(document)
    }
    // No more documents. Stop background activity.
    if (this.documents.size === 0) {
      this.stop()
    } else if (document.uri === this.endDocument?.uri) {
      // Make sure we have a correct last document. It could have
      this.endDocument = this.documents.last
    }
  }

  public trigger(): void {
    // We have a round running. So simply make sure we run up to the
    // last document
    if (this.intervalHandle !== undefined) {
      this.endDocument = this.documents.last
      return
    }
    this.endDocument = this.documents.last
    this.intervalHandle = RAL().timer.setInterval(() => {
      const document = this.documents.first
      if (document !== undefined) {
        const key = document.uri
        this.diagnosticRequestor.pull(document)
        this.documents.set(key, document, Touch.AsNew)
        if (document === this.endDocument) {
          this.stop()
        }
      }
    }, 200)
  }

  public dispose(): void {
    this.stop()
    this.documents.clear()
  }

  private stop(): void {
    this.intervalHandle?.dispose()
    this.intervalHandle = undefined
    this.endDocument = undefined
  }
}

class DiagnosticFeatureProviderImpl implements DiagnosticProviderShape {
  public readonly disposable: Disposable
  private readonly diagnosticRequestor: DiagnosticRequestor
  private activeTextDocument: TextDocument | undefined
  private readonly backgroundScheduler: BackgroundScheduler

  constructor(client: FeatureClient<DiagnosticProviderMiddleware, $DiagnosticPullOptions>, options: DiagnosticRegistrationOptions) {
    const diagnosticPullOptions = client.clientOptions.diagnosticPullOptions!
    const documentSelector = options.documentSelector!
    const disposables: Disposable[] = []
    const ignored = diagnosticPullOptions.ignored ?? []

    const matches = (document: TextDocument): boolean => {
      if (workspace.match(documentSelector, document) <= 0) return false
      const visible = window.visibleTextEditors.some(editor => editor.document.uri === document.uri)
      if (!visible) return false
      if (ignored.length > 0 && ignored.some(p => minimatch(URI.parse(document.uri).fsPath, p, { dot: true }))) return false
      return true
    }

    this.diagnosticRequestor = new DiagnosticRequestor(client, options)
    this.backgroundScheduler = new BackgroundScheduler(this.diagnosticRequestor)
    const addToBackgroundIfNeeded = (document: TextDocument): void => {
      if (!matches(document) || !options.interFileDependencies || this.activeTextDocument?.uri === document.uri) return
      this.backgroundScheduler.add(document)
    }

    this.activeTextDocument = window.activeTextEditor?.document.textDocument
    window.onDidChangeActiveTextEditor(editor => {
      const oldActive = this.activeTextDocument
      let textDocument = this.activeTextDocument = editor?.document.textDocument
      if (oldActive !== undefined) {
        addToBackgroundIfNeeded(oldActive)
      }
      if (textDocument != null) this.backgroundScheduler.remove(textDocument)
    }, null, disposables)

    // We always pull on open.
    const openFeature = client.getFeature(DidOpenTextDocumentNotification.method)
    disposables.push(openFeature.onNotificationSent(event => {
      const textDocument = event.original
      if (matches(textDocument)) {
        this.diagnosticRequestor.pull(textDocument, () => { addToBackgroundIfNeeded(textDocument) })
      }
    }))

    const shouldPull = (textDocument: TextDocument, mode: DiagnosticPullMode): boolean => {
      if (diagnosticPullOptions.filter && diagnosticPullOptions.filter(textDocument, mode)) return false
      if (!this.diagnosticRequestor.knows(PullState.document, textDocument)) return false
      return true
    }

    if (diagnosticPullOptions.onChange === true) {
      const changeFeature = client.getFeature(DidChangeTextDocumentNotification.method)
      disposables.push(changeFeature.onNotificationSent(async event => {
        const textDocument = workspace.getDocument(event.original.bufnr).textDocument
        if (event.original.contentChanges.length == 0) return
        if (shouldPull(textDocument, DiagnosticPullMode.onType)) {
          this.diagnosticRequestor.pull(textDocument, () => { this.backgroundScheduler.trigger() })
        }
      }))
    }

    if (diagnosticPullOptions.onSave === true) {
      const saveFeature = client.getFeature(DidSaveTextDocumentNotification.method)
      disposables.push(saveFeature.onNotificationSent(event => {
        const textDocument = event.original
        if (shouldPull(textDocument, DiagnosticPullMode.onSave)) {
          this.diagnosticRequestor.pull(event.original, () => { this.backgroundScheduler.trigger() })
        }
      }))
    }

    const closeFeature = client.getFeature(DidCloseTextDocumentNotification.method)
    disposables.push(closeFeature.onNotificationSent(event => {
      this.cleanUpDocument(event.original)
    }))

    // We received a did change from the server.
    this.diagnosticRequestor.onDidChangeDiagnosticsEmitter.event(() => {
      for (const textDocument of workspace.textDocuments) {
        if (matches(textDocument)) {
          this.diagnosticRequestor.pull(textDocument)
        }
      }
    })

    window.onDidChangeVisibleTextEditors(editors => {
      const handled: Set<string> = new Set()
      const tracking = this.diagnosticRequestor.trackingDocuments()
      editors.forEach(editor => {
        let { uri, textDocument } = editor.document
        if (handled.has(uri)) return
        handled.add(uri)
        if (matches(textDocument) && !tracking.includes(uri)) {
          this.diagnosticRequestor.pull(textDocument, () => { addToBackgroundIfNeeded(textDocument) })
        }
      })
      // cleanUp hidden documents
      tracking.forEach(uri => {
        if (handled.has(uri)) return
        let doc = workspace.getDocument(uri)
        if (doc && doc.attached) this.cleanUpDocument(doc.textDocument)
      })
    }, null, disposables)

    // da348dc5-c30a-4515-9d98-31ff3be38d14 is the test UUID to test the middle ware. So don't auto trigger pulls.
    if (options.workspaceDiagnostics === true && options.identifier !== 'da348dc5-c30a-4515-9d98-31ff3be38d14') {
      this.diagnosticRequestor.pullWorkspace()
    }

    // disposables.push(languages.registerDiagnosticsProvider(options.documentSelector, this.diagnosticRequestor.provider))
    this.disposable = Disposable.create(() => [...disposables, this.backgroundScheduler, this.diagnosticRequestor].forEach(d => d.dispose()))
  }

  public get onDidChangeDiagnosticsEmitter(): Emitter<void> {
    return this.diagnosticRequestor.onDidChangeDiagnosticsEmitter
  }

  public get diagnostics(): DiagnosticProvider {
    return this.diagnosticRequestor.provider
  }

  public knows(kind: PullState, textDocument: TextDocument): boolean {
    return this.diagnosticRequestor.knows(kind, textDocument)
  }

  private cleanUpDocument(document: TextDocument): void {
    if (this.diagnosticRequestor.knows(PullState.document, document)) {
      this.diagnosticRequestor.forgetDocument(document)
      this.backgroundScheduler.remove(document)
    }
  }
}

export class DiagnosticFeature extends TextDocumentLanguageFeature<DiagnosticOptions, DiagnosticRegistrationOptions, DiagnosticProviderShape, DiagnosticProviderMiddleware> {

  constructor(client: FeatureClient<DiagnosticProviderMiddleware, $DiagnosticPullOptions>) {
    super(client, DocumentDiagnosticRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    let capability = ensure(ensure(capabilities, 'textDocument')!, 'diagnostic')!
    capability.dynamicRegistration = true
    capability.relatedDocumentSupport = true

    ensure(ensure(capabilities, 'workspace')!, 'diagnostics')!.refreshSupport = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    const client = this._client
    let [id, options] = this.getRegistration(documentSelector, capabilities.diagnosticProvider)
    if (!id || !options) return
    client.onRequest(DiagnosticRefreshRequest.type, async () => {
      for (const provider of this.getAllProviders()) {
        provider.onDidChangeDiagnosticsEmitter.fire()
      }
    })
    this.register({ id, registerOptions: options })
  }

  protected registerLanguageProvider(options: DiagnosticRegistrationOptions): [Disposable, DiagnosticProviderShape] {
    const provider = new DiagnosticFeatureProviderImpl(this._client, options)
    return [provider.disposable, provider]
  }
}
