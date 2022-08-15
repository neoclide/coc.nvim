const {ResponseError, LSPErrorCodes} = require('vscode-languageserver')
const ls = require('vscode-languageserver')
const {TextDocument} = require('vscode-languageserver-textdocument')
let connection = ls.createConnection()
let documents = new ls.TextDocuments(TextDocument)

let lastOpenEvent
let lastCloseEvent
let lastChangeEvent
let lastWillSave
let lastDidSave
documents.onDidOpen(e => {
  lastOpenEvent = {uri: e.document.uri, version: e.document.version}
})
documents.onDidClose(e => {
  lastCloseEvent = {uri: e.document.uri}
})
documents.onDidChangeContent(e => {
  lastChangeEvent = {uri: e.document.uri, text: e.document.getText()}
})
documents.onWillSave(e => {
  lastWillSave = {uri: e.document.uri}
})
documents.onWillSaveWaitUntil(e => {
  let uri = e.document.uri
  if (uri.endsWith('error.vim')) throw new ResponseError(LSPErrorCodes.ContentModified, 'content changed')
  if (!uri.endsWith('foo.vim')) return []
  return [ls.TextEdit.insert(ls.Position.create(0, 0), 'abc')]
})
documents.onDidSave(e => {
  lastDidSave = {uri: e.document.uri}
})
documents.listen(connection)

console.log = connection.console.log.bind(connection.console)
console.error = connection.console.error.bind(connection.console)

let opts
connection.onInitialize(params => {
  opts = params.initializationOptions
  let capabilities = {
    textDocumentSync: {
      openClose: true,
      change: ls.TextDocumentSyncKind.Full,
      willSave: true,
      willSaveWaitUntil: true,
      save: true
    }
  }
  return {capabilities}
})

connection.onRequest('getLastOpen', () => {
  return lastOpenEvent
})

connection.onRequest('getLastClose', () => {
  return lastCloseEvent
})

connection.onRequest('getLastChange', () => {
  return lastChangeEvent
})

connection.onRequest('getLastWillSave', () => {
  return lastWillSave
})

connection.onRequest('getLastDidSave', () => {
  return lastDidSave
})

let disposables = []
connection.onNotification('registerDocumentSync', () => {
  let opt = {documentSelector: [{language: 'vim'}]}
  connection.client.register(ls.DidOpenTextDocumentNotification.type, opt).then(d => {
    disposables.push(d)
  })
  connection.client.register(ls.DidCloseTextDocumentNotification.type, opt).then(d => {
    disposables.push(d)
  })
  connection.client.register(ls.DidChangeTextDocumentNotification.type, Object.assign({
    syncKind: opts.none === true ? ls.TextDocumentSyncKind.None : ls.TextDocumentSyncKind.Incremental
  }, opt)).then(d => {
    disposables.push(d)
  })
  connection.client.register(ls.WillSaveTextDocumentNotification.type, opt).then(d => {
    disposables.push(d)
  })
  connection.client.register(ls.WillSaveTextDocumentWaitUntilRequest.type, opt).then(d => {
    disposables.push(d)
  })
})

connection.onNotification('unregisterDocumentSync', () => {
  for (let dispose of disposables) {
    dispose.dispose()
  }
  disposables = []
})

connection.listen()
