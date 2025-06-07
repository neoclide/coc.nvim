'use strict'
const {createConnection, TextDocumentContentRefreshRequest, ProtocolRequestType, Range, TextDocumentSyncKind, Command, RenameRequest, WorkspaceSymbolRequest, SemanticTokensRegistrationType, CodeActionRequest, ConfigurationRequest, DidChangeConfigurationNotification, InlineValueRefreshRequest, ExecuteCommandRequest, CompletionRequest, WorkspaceFoldersRequest, ResponseError, ErrorCodes} = require('vscode-languageserver/node')

const connection = createConnection()
console.log = connection.console.log.bind(connection.console)
console.error = connection.console.error.bind(connection.console)

let options
let disposables = []
let prepareResponse
let configuration
let folders
let foldersEvent
const id = 'b346648e-88e0-44e3-91e3-52fd6addb8c7'
connection.onInitialize((params) => {
  options = params.initializationOptions || {}
  let changeNotifications = options.changeNotifications ?? id
  return {
    capabilities: {
      inlineValueProvider: {},
      executeCommandProvider: {
      },
      documentSymbolProvider: options.label ? {label: 'test'} : true,
      textDocumentSync: TextDocumentSyncKind.Full,
      renameProvider: options.prepareRename ? {prepareProvider: true} : true,
      workspaceSymbolProvider: true,
      codeLensProvider: {
        resolveProvider: options.noResolve !== true
      },
      documentLinkProvider: {
        resolveProvider: options.noResolve !== true
      },
      inlayHintProvider: {
        resolveProvider: options.noResolve !== true
      },
      workspace: {
        workspaceFolders: {
          changeNotifications
        },
        fileOperations: {
          // Static reg is folders + .txt files with operation kind in the path
          didCreate: {
            filters: [
              {scheme: 'lsptest', pattern: {glob: '**/*', matches: 'file', options: {}}},
              {scheme: 'file', pattern: {glob: '**/*', matches: 'file', options: {ignoreCase: false}}}
            ]
          },
          didRename: {
            filters: [
              {scheme: 'file', pattern: {glob: '**/*', matches: 'folder'}},
              {scheme: 'file', pattern: {glob: '**/*', matches: 'file'}}
            ]
          },
          didDelete: {
            filters: [{scheme: 'file', pattern: {glob: '**/*'}}]
          },
          willCreate: {
            filters: [{scheme: 'file', pattern: {glob: '**/*'}}]
          },
          willRename: {
            filters: [
              {scheme: 'file', pattern: {glob: '**/*', matches: 'folder'}},
              {scheme: 'file', pattern: {glob: '**/*', matches: 'file'}}
            ]
          },
          willDelete: {
            filters: [{scheme: 'file', pattern: {glob: '**/*'}}]
          },
        },
        textDocumentContent: options.textDocumentContent ? {id, schemes: ['lsptest']} : undefined
      },
    }
  }
})

connection.onInitialized(() => {
  void connection.client.register(RenameRequest.type, {
    prepareProvider: options.prepareRename
  }).then(d => {
    d.dispose()
  })
  void connection.client.register(WorkspaceSymbolRequest.type, {
    resolveProvider: true
  }).then(d => {
    disposables.push(d)
  })
  let full = false
  if (options.delta) {
    full = {delta: true}
  } else if (options.noResolve) {
    full = {delta: false}
  }
  void connection.client.register(SemanticTokensRegistrationType.method, {
    full,
    range: options.rangeTokens,
    legend: {
      tokenTypes: [],
      tokenModifiers: []
    },
  })
  void connection.client.register(CodeActionRequest.method, {
    resolveProvider: false
  })
  void connection.client.register(DidChangeConfigurationNotification.type, {section: undefined})
  void connection.client.register(ExecuteCommandRequest.type, {
    commands: ['test_command', 'other_command']
  }).then(d => {
    disposables.push(d)
  })
  void connection.client.register(CompletionRequest.type, {
    documentSelector: [{language: 'vim'}]
  }).then(d => {
    disposables.push(d)
  })
  void connection.client.register(CompletionRequest.type, {
    triggerCharacters: ['/'],
  }).then(d => {
    disposables.push(d)
  })
})

let lastFileOperationRequest
connection.workspace.onDidCreateFiles(params => {lastFileOperationRequest = {type: 'create', params}})
connection.workspace.onDidRenameFiles(params => {lastFileOperationRequest = {type: 'rename', params}})
connection.workspace.onDidDeleteFiles(params => {lastFileOperationRequest = {type: 'delete', params}})
connection.workspace.onWillRenameFiles(params => {lastFileOperationRequest = {type: 'willRename', params}})
connection.workspace.onWillDeleteFiles(params => {lastFileOperationRequest = {type: 'willDelete', params}})

// connection.onDidChangeWorkspaceFolders(e => {
//   foldersEvent = params
// })

connection.onCompletion(_params => {
  return [
    {label: 'item', insertText: 'text'}
  ]
})

connection.onCompletionResolve(item => {
  item.detail = 'detail'
  return item
})

connection.onRequest(
  new ProtocolRequestType('testing/lastFileOperationRequest'),
  () => {
    return lastFileOperationRequest
  },
)

connection.onNotification('unregister', () => {
  for (let d of disposables) {
    d.dispose()
    disposables = []
  }
})

connection.onDocumentSymbol(() => {
  return []
})

connection.onExecuteCommand(param => {
  if (param.command === 'test_command') {
    return {success: true}
  }
  throw new ResponseError(ErrorCodes.InvalidRequest, `${param?.command} not exists.`)
})

connection.languages.semanticTokens.onDelta(() => {
  return {
    resultId: '3',
    data: []
  }
})

connection.onRequest('setPrepareResponse', param => {
  prepareResponse = param
})

connection.onNotification('pullConfiguration', () => {
  configuration = connection.sendRequest(ConfigurationRequest.type, {
    items: [{section: 'foo'}, {}]
  })
})

connection.onRequest('getConfiguration', () => {
  return configuration
})

connection.onRequest('getFolders', () => {
  return folders
})

connection.onRequest('getFoldersEvent', () => {
  return foldersEvent
})

connection.onNotification('fireInlineValueRefresh', () => {
  void connection.sendRequest(InlineValueRefreshRequest.type)
})

connection.onNotification('fireDocumentContentRefresh', () => {
  void connection.sendRequest(TextDocumentContentRefreshRequest.type, {uri: 'lsptest:///2'})
  void connection.sendRequest(TextDocumentContentRefreshRequest.type, {uri: 'untitled:///1'})
})

connection.onNotification('requestFolders', async () => {
  folders = await connection.sendRequest(WorkspaceFoldersRequest.type)
})

connection.onPrepareRename(() => {
  return prepareResponse
})

connection.onCodeAction(() => {
  return [
    Command.create('title', 'editor.action.triggerSuggest')
  ]
})

connection.onWorkspaceSymbol(() => {
  return []
})

connection.onWorkspaceSymbolResolve(item => {
  return item
})

connection.onCodeLens(params => {
  return [{range: Range.create(0, 0, 0, 3)}, {range: Range.create(1, 0, 1, 3)}]
})

connection.onCodeLensResolve(codelens => {
  return {range: codelens.range, command: {title: 'format', command: 'format'}}
})

connection.listen()
