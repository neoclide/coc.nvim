/* --------------------------------------------------------------------------------------------
* Copyright (c) Microsoft Corporation. All rights reserved.
* Licensed under the MIT License. See License.txt in the project root for license information.
* ------------------------------------------------------------------------------------------ */

import * as minimatch from 'minimatch'
import { v4 as uuid } from 'uuid'
import {
  CancellationToken, CancellationTokenSource, ClientCapabilities, DiagnosticOptions, DiagnosticRefreshRequest, DiagnosticRegistrationOptions, DiagnosticServerCancellationData, Disposable, DocumentDiagnosticParams, DocumentDiagnosticReport, DocumentDiagnosticReportKind, DocumentDiagnosticRequest, DocumentSelector, Emitter, LinkedMap, PreviousResultId, RAL, ServerCapabilities, TextDocumentFilter, Touch, WorkspaceDiagnosticParams, WorkspaceDiagnosticReport, WorkspaceDiagnosticReportPartialResult, WorkspaceDiagnosticRequest
} from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import DiagnosticCollection from '../diagnostic/collection'
import languages from '../languages'
import { DiagnosticProvider, ProviderResult, ResultReporter } from '../provider'
import window from '../window'
import workspace from '../workspace'
import { BaseLanguageClient, ensure, TextDocumentFeature } from './client'

export type ProvideDiagnosticSignature = (this: void, document: TextDocument | URI, previousResultId: string | undefined, token: CancellationToken) => ProviderResult<DocumentDiagnosticReport>

export type ProvideWorkspaceDiagnosticSignature = (this: void, resultIds: PreviousResultId[], token: CancellationToken, resultReporter: ResultReporter) => ProviderResult<WorkspaceDiagnosticReport>

export interface DiagnosticProviderMiddleware {
  provideDiagnostics?: (this: void, document: TextDocument | URI, previousResultId: string | undefined, token: CancellationToken, next: ProvideDiagnosticSignature) => ProviderResult<DocumentDiagnosticReport>
  provideWorkspaceDiagnostics?: (this: void, resultIds: PreviousResultId[], token: CancellationToken, resultReporter: ResultReporter, next: ProvideWorkspaceDiagnosticSignature) => ProviderResult<WorkspaceDiagnosticReport>
}

export interface DiagnosticProviderShape {
  onDidChangeDiagnosticsEmitter: Emitter<void>
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
   * An optional filter method that is consulted when triggering a
   * diagnostic pull during document change or document save.
   *
   * @param document the document that changes or got save
   * @param mode the mode
   */
  filter?(document: TextDocument, mode: DiagnosticPullMode): boolean

  /**
   * Whether to pull for diagnostics on resources of non instantiated
   * tabs. If it is set to true it is highly recommended to provide
   * a match method as well. Otherwise the client will not pull for
   * tabs if the used document selector specifies a language property
   * since the language value is not known for resources.
   */
  // TODO
  // onTabs?: boolean

  /**
   * A optional match method that is consulted when pulling for diagnostics
   * when only a URI is known (e.g. for not instantiated tabs)
   *
   * @param documentSelector the document selector
   * @param resource the resource.
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

enum PullState {
  document = 1,
  workspace = 2
}

class DocumentPullStateTracker {

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
      : [document.uri.toString(), URI.parse(document.uri), document.version, arg1 as string | undefined]
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
    const key = document instanceof URI ? document.toString() : document.uri.toString()
    const states = kind === PullState.document ? this.documentPullStates : this.workspacePullStates
    states.delete(key)
  }

  public tracks(kind: PullState, document: TextDocument | URI): boolean {
    const key = document instanceof URI ? document.toString() : document.uri.toString()
    const states = kind === PullState.document ? this.documentPullStates : this.workspacePullStates
    return states.has(key)
  }

  public getResultId(kind: PullState, document: TextDocument | URI): string | undefined {
    const key = document instanceof URI ? document.toString() : document.uri.toString()
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

class DiagnosticRequestor implements Disposable {

  private isDisposed: boolean
  private readonly client: BaseLanguageClient
  private readonly options: DiagnosticRegistrationOptions

  public readonly onDidChangeDiagnosticsEmitter: Emitter<void>
  public readonly provider: DiagnosticProvider
  private readonly diagnostics: DiagnosticCollection
  private readonly openRequests: Map<string, RequestState>
  private readonly documentStates: DocumentPullStateTracker

  private workspaceErrorCounter: number
  private workspaceCancellation: CancellationTokenSource | undefined
  private workspaceTimeout: Disposable | undefined

  public constructor(client: BaseLanguageClient, options: DiagnosticRegistrationOptions) {
    this.client = client
    this.options = options

    this.isDisposed = false
    this.onDidChangeDiagnosticsEmitter = new Emitter<void>()
    this.provider = this.createProvider()

    this.diagnostics = languages.createDiagnosticCollection(options.identifier)
    this.openRequests = new Map()
    this.documentStates = new DocumentPullStateTracker()
    this.workspaceErrorCounter = 0
  }

  public knows(kind: PullState, textDocument: TextDocument): boolean {
    return this.documentStates.tracks(kind, textDocument)
  }

  public pull(document: TextDocument | URI, cb?: () => void): void {
    const uri = document instanceof URI ? document : document.uri
    this.pullAsync(document).then(() => {
      if (cb) {
        cb()
      }
    }, error => {
        this.client.error(`Document pull failed for text document ${uri.toString()}`, error)
      })
  }

  private async pullAsync(document: TextDocument | URI, version?: number | undefined): Promise<void> {
    const isUri = document instanceof URI
    const uri = isUri ? document : document.uri
    const key = uri.toString()
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
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (error.data && DiagnosticServerCancellationData.is(error.data) && error.data.retriggerRequest === false) {
          afterState = { state: RequestStateKind.outDated, document }
        }
        if (afterState === undefined) {
          afterState = { state: RequestStateKind.reschedule, document }
        } else {
          throw error
        }
      }
      afterState = afterState ?? this.openRequests.get(key)
      if (afterState === undefined) {
        // This shouldn't happen. Log it
        this.client.error(`Lost request state in diagnostic pull model. Clearing diagnostics for ${key}`)
        this.diagnostics.delete(uri.toString())
        return
      }
      this.openRequests.delete(key)
      const u = document instanceof URI ? document.toString() : document.uri.toString()
      const visible = window.visibleTextEditors.some(editor => editor.document.uri.toString() === u)
      if (!visible) {
        this.documentStates.unTrack(PullState.document, document)
        return
      }
      if (afterState.state === RequestStateKind.outDated) {
        return
      }
      // report is only undefined if the request has thrown.
      if (report !== undefined) {
        if (report.kind === DocumentDiagnosticReportKind.Full) {
          this.diagnostics.set(uri.toString(), report.items)
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

  public cleanupPull(document: TextDocument): void {
    const uri = document instanceof URI ? document : document.uri
    const key = uri.toString()
    const request = this.openRequests.get(key)
    if (this.options.workspaceDiagnostics || this.options.interFileDependencies) {
      if (request !== undefined) {
        this.openRequests.set(key, { state: RequestStateKind.reschedule, document })
      } else {
        this.pull(document)
      }
    } else {
      if (request !== undefined) {
        if (request.state === RequestStateKind.active) {
          request.tokenSource.cancel()
        }
        this.openRequests.set(key, { state: RequestStateKind.outDated, document })
      }
      this.diagnostics.delete(uri.toString())
    }
  }

  public pullWorkspace(): void {
    this.pullWorkspaceAsync().then(() => {
      this.workspaceTimeout = RAL().timer.setTimeout(() => {
        this.pullWorkspace()
      }, 2000)
    }, error => {
        if (!DiagnosticServerCancellationData.is(error.data)) {
          this.client.error(`Workspace diagnostic pull failed.`, error)
          this.workspaceErrorCounter++
        }
        if (this.workspaceErrorCounter <= 5) {
          this.workspaceTimeout = RAL().timer.setTimeout(() => {
            this.pullWorkspace()
          }, 2000)
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
        const provideDiagnostics: ProvideDiagnosticSignature = (document, previousResultId, token) => {
          const params: DocumentDiagnosticParams = {
            identifier: this.options.identifier,
            textDocument: { uri: document instanceof URI ? document.toString() : document.uri },
            previousResultId
          }
          return this.client.sendRequest(DocumentDiagnosticRequest.type, params, token).then(async result => {
            if (result === undefined || result === null || this.isDisposed || token.isCancellationRequested) {
              return { kind: DocumentDiagnosticReportKind.Full, items: [] }
            }

            return result
          }, error => {
              return this.client.handleFailedRequest(DocumentDiagnosticRequest.type, token, error, { kind: DocumentDiagnosticReportKind.Full, items: [] })
            })
        }
        const middleware = this.client.clientOptions.middleware!
        return middleware.provideDiagnostics
          ? middleware.provideDiagnostics(document, previousResultId, token, provideDiagnostics)
          : provideDiagnostics(document, previousResultId, token)
      }
    }
    if (this.options.workspaceDiagnostics) {
      provider.provideWorkspaceDiagnostics = (resultIds, token, resultReporter): ProviderResult<WorkspaceDiagnosticReport> => {
        const provideWorkspaceDiagnostics: ProvideWorkspaceDiagnosticSignature = (resultIds, token): ProviderResult<WorkspaceDiagnosticReport> => {
          const partialResultToken: string = uuid()
          const disposable = this.client.onProgress(WorkspaceDiagnosticRequest.partialResult, partialResultToken, partialResult => {
            if (partialResult === undefined || partialResult === null) {
              resultReporter(null)
              return
            }

            resultReporter(partialResult as WorkspaceDiagnosticReportPartialResult)
          })
          const params: WorkspaceDiagnosticParams = {
            identifier: this.options.identifier,
            previousResultIds: resultIds,
            partialResultToken
          }
          return this.client.sendRequest(WorkspaceDiagnosticRequest.type, params, token).then(async (result): Promise<WorkspaceDiagnosticReport> => {
            if (token.isCancellationRequested) {
              return { items: [] }
            }
            disposable.dispose()
            resultReporter(result)
            return { items: [] }
          }, error => {
              disposable.dispose()
              return this.client.handleFailedRequest(DocumentDiagnosticRequest.type, token, error, { items: [] })
            })
        }
        const middleware: DiagnosticProviderMiddleware = this.client.clientOptions.middleware!
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
    for (const [key, request] of this.openRequests) {
      if (request.state === RequestStateKind.active) {
        request.tokenSource.cancel()
      }
      this.openRequests.set(key, { state: RequestStateKind.outDated, document: request.document })
    }
  }
}

class BackgroundScheduler implements Disposable {

  private readonly diagnosticRequestor: DiagnosticRequestor
  private endDocument: TextDocument | URI | undefined
  private readonly documents: LinkedMap<string, TextDocument>
  private intervalHandle: Disposable | undefined

  public constructor(diagnosticRequestor: DiagnosticRequestor) {
    this.diagnosticRequestor = diagnosticRequestor
    this.documents = new LinkedMap()
  }

  public add(document: TextDocument): void {
    const key = document instanceof URI ? document.toString() : document.uri.toString()
    if (this.documents.has(key)) {
      return
    }
    this.documents.set(key, document, Touch.Last)
    this.trigger()
  }

  public remove(document: TextDocument): void {
    const key = document instanceof URI ? document.toString() : document.uri.toString()
    if (this.documents.has(key)) {
      this.documents.delete(key)
      // Do a last pull
      this.diagnosticRequestor.pull(document)
    }
    // No more documents. Stop background activity.
    if (this.documents.size === 0) {
      this.stop()
    } else if (document === this.endDocument) {
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
        const key = document instanceof URI ? document.toString() : document.uri.toString()
        this.diagnosticRequestor.pull(document)
        this.documents.set(key, document, Touch.Last)
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

  constructor(client: BaseLanguageClient, options: DiagnosticRegistrationOptions) {
    const diagnosticPullOptions = client.clientOptions.diagnosticPullOptions ?? { onChange: true, onSave: false }
    const documentSelector = options.documentSelector!
    const disposables: Disposable[] = []

    const matchResource = (resource: URI) => {
      const selector = options.documentSelector!
      if (diagnosticPullOptions.match !== undefined) {
        return diagnosticPullOptions.match(selector!, resource)
      }
      for (const filter of selector) {
        if (!TextDocumentFilter.is(filter)) {
          continue
        }
        // The filter is a language id. We can't determine if it matches
        // so we return false.
        if (typeof filter === 'string') {
          return false
        }
        if (filter.language !== undefined && filter.language !== '*') {
          return false
        }
        if (filter.scheme !== undefined && filter.scheme !== '*' && filter.scheme !== resource.scheme) {
          return false
        }
        if (filter.pattern !== undefined) {
          const matcher = new minimatch.Minimatch(filter.pattern, { noext: true })
          if (!matcher.makeRe()) {
            return false
          }
          if (!matcher.match(resource.fsPath)) {
            return false
          }
        }
      }
      return true
    }

    const matches = (document: TextDocument | URI): boolean => {
      const isVisible = window.visibleTextEditors.some(editor => editor.document.uri === document.toString())
      return document instanceof URI
        ? matchResource(document)
        : workspace.match(documentSelector, document) > 0 && isVisible
    }

    this.diagnosticRequestor = new DiagnosticRequestor(client, options)
    this.backgroundScheduler = new BackgroundScheduler(this.diagnosticRequestor)

    const addToBackgroundIfNeeded = (document: TextDocument): void => {
      if (!matches(document) || !options.interFileDependencies || this.activeTextDocument?.uri === document.uri) {
        return
      }
      this.backgroundScheduler.add(document)
    }

    this.activeTextDocument = window.activeTextEditor?.document.textDocument
    window.onDidChangeActiveTextEditor(editor => {
      const oldActive = this.activeTextDocument
      this.activeTextDocument = editor?.document.textDocument
      if (oldActive !== undefined) {
        addToBackgroundIfNeeded(oldActive)
      }
      if (this.activeTextDocument !== undefined) {
        this.backgroundScheduler.remove(this.activeTextDocument)
      }
    })

    const pullTextDocuments: Set<string> = new Set()

    // We always pull on open.
    workspace.onDidOpenTextDocument(event => {
      if (pullTextDocuments.has(event.uri.toString())) return

      if (matches(event)) {
        this.diagnosticRequestor.pull(event, () => { addToBackgroundIfNeeded(event) })
        pullTextDocuments.add(event.uri.toString())
      }
    })

    // Pull all diagnostics for documents that are already open
    for (const textDocument of workspace.textDocuments) {
      if (pullTextDocuments.has(textDocument.uri.toString())) {
        continue
      }

      if (matches(textDocument)) {
        this.diagnosticRequestor.pull(textDocument, () => { addToBackgroundIfNeeded(textDocument) })
        pullTextDocuments.add(textDocument.uri.toString())
      }
    }

    if (diagnosticPullOptions.onChange === true) {
      workspace.onDidChangeTextDocument(async event => {
        const textDocument = workspace.getDocument(event.bufnr).textDocument
        if ((diagnosticPullOptions.filter === undefined || !diagnosticPullOptions.filter(textDocument, DiagnosticPullMode.onType)) && this.diagnosticRequestor.knows(PullState.document, textDocument) && event.contentChanges.length > 0) {
          this.diagnosticRequestor.pull(textDocument, () => { this.backgroundScheduler.trigger() })
        }
      })
    }

    if (diagnosticPullOptions.onSave === true) {
      workspace.onDidSaveTextDocument(textDocument => {
        if ((diagnosticPullOptions.filter === undefined || !diagnosticPullOptions.filter(textDocument, DiagnosticPullMode.onSave)) && this.diagnosticRequestor.knows(PullState.document, textDocument)) {
          this.diagnosticRequestor.pull(textDocument, () => this.backgroundScheduler.trigger())
        }
      })
    }

    // When the document closes clear things up
    workspace.onDidCloseTextDocument(textDocument => {
      this.diagnosticRequestor.cleanupPull(textDocument)
      this.backgroundScheduler.remove(textDocument)
    })

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

    disposables.push(languages.registerDiagnosticsProvider(options.documentSelector, this.diagnosticRequestor.provider))
    this.disposable = Disposable.create(() => [...disposables, this.backgroundScheduler, this.diagnosticRequestor].forEach(d => d.dispose()))
  }

  public get onDidChangeDiagnosticsEmitter(): Emitter<void> {
    return this.diagnosticRequestor.onDidChangeDiagnosticsEmitter
  }

  public get diagnostics(): DiagnosticProvider {
    return this.diagnosticRequestor.provider
  }
}

export class DiagnosticFeature extends TextDocumentFeature<DiagnosticOptions, DiagnosticRegistrationOptions, DiagnosticProviderShape> {

  constructor(client: BaseLanguageClient) {
    super(client, DocumentDiagnosticRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    let capability = ensure(ensure(capabilities, 'textDocument')!, 'diagnostic')!
    capability.dynamicRegistration = true
    capability.relatedDocumentSupport = false

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
    if (!id || !options) {
      return
    }
    this.register({ id, registerOptions: options })
  }

  public dispose(): void {
    super.dispose()
  }

  protected registerLanguageProvider(options: DiagnosticRegistrationOptions): [Disposable, DiagnosticProviderShape] {
    const provider = new DiagnosticFeatureProviderImpl(this._client, options)
    return [provider.disposable, provider]
  }
}
