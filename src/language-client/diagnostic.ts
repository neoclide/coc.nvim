'use strict'
import { v4 as uuid } from 'uuid'
import type {
  CancellationToken, ClientCapabilities, Diagnostic, DiagnosticOptions, DiagnosticRegistrationOptions, DocumentDiagnosticParams, DocumentDiagnosticReport, DocumentSelector, PreviousResultId, ServerCapabilities, WorkspaceDiagnosticParams, WorkspaceDiagnosticReport, WorkspaceDiagnosticReportPartialResult
} from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DiagnosticTag } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import DiagnosticCollection from '../diagnostic/collection'
import languages from '../languages'
import { DiagnosticProvider, ProviderResult, ResultReporter } from '../provider'
import { TextDocumentMatch } from '../types'
import { defaultValue, getConditionValue } from '../util'
import { CancellationError } from '../util/errors'
import { LinkedMap, Touch } from '../util/map'
import { minimatch } from '../util/node'
import { CancellationTokenSource, DiagnosticRefreshRequest, DiagnosticServerCancellationData, DidChangeTextDocumentNotification, DidCloseTextDocumentNotification, DidOpenTextDocumentNotification, DidSaveTextDocumentNotification, Disposable, DocumentDiagnosticReportKind, DocumentDiagnosticRequest, Emitter, RAL, WorkspaceDiagnosticRequest } from '../util/protocol'
import window from '../window'
import workspace from '../workspace'
import { BaseFeature, ensure, FeatureClient, LSPCancellationError, TextDocumentLanguageFeature } from './features'

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
  /**
   * An event that signals that the diagnostics should be refreshed for
   * all documents.
   */
  onDidChangeDiagnosticsEmitter: Emitter<void>
  /**
   * The provider of diagnostics.
   */
  diagnostics: DiagnosticProvider
  /**
   * Forget the given document and remove all diagnostics.
   * @param document The document to forget.
   */
  forget(document: TextDocument): void
  knows: (kind: PullState, textDocument: TextDocument) => boolean
}

export enum DiagnosticPullMode {
  onType = 'onType',
  onSave = 'onSave',
  onFocus = 'onFocus'
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
   * Whether to pull for diagnostics on editor focus.
   */
  onFocus?: boolean

  /**
   * Whether to pull workspace diagnostics.
   */
  workspace?: boolean
  /**
   * Minimatch patterns to match full filepath that should be ignored for pullDiagnostic.
   */
  ignored?: string[]

  /**
   * An optional filter method that is consulted when triggering a diagnostic pull during document change or document
   * save or editor focus.
   * The document gets filtered if the method returns `true`.
   * @param document the document that changes or got save
   * @param mode the mode
   */
  filter?(document: TextDocumentMatch, mode: DiagnosticPullMode): boolean
  /**
   * An optional match method that is consulted when pulling for diagnostics
   * when only a URI is known (e.g. for not instantiated tabs)
   *
   * The method should return `true` if the document selector matches the
   * given resource. See also the `vscode.languages.match` function.
   * @param documentSelector The document selector.
   * @param resource The resource.
   * @returns whether the resource is matched by the given document selector.
   */
  match?(documentSelector: DocumentSelector, resource: URI): boolean
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

namespace DocumentOrUri {
  export function asKey(document: TextDocument | URI): string {
    return document instanceof URI ? document.toString() : document.uri
  }
}

const workspacePullDebounce = getConditionValue(3000, 10)

export class DocumentPullStateTracker {
  private readonly documentPullStates: Map<string, DocumentPullState>
  private readonly workspacePullStates: Map<string, DocumentPullState>

  constructor() {
    this.documentPullStates = new Map()
    this.workspacePullStates = new Map()
  }

  public track(kind: PullState, textDocument: TextDocument): DocumentPullState
  public track(kind: PullState, uri: URI, version: number | undefined): DocumentPullState
  public track(kind: PullState, document: TextDocument | URI, arg1?: number): DocumentPullState {
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
  public update(kind: PullState, document: TextDocument | URI, arg1: string | number | undefined, arg2?: string): void {
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
    const key = DocumentOrUri.asKey(document)
    const states = kind === PullState.document ? this.documentPullStates : this.workspacePullStates
    states.delete(key)
  }

  public tracks(kind: PullState, document: TextDocument | URI): boolean {
    const key = DocumentOrUri.asKey(document)
    const states = kind === PullState.document ? this.documentPullStates : this.workspacePullStates
    return states.has(key)
  }

  public trackingDocuments(): string[] {
    return Array.from(this.documentPullStates.keys())
  }

  public getResultId(kind: PullState, document: TextDocument | URI): string | undefined {
    const key = DocumentOrUri.asKey(document)
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

    this.diagnostics = languages.createDiagnosticCollection(defaultValue(options.identifier, client.id))
    this.openRequests = new Map()
    this.documentStates = new DocumentPullStateTracker()
    this.workspaceErrorCounter = 0
  }

  public knows(kind: PullState, document: TextDocument | URI): boolean {
    return this.documentStates.tracks(kind, document) || this.openRequests.has(DocumentOrUri.asKey(document))
  }

  public forget(kind: PullState, document: TextDocument | URI): void {
    this.documentStates.unTrack(kind, document)
  }

  public pull(document: TextDocument | URI, cb?: () => void): void {
    if (this.isDisposed) {
      return
    }
    const uri = DocumentOrUri.asKey(document)
    this.pullAsync(document).then(() => {
      if (cb) {
        cb()
      }
    }, error => {
      this.client.error(`Document pull failed for text document ${uri.toString()}`, error, false)
    })
  }

  public async pullAsync(document: TextDocument | URI, version?: number): Promise<void> {
    if (this.isDisposed) {
      return
    }
    const isUri = document instanceof URI
    const key = DocumentOrUri.asKey(document)
    version = isUri ? version : document.version
    const currentRequestState = this.openRequests.get(key)
    const documentState = isUri
      ? this.documentStates.track(PullState.document, document, version)
      : this.documentStates.track(PullState.document, document)
    if (currentRequestState === undefined) {
      const tokenSource = new CancellationTokenSource()
      this.openRequests.set(key, { state: RequestStateKind.active, document, version, tokenSource })
      let report: DocumentDiagnosticReport | undefined
      let afterState: RequestState | undefined
      try {
        report = await this.provider.provideDiagnostics(document, documentState.resultId, tokenSource.token) ?? { kind: DocumentDiagnosticReportKind.Full, items: [] }
      } catch (error) {
        if (error instanceof LSPCancellationError && DiagnosticServerCancellationData.is(error.data) && error.data.retriggerRequest === false) {
          afterState = { state: RequestStateKind.outDated, document }
        }
        if (afterState === undefined && error instanceof CancellationError) {
          afterState = { state: RequestStateKind.reschedule, document }
        } else {
          throw error
        }
      }
      afterState = afterState ?? this.openRequests.get(key)
      if (afterState === undefined) {
        // This shouldn't happen. Log it
        this.client.error(`Lost request state in diagnostic pull model. Clearing diagnostics for ${key}`)
        this.diagnostics.delete(key)
        return
      }
      this.openRequests.delete(key)
      if (!workspace.tabs.isVisible(document)) {
        this.documentStates.unTrack(PullState.document, document)
        return
      }
      if (afterState.state === RequestStateKind.outDated) {
        return
      }
      // report is only undefined if the request has thrown.
      if (report !== undefined) {
        if (report.kind === DocumentDiagnosticReportKind.Full) {
          this.diagnostics.set(key, report.items)
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
        this.openRequests.set(key, { state: RequestStateKind.reschedule, document: currentRequestState.document })
      } else if (currentRequestState.state === RequestStateKind.outDated) {
        this.openRequests.set(key, { state: RequestStateKind.reschedule, document: currentRequestState.document })
      }
    }
  }

  public forgetDocument(document: TextDocument | URI): void {
    const key = DocumentOrUri.asKey(document)
    const request = this.openRequests.get(key)
    if (this.options.workspaceDiagnostics) {
      // If we run workspace diagnostic pull a last time for the diagnostics
      // and the rely on getting them from the workspace result.
      if (request !== undefined) {
        this.openRequests.set(key, { state: RequestStateKind.reschedule, document })
      } else {
        this.pull(document, () => {
          this.forget(PullState.document, document)
        })
      }

      // The previous resultId from the workspace pull state can map to diagnostics we no longer have
      // (e.g. they came from a workspace report but were overwritten by a later document pull request).
      // Clear the workspace pull state for this document as well to ensure we get fresh diagnostics.
      this.forget(PullState.workspace, document)
    } else {
      // We have normal pull or inter file dependencies. In this case we
      // clear the diagnostics (to have the same start as after startup).
      // We also cancel outstanding requests.
      if (request !== undefined) {
        if (request.state === RequestStateKind.active) {
          request.tokenSource.cancel()
        }
        this.openRequests.set(key, { state: RequestStateKind.outDated, document })
      }
      this.diagnostics.delete(key)
      this.forget(PullState.document, document)
    }
  }

  public pullWorkspace(): void {
    if (!this.enableWorkspace) return
    this.pullWorkspaceAsync().then(() => {
      this.workspaceTimeout = RAL().timer.setTimeout(() => {
        this.pullWorkspace()
      }, workspacePullDebounce)
    }, error => {
      if (!(error instanceof LSPCancellationError) && !DiagnosticServerCancellationData.is(error.data)) {
        this.client.error(`Workspace diagnostic pull failed.`, error)
        this.workspaceErrorCounter++
      }
      if (this.workspaceErrorCounter <= 5) {
        this.workspaceTimeout = RAL().timer.setTimeout(() => {
          this.pullWorkspace()
        }, workspacePullDebounce)
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
        const client = this._client
        const provideDiagnostics: ProvideDiagnosticSignature = (document, previousResultId, token) => {
          const uri = client.code2ProtocolConverter.asUri(document instanceof URI ? document : URI.parse(document.uri))
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
        const provideWorkspaceDiagnostics: ProvideWorkspaceDiagnosticSignature = (resultIds, token, resultReporter): ProviderResult<WorkspaceDiagnosticReport> => {
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

const timeoutDebounce = getConditionValue(500, 10)

export class BackgroundScheduler implements Disposable {

  private readonly client: FeatureClient<DiagnosticProviderMiddleware, $DiagnosticPullOptions>
  private readonly diagnosticRequestor: DiagnosticRequestor
  private lastDocumentToPull: TextDocument | URI | undefined
  private readonly documents: LinkedMap<string, TextDocument>
  private timeoutHandle: Disposable | undefined
  // The problem is that there could be outstanding diagnostic requests
  // when we shutdown which when we receive the result will trigger a
  // reschedule. So we remember if the background scheduler got disposed
  // and ignore those re-schedules
  private isDisposed: boolean

  public constructor(client: FeatureClient<DiagnosticProviderMiddleware, $DiagnosticPullOptions>, diagnosticRequestor: DiagnosticRequestor) {
    this.client = client
    this.diagnosticRequestor = diagnosticRequestor
    this.documents = new LinkedMap()
    this.isDisposed = false
  }

  public add(document: TextDocument): void {
    if (this.isDisposed === true) {
      return
    }
    const key = document.uri
    if (this.documents.has(key)) {
      return
    }
    this.documents.set(key, document, Touch.AsNew)
    // Make sure we run up to that document. We could
    // consider inserting it after the current last
    // document for performance reasons but it might not catch
    // all interfile dependencies.
    this.lastDocumentToPull = document
  }

  public remove(document: TextDocument | URI): void {
    const key = DocumentOrUri.asKey(document)
    this.documents.delete(key)
    // No more documents. Stop background activity.
    if (this.documents.size === 0) {
      this.stop()
      return
    }
    if (key === this.lastDocumentToPullKey()) {
      // The remove document was the one we would run up to. So
      // take the one before it.
      const before = this.documents.before(key)
      if (before === undefined) {
        this.stop()
      } else {
        this.lastDocumentToPull = before
      }
    }
  }

  public trigger(): void {
    this.lastDocumentToPull = this.documents.last
    this.runLoop()
  }

  private runLoop(): void {
    if (this.isDisposed === true) {
      return
    }

    // We have an empty background list. Make sure we stop
    // background activity.
    if (this.documents.size === 0) {
      this.stop()
      return
    }

    // We have no last document anymore so stop the loop
    if (this.lastDocumentToPull === undefined) {
      return
    }

    // We have a timeout in the loop. So we should not schedule
    // another run.
    if (this.timeoutHandle !== undefined) {
      return
    }
    this.timeoutHandle = RAL().timer.setTimeout(() => {
      const document = this.documents.first
      if (document === undefined) {
        return
      }
      const key = DocumentOrUri.asKey(document)
      this.diagnosticRequestor.pullAsync(document).catch(error => {
        this.client.error(`Document pull failed for text document ${key}`, error, false)
      }).finally(() => {
        this.timeoutHandle = undefined
        this.documents.set(key, document, Touch.Last)
        if (key !== this.lastDocumentToPullKey()) {
          this.runLoop()
        }
      })
    }, timeoutDebounce)
  }

  public dispose(): void {
    this.stop()
    this.documents.clear()
    this.lastDocumentToPull = undefined
  }

  private stop(): void {
    this.timeoutHandle?.dispose()
    this.timeoutHandle = undefined
    this.lastDocumentToPull = undefined
  }

  private lastDocumentToPullKey(): string | undefined {
    return this.lastDocumentToPull !== undefined ? DocumentOrUri.asKey(this.lastDocumentToPull) : undefined
  }
}

class DiagnosticFeatureProviderImpl implements DiagnosticProviderShape {
  public readonly disposable: Disposable
  private readonly diagnosticRequestor: DiagnosticRequestor
  private activeTextDocument: TextDocument | undefined
  private readonly backgroundScheduler: BackgroundScheduler

  constructor(client: FeatureClient<DiagnosticProviderMiddleware, $DiagnosticPullOptions>, options: DiagnosticRegistrationOptions) {
    const diagnosticPullOptions = Object.assign({ onChange: false, onSave: false, onFocus: false }, client.clientOptions.diagnosticPullOptions)

    const selector = options.documentSelector ?? []
    const disposables: Disposable[] = []
    const ignored = diagnosticPullOptions.ignored ?? []

    const matches = (document: TextDocument): boolean => {
      if (diagnosticPullOptions.match !== undefined) {
        return diagnosticPullOptions.match(selector, URI.parse(document.uri))
      }
      if (workspace.match(selector, document) <= 0 || !workspace.tabs.isVisible(document)) return false
      if (ignored.length > 0 && ignored.some(p => minimatch(URI.parse(document.uri).fsPath, p, { dot: true }))) return false
      return true
    }

    const isActiveDocument = (document: TextDocument): boolean => {
      return document.uri === this.activeTextDocument?.uri
    }

    const considerDocument = (textDocument: TextDocument, mode: DiagnosticPullMode): boolean => {
      return (diagnosticPullOptions.filter === undefined || !diagnosticPullOptions.filter(textDocument, mode))
        && this.diagnosticRequestor.knows(PullState.document, textDocument)
    }

    this.diagnosticRequestor = new DiagnosticRequestor(client, options)
    this.backgroundScheduler = new BackgroundScheduler(client, this.diagnosticRequestor)
    const addToBackgroundIfNeeded = (document: TextDocument): void => {
      if (!matches(document) || !options.interFileDependencies || isActiveDocument(document) || diagnosticPullOptions.onChange === false) return
      this.backgroundScheduler.add(document)
    }

    this.activeTextDocument = window.activeTextEditor?.document.textDocument
    disposables.push(window.onDidChangeActiveTextEditor(editor => {
      const oldActive = this.activeTextDocument
      this.activeTextDocument = editor?.document.textDocument
      if (oldActive !== undefined) {
        addToBackgroundIfNeeded(oldActive)
      }
      if (this.activeTextDocument !== undefined) {
        this.backgroundScheduler.remove(this.activeTextDocument)
        if (diagnosticPullOptions.onFocus === true && matches(this.activeTextDocument) && considerDocument(this.activeTextDocument, DiagnosticPullMode.onFocus)) {
          this.diagnosticRequestor.pull(this.activeTextDocument)
        }
      }
    }))

    // We always pull on open.
    const openFeature = client.getFeature(DidOpenTextDocumentNotification.method)
    disposables.push(openFeature.onNotificationSent(event => {
      const textDocument = event.original
      if (this.diagnosticRequestor.knows(PullState.document, textDocument)) {
        return
      }
      if (matches(textDocument)) {
        this.diagnosticRequestor.pull(textDocument, () => { addToBackgroundIfNeeded(textDocument) })
      }
    }))

    disposables.push(workspace.tabs.onOpen(opened => {
      for (const resource of opened) {
        // We already know about this document. This can happen via a document open.
        if (this.diagnosticRequestor.knows(PullState.document, resource)) {
          continue
        }
        const uriStr = resource.toString()
        let textDocument = workspace.getDocument(uriStr)!.textDocument
        if (textDocument !== undefined && matches(textDocument)) {
          this.diagnosticRequestor.pull(textDocument, () => { addToBackgroundIfNeeded(textDocument!) })
        }
      }
    }))

    // Pull all diagnostics for documents that are already open
    for (const textDocument of workspace.textDocuments) {
      if (matches(textDocument)) {
        this.diagnosticRequestor.pull(textDocument, () => { addToBackgroundIfNeeded(textDocument) })
      }
    }

    if (diagnosticPullOptions.onChange === true) {
      const changeFeature = client.getFeature(DidChangeTextDocumentNotification.method)
      disposables.push(changeFeature.onNotificationSent(async event => {
        const textDocument = workspace.getDocument(event.original.bufnr).textDocument
        if (considerDocument(textDocument, DiagnosticPullMode.onType)) {
          this.diagnosticRequestor.pull(textDocument, () => { this.backgroundScheduler.trigger() })
        }
      }))
    }

    if (diagnosticPullOptions.onSave === true) {
      const saveFeature = client.getFeature(DidSaveTextDocumentNotification.method)
      disposables.push(saveFeature.onNotificationSent(event => {
        const textDocument = event.original
        if (considerDocument(textDocument, DiagnosticPullMode.onSave)) {
          this.diagnosticRequestor.pull(event.original)
        }
      }))
    }

    const closeFeature = client.getFeature(DidCloseTextDocumentNotification.method)
    disposables.push(closeFeature.onNotificationSent(event => {
      this.cleanUpDocument(event.original)
    }))

    // Same when a tabs closes.
    disposables.push(workspace.tabs.onClose(closed => {
      for (const document of closed) {
        this.cleanUpDocument(document)
      }
    }))

    // We received a did change from the server.
    this.diagnosticRequestor.onDidChangeDiagnosticsEmitter.event(() => {
      for (const textDocument of workspace.textDocuments) {
        if (matches(textDocument)) {
          this.diagnosticRequestor.pull(textDocument)
        }
      }
    })

    // da348dc5-c30a-4515-9d98-31ff3be38d14 is the test UUID to test the middle ware. So don't auto trigger pulls.
    if (options.workspaceDiagnostics === true && options.identifier !== 'da348dc5-c30a-4515-9d98-31ff3be38d14') {
      this.diagnosticRequestor.pullWorkspace()
    }

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

  public forget(document: TextDocument): void {
    this.cleanUpDocument(document)
  }

  private cleanUpDocument(document: TextDocument | URI): void {
    this.backgroundScheduler.remove(document)
    if (this.diagnosticRequestor.knows(PullState.document, document)) {
      this.diagnosticRequestor.forgetDocument(document)
    }
  }
}

export interface DiagnosticFeatureShape {
  refresh(): void
}

export class DiagnosticFeature extends TextDocumentLanguageFeature<DiagnosticOptions, DiagnosticRegistrationOptions, DiagnosticProviderShape, DiagnosticProviderMiddleware> implements DiagnosticFeatureShape {

  constructor(client: FeatureClient<DiagnosticProviderMiddleware, $DiagnosticPullOptions>) {
    super(client, DocumentDiagnosticRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    let capability = ensure(ensure(capabilities, 'textDocument')!, 'diagnostic')!
    capability.relatedInformation = true
    capability.tagSupport = { valueSet: [DiagnosticTag.Unnecessary, DiagnosticTag.Deprecated] }
    capability.codeDescriptionSupport = true
    capability.dataSupport = true
    capability.dynamicRegistration = true
    capability.relatedDocumentSupport = true

    ensure(ensure(capabilities, 'workspace')!, 'diagnostics')!.refreshSupport = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    const client = this._client
    client.onRequest(DiagnosticRefreshRequest.type, async () => {
      for (const provider of this.getAllProviders()) {
        provider.onDidChangeDiagnosticsEmitter.fire()
      }
    })
    let [id, options] = this.getRegistration(documentSelector, capabilities.diagnosticProvider)
    if (!id || !options) return
    this.register({ id, registerOptions: options })
  }

  protected registerLanguageProvider(options: DiagnosticRegistrationOptions): [Disposable, DiagnosticProviderShape] {
    const provider = new DiagnosticFeatureProviderImpl(this._client, options)
    return [provider.disposable, provider]
  }

  public refresh(): void {
    for (const provider of this.getAllProviders()) {
      provider.onDidChangeDiagnosticsEmitter.fire()
    }
  }
}
