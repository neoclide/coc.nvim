import {
  ApplyWorkspaceEditRequest,
  createProtocolConnection,
  DidChangeTextDocumentNotification,
  DidCloseTextDocumentNotification,
  DidOpenTextDocumentNotification,
  ExitNotification,
  InitializeParams,
  InitializeRequest,
  InitializeResult,
  LogMessageNotification,
  LogTraceNotification,
  MessageType,
  NotificationType,
  NotificationType0,
  PositionEncodingKind,
  PublishDiagnosticsNotification,
  RegistrationRequest,
  RenameRequest,
  ResponseError,
  ShowDocumentParams,
  ShowDocumentRequest,
  ShowMessageNotification,
  ShowMessageRequest,
  ShowMessageRequestParams,
  ShutdownRequest,
  TextDocumentSyncKind,
  WorkDoneProgress,
} from 'vscode-languageserver-protocol'
import { StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver-protocol/node'
import {
  Diagnostic,
  DiagnosticRelatedInformation,
  DiagnosticSeverity,
  Location,
  Position,
  Range,
  TextEdit,
} from 'vscode-languageserver-types'

/**
 * In-process twin of eventServer.js built on createProtocolConnection.
 * vscode-languageserver/node hard-wires process.exit on connection close and
 * a parent watchdog, so a real server cannot run inside the editor worker.
 * This fixture provides the same notification / progress / workspaceEdit
 * behaviors over injected streams for pure client<->server RPC tests, which
 * then skip a child-process spawn per test.
 */
export function createEventServer(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): void {
  const connection = createProtocolConnection(
    new StreamMessageReader(input),
    new StreamMessageWriter(output)
  )
  // process.exit() in a real server closes the OS pipe; destroy both stream
  // ends to reproduce that close for the client instead of only disposing the
  // protocol connection (which leaves the PassThrough streams open).
  const simulateExit = (): void => {
    connection.dispose()
    ;(output as unknown as { destroy?: () => void }).destroy?.()
    ;(input as unknown as { destroy?: () => void }).destroy?.()
  }
  let options: { trace?: boolean; utf8?: boolean; throwError?: boolean; normalThrow?: boolean } = {}
  // Track opened documents so the edits handler can report a bumped version,
  // mirroring eventServer.js's TextDocuments.
  const documents = new Map<string, number>()

  connection.onRequest(InitializeRequest.type, (params: InitializeParams): InitializeResult | ResponseError<{retry: boolean}> => {
    options = params.initializationOptions as { trace?: boolean; utf8?: boolean; throwError?: boolean; normalThrow?: boolean } ?? {}
    if (options.trace) {
      setTimeout(() => {
        void connection.sendNotification(LogTraceNotification.type, { message: 'This is a trace message' })
        void connection.sendNotification(LogTraceNotification.type, { message: 'This is a trace message', verbose: 'verbose info' })
      }, 1)
    }
    if (options.throwError) {
      // Mirror eventServer.js: signal a retryable initialize failure, then
      // drop the connection so a retry races a dead server.
      setTimeout(simulateExit, 10)
      return new ResponseError(1, 'message', { retry: true })
    }
    if (options.normalThrow) {
      throw new Error('normal throw error')
    }
    if (options.utf8) {
      return { capabilities: { positionEncoding: PositionEncodingKind.UTF8 } }
    }
    return { capabilities: { textDocumentSync: TextDocumentSyncKind.Full } }
  })
  connection.onRequest(ShutdownRequest.type, () => undefined)
  connection.onNotification(ExitNotification.type, () => connection.dispose())
  connection.onRequest('doExit', () => {
    setTimeout(simulateExit, 30)
  })

  connection.onNotification(DidOpenTextDocumentNotification.type, params => {
    documents.set(params.textDocument.uri, params.textDocument.version)
  })
  connection.onNotification(DidChangeTextDocumentNotification.type, params => {
    documents.set(params.textDocument.uri, params.textDocument.version)
  })
  connection.onNotification(DidCloseTextDocumentNotification.type, params => {
    documents.delete(params.textDocument.uri)
  })

  connection.onNotification(new NotificationType0('diagnostics'), () => {
    const related = [
      DiagnosticRelatedInformation.create(Location.create('lsptest:///2', Range.create(0, 0, 0, 1)), 'dup'),
      DiagnosticRelatedInformation.create(Location.create('lsptest:///2', Range.create(0, 0, 1, 0)), 'dup'),
    ]
    const diagnostics = [Diagnostic.create(Range.create(0, 0, 1, 0), 'msg', DiagnosticSeverity.Error, undefined, undefined, related)]
    void connection.sendNotification(PublishDiagnosticsNotification.type, { uri: 'lsptest:///1', diagnostics })
    void connection.sendNotification(PublishDiagnosticsNotification.type, { uri: 'lsptest:///3', version: 1, diagnostics })
  })
  connection.onNotification(new NotificationType0('simpleEdit'), async () => {
    const res = await connection.sendRequest(ApplyWorkspaceEditRequest.type, { edit: { documentChanges: [] } })
    void connection.sendNotification(new NotificationType<{ applied: boolean }>('result'), res)
  })
  connection.onNotification(new NotificationType0('register'), () => {
    void connection.sendRequest(RegistrationRequest.type, {
      registrations: [{ id: '1', method: RenameRequest.type.method, registerOptions: { prepareProvider: false } }],
    }).catch(() => {})
  })
  connection.onNotification(new NotificationType0('registerBad'), () => {
    void connection.sendRequest(RegistrationRequest.type, {
      registrations: [{ id: 'not_exists', method: 'not_exists', registerOptions: {} }],
    }).catch(() => {})
  })
  connection.onNotification(new NotificationType0('edits'), async () => {
    const documentChanges = [...documents.entries()].map(([uri, version]) => ({
      textDocument: { uri, version: version + 1 },
      edits: [TextEdit.insert(Position.create(0, 0), 'foo')],
    }))
    const res = await connection.sendRequest(ApplyWorkspaceEditRequest.type, { edit: { documentChanges } })
    void connection.sendNotification(new NotificationType<{ applied: boolean }>('result'), res)
  })
  connection.onNotification(new NotificationType0('send'), () => {
    void connection.sendRequest('customRequest', {}).catch(() => {})
    void connection.sendNotification(new NotificationType0('customNotification'))
    void connection.sendProgress(WorkDoneProgress.type, '4fb247f8-0ede-415d-a80a-6629b6a9eaf8', { kind: 'end', message: 'end message' })
  })
  connection.onNotification(new NotificationType0('logMessage'), () => {
    const types: MessageType[] = [MessageType.Debug, MessageType.Error, MessageType.Info, MessageType.Log, MessageType.Warning]
    for (const type of types) {
      void connection.sendNotification(LogMessageNotification.type, { type, message: 'msg' })
    }
  })
  connection.onNotification(new NotificationType0('showMessage'), () => {
    const types: MessageType[] = [MessageType.Error, MessageType.Info, MessageType.Log, MessageType.Warning]
    for (const type of types) {
      void connection.sendNotification(ShowMessageNotification.type, { type, message: 'msg' })
    }
  })
  connection.onNotification(new NotificationType<ShowMessageRequestParams>('requestMessage'), async params => {
    await connection.sendRequest(ShowMessageRequest.type, { type: params.type, message: 'msg', actions: [{ title: 'open' }] })
  })
  connection.onNotification(new NotificationType<ShowDocumentParams>('showDocument'), async params => {
    await connection.sendRequest(ShowDocumentRequest.type, params)
  })
  connection.onProgress(WorkDoneProgress.type, '4b3a71d0-2b3f-46af-be2c-2827f548579f', params => {
    void connection.sendNotification(new NotificationType('progressResult'), params)
  })

  connection.listen()
}
