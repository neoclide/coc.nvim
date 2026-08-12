import {
  CodeActionRequest,
  CodeLensRequest,
  CodeLensResolveRequest,
  Command,
  CompletionRequest,
  CompletionResolveRequest,
  ConfigurationRequest,
  createProtocolConnection,
  DidChangeConfigurationNotification,
  DidCreateFilesNotification,
  DidDeleteFilesNotification,
  DidRenameFilesNotification,
  DocumentSymbolRequest,
  ErrorCodes,
  ExecuteCommandRequest,
  ExitNotification,
  InitializedNotification,
  InitializeParams,
  InitializeRequest,
  InitializeResult,
  InlineValueRefreshRequest,
  NotificationType0,
  PrepareRenameRequest,
  RegistrationRequest,
  RenameRequest,
  RequestType,
  RequestType0,
  ResponseError,
  SemanticTokensDeltaRequest,
  SemanticTokensRegistrationType,
  ShutdownRequest,
  TextDocumentContentRefreshRequest,
  TextDocumentSyncKind,
  UnregistrationRequest,
  WillDeleteFilesRequest,
  WillRenameFilesRequest,
  WorkspaceFoldersRequest,
  WorkspaceSymbolRequest,
  WorkspaceSymbolResolveRequest,
  Range,
} from 'vscode-languageserver-protocol'
import { StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver-protocol/node'

/**
 * In-process twin of dynamicServer.js built on createProtocolConnection (see
 * inProcessEventServer.ts for why the node factory cannot run here). It
 * replicates the dynamic-registration surface exercised by dynamic.test.ts so
 * those tests skip a child-process spawn per test.
 */
export function createDynamicServer(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): void {
  const connection = createProtocolConnection(
    new StreamMessageReader(input),
    new StreamMessageWriter(output)
  )
  let options: Record<string, any> = {}
  let prepareResponse: any
  let configuration: any
  let folders: any
  let foldersEvent: any
  let lastFileOperationRequest: any
  const registrations: {id: string; method: string}[] = []
  let registrationSeq = 0
  const id = 'b346648e-88e0-44e3-91e3-52fd6addb8c7'

  function register(method: string, registerOptions: any): void {
    const registrationId = 'r' + (++registrationSeq)
    registrations.push({id: registrationId, method})
    void connection.sendRequest(RegistrationRequest.type, {
      registrations: [{id: registrationId, method, registerOptions}],
    }).catch(() => {})
  }

  connection.onRequest(InitializeRequest.type, (params: InitializeParams): InitializeResult => {
    options = (params.initializationOptions ?? {}) as Record<string, any>
    const changeNotifications = options.changeNotifications ?? id
    return {
      capabilities: {
        inlineValueProvider: {},
        executeCommandProvider: {commands: []},
        documentSymbolProvider: options.label ? {label: 'test'} : true,
        textDocumentSync: TextDocumentSyncKind.Full,
        renameProvider: options.prepareRename ? {prepareProvider: true} : true,
        workspaceSymbolProvider: true,
        codeLensProvider: {resolveProvider: options.noResolve !== true},
        documentLinkProvider: {resolveProvider: options.noResolve !== true},
        inlayHintProvider: {resolveProvider: options.noResolve !== true},
        workspace: {
          workspaceFolders: {changeNotifications},
          fileOperations: {
            didCreate: {
              filters: [
                {scheme: 'lsptest', pattern: {glob: '**/*', matches: 'file', options: {}}},
                {scheme: 'file', pattern: {glob: '**/*', matches: 'file', options: {ignoreCase: false}}},
              ],
            },
            didRename: {
              filters: [
                {scheme: 'file', pattern: {glob: '**/*', matches: 'folder'}},
                {scheme: 'file', pattern: {glob: '**/*', matches: 'file'}},
              ],
            },
            didDelete: {
              filters: [{scheme: 'file', pattern: {glob: '**/*'}}],
            },
            willCreate: {
              filters: [{scheme: 'file', pattern: {glob: '**/*'}}],
            },
            willRename: {
              filters: [
                {scheme: 'file', pattern: {glob: '**/*', matches: 'folder'}},
                {scheme: 'file', pattern: {glob: '**/*', matches: 'file'}},
              ],
            },
            willDelete: {
              filters: [{scheme: 'file', pattern: {glob: '**/*'}}],
            },
          },
          textDocumentContent: options.textDocumentContent ? {id, schemes: ['lsptest']} : undefined,
        },
      },
    }
  })
  connection.onRequest(ShutdownRequest.type, () => undefined)
  connection.onNotification(ExitNotification.type, () => connection.dispose())

  connection.onNotification(InitializedNotification.type, () => {
    const renameId = 'r' + (++registrationSeq)
    void connection.sendRequest(RegistrationRequest.type, {
      registrations: [{id: renameId, method: RenameRequest.method, registerOptions: {prepareProvider: options.prepareRename}}],
    }).then(() => {
      // dynamicServer.js disposes the rename registration right away.
      void connection.sendRequest(UnregistrationRequest.type, {
        unregisterations: [{id: renameId, method: RenameRequest.method}],
      }).catch(() => {})
    }).catch(() => {})
    register(WorkspaceSymbolRequest.method, {resolveProvider: true})
    register(SemanticTokensRegistrationType.method, {
      full: options.delta ? {delta: true} : options.noResolve ? {delta: false} : false,
      range: options.rangeTokens,
      legend: {tokenTypes: [], tokenModifiers: []},
    })
    register(CodeActionRequest.method, {resolveProvider: false})
    register(DidChangeConfigurationNotification.method, {section: undefined})
    register(ExecuteCommandRequest.method, {commands: ['test_command', 'other_command']})
    register(CompletionRequest.method, {documentSelector: [{language: 'vim'}]})
    register(CompletionRequest.method, {triggerCharacters: ['/']})
  })

  connection.onNotification(DidCreateFilesNotification.type, params => {
    lastFileOperationRequest = {type: 'create', params}
  })
  connection.onNotification(DidRenameFilesNotification.type, params => {
    lastFileOperationRequest = {type: 'rename', params}
  })
  connection.onNotification(DidDeleteFilesNotification.type, params => {
    lastFileOperationRequest = {type: 'delete', params}
  })
  connection.onRequest(WillRenameFilesRequest.type, params => {
    lastFileOperationRequest = {type: 'willRename', params}
    return null
  })
  connection.onRequest(WillDeleteFilesRequest.type, params => {
    lastFileOperationRequest = {type: 'willDelete', params}
    return null
  })

  connection.onRequest(CompletionRequest.type, () => [{label: 'item', insertText: 'text'}])
  connection.onRequest(CompletionResolveRequest.type, item => ({...item, detail: 'detail'}))
  connection.onRequest(new RequestType0('testing/lastFileOperationRequest'), () => lastFileOperationRequest)
  connection.onNotification(new NotificationType0('unregister'), () => {
    for (const registration of registrations.splice(0)) {
      void connection.sendRequest(UnregistrationRequest.type, {
        unregisterations: [{id: registration.id, method: registration.method}],
      }).catch(() => {})
    }
  })
  connection.onRequest(DocumentSymbolRequest.type, () => [])
  connection.onRequest(ExecuteCommandRequest.type, (params: any) => {
    if (params.command === 'test_command') return {success: true}
    throw new ResponseError(ErrorCodes.InvalidRequest, `${params?.command} not exists.`)
  })
  connection.onRequest(SemanticTokensDeltaRequest.type, () => ({resultId: '3', data: []}))
  connection.onRequest(new RequestType('setPrepareResponse'), (param: any) => {
    prepareResponse = param
  })
  connection.onNotification(new NotificationType0('pullConfiguration'), () => {
    configuration = connection.sendRequest(ConfigurationRequest.type, {
      items: [{section: 'foo'}, {}],
    })
  })
  connection.onRequest(new RequestType0('getConfiguration'), () => configuration)
  connection.onRequest(new RequestType0('getFolders'), () => folders)
  connection.onRequest(new RequestType0('getFoldersEvent'), () => foldersEvent)
  connection.onNotification(new NotificationType0('fireInlineValueRefresh'), () => {
    void connection.sendRequest(InlineValueRefreshRequest.type).catch(() => {})
  })
  connection.onNotification(new NotificationType0('fireDocumentContentRefresh'), () => {
    void connection.sendRequest(TextDocumentContentRefreshRequest.type, {uri: 'lsptest:///2'}).catch(() => {})
    void connection.sendRequest(TextDocumentContentRefreshRequest.type, {uri: 'untitled:///1'}).catch(() => {})
  })
  connection.onNotification(new NotificationType0('requestFolders'), async () => {
    folders = await connection.sendRequest(WorkspaceFoldersRequest.type)
  })
  connection.onRequest(PrepareRenameRequest.type, () => prepareResponse)
  connection.onRequest(CodeActionRequest.type, () => [Command.create('title', 'editor.action.triggerSuggest')])
  connection.onRequest(WorkspaceSymbolRequest.type, () => [])
  connection.onRequest(WorkspaceSymbolResolveRequest.type, item => item)
  connection.onRequest(CodeLensRequest.type, () => [{range: Range.create(0, 0, 0, 3)}, {range: Range.create(1, 0, 1, 3)}])
  connection.onRequest(CodeLensResolveRequest.type, (codelens: any) => ({range: codelens.range, command: {title: 'format', command: 'format'}}))

  connection.listen()
}
