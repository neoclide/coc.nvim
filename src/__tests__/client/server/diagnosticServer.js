'use strict'
const {createConnection, ResponseError, LSPErrorCodes, DiagnosticRefreshRequest, DocumentDiagnosticReportKind, Diagnostic, Range, DiagnosticSeverity, TextDocuments, TextDocumentSyncKind} = require('vscode-languageserver')
const {TextDocument} = require('vscode-languageserver-textdocument')
let documents = new TextDocuments(TextDocument)

const connection = createConnection()
console.log = connection.console.log.bind(connection.console)
console.error = connection.console.error.bind(connection.console)
let options
documents.listen(connection)
connection.onInitialize((params) => {
  options = params.initializationOptions || {}
  const interFileDependencies = options.interFileDependencies !== false
  const workspaceDiagnostics = options.workspaceDiagnostics === true
  const identifier = options.identifier ?? '6d52eff6-96c7-4fd1-910f-f060bcffb23f'
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      diagnosticProvider: {
        identifier,
        interFileDependencies,
        workspaceDiagnostics
      }
    }
  }
})

let count = 0
let saveCount = 0
connection.languages.diagnostics.on((params) => {
  let uri = params.textDocument.uri
  if (uri.endsWith('error')) return Promise.reject(new Error('server error'))
  if (uri.endsWith('cancel')) return new ResponseError(LSPErrorCodes.ServerCancelled, 'cancel', {retriggerRequest: false})
  if (uri.endsWith('retrigger')) return new ResponseError(LSPErrorCodes.ServerCancelled, 'retrigger', {retriggerRequest: true})
  if (uri.endsWith('change')) count++
  if (uri.endsWith('save')) saveCount++
  if (uri.endsWith('empty')) return null
  if (uri.endsWith('unchanged')) return {
    kind: DocumentDiagnosticReportKind.Unchanged,
    resultId: '1'
  }
  return {
    kind: DocumentDiagnosticReportKind.Full,
    items: [
      Diagnostic.create(Range.create(1, 1, 1, 1), 'diagnostic', DiagnosticSeverity.Error)
    ]
  }
})

let workspaceCount = 0
connection.languages.diagnostics.onWorkspace((params, _, __, reporter) => {
  if (params.previousResultIds.length > 0) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        reporter.report({
          items: [{
            kind: DocumentDiagnosticReportKind.Full,
            uri: 'uri1',
            version: 1,
            items: [
              Diagnostic.create(Range.create(1, 0, 1, 1), 'diagnostic', DiagnosticSeverity.Error)
            ]
          }]
        })
      }, 10)
      setTimeout(() => {
        reporter.report(null)
      }, 15)
      setTimeout(() => {
        reporter.report({
          items: [{
            kind: DocumentDiagnosticReportKind.Full,
            uri: 'uri2',
            version: 1,
            items: [
              Diagnostic.create(Range.create(2, 0, 2, 1), 'diagnostic', DiagnosticSeverity.Error)
            ]
          }]
        })
      }, 20)
      setTimeout(() => {
        resolve({items: []})
      }, 50)
    })
  }
  workspaceCount++
  if (workspaceCount == 2) {
    return new ResponseError(LSPErrorCodes.ServerCancelled, 'changed')
  }
  return {
    items: [{
      kind: DocumentDiagnosticReportKind.Full,
      uri: 'uri',
      version: 1,
      items: [
        Diagnostic.create(Range.create(1, 1, 1, 1), 'diagnostic', DiagnosticSeverity.Error)
      ]
    }]
  }
})

connection.onNotification('fireRefresh', () => {
  connection.sendRequest(DiagnosticRefreshRequest.type)
})

connection.onRequest('getChangeCount', () => {
  return count
})

connection.onRequest('getSaveCount', () => {
  return saveCount
})

connection.onRequest('getWorkspceCount', () => {
  return workspaceCount
})

connection.listen()
