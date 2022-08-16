'use strict'
const {createConnection, Range, TextDocumentSyncKind, Command, RenameRequest, WorkspaceSymbolRequest, CodeAction, SemanticTokensRegistrationType, CodeActionRequest, ConfigurationRequest, DidChangeConfigurationNotification, InlineValueRefreshRequest, ExecuteCommandRequest} = require('vscode-languageserver')

const connection = createConnection()
console.log = connection.console.log.bind(connection.console)
console.error = connection.console.error.bind(connection.console)

let options
let disposables = []
let prepareResponse
let configuration
connection.onInitialize((params) => {
  options = params.initializationOptions || {}
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
        resolveProvider: true
      }
    }
  }
})

connection.onInitialized(() => {
  connection.client.register(RenameRequest.type, {
    prepareProvider: options.prepareRename
  }).then(d => {
    disposables.push(d)
  })
  connection.client.register(WorkspaceSymbolRequest.type, {
    resolveProvider: true
  }).then(d => {
    disposables.push(d)
  })
  let full = false
  if (options.delta) {
    full = {delta: true}
  }
  connection.client.register(SemanticTokensRegistrationType.method, {
    full,
    range: options.rangeTokens,
    legend: {
      tokenTypes: [],
      tokenModifiers: []
    },
  })
  connection.client.register(CodeActionRequest.method, {
    resolveProvider: false
  })
  connection.client.register(DidChangeConfigurationNotification.type, {section: undefined})
  connection.client.register(ExecuteCommandRequest.type, {
    commands: ['test_command']
  }).then(d => {
    disposables.push(d)
  })
})

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
  if (param.command = 'test_command') {
    return {success: true}
  }
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
    items: [{section: 'foo'}]
  })
})

connection.onRequest('getConfiguration', () => {
  return configuration
})

connection.onNotification('fireInlineValueRefresh', () => {
  connection.sendRequest(InlineValueRefreshRequest.type)
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
