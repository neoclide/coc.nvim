'use strict'
const {createConnection, TextDocumentSyncKind, RenameRequest} = require('vscode-languageserver')

const connection = createConnection()
console.log = connection.console.log.bind(connection.console)
console.error = connection.console.error.bind(connection.console)

let options
let disposables = []
let prepareResponse
connection.onInitialize((params) => {
  options = params.initializationOptions || {}
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      renameProvider: options.prepareRename ? {prepareProvider: true} : true
    }
  }
})

connection.onInitialized(() => {
  connection.client.register(RenameRequest.type, {
    prepareProvider: options.prepareRename
  }).then(d => {
    disposables.push(d)
  })
})

connection.onRequest('setPrepareResponse', param => {
  prepareResponse = param
})

connection.onPrepareRename(() => {
  return prepareResponse
})

connection.listen()
