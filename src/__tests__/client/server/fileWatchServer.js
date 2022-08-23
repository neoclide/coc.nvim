'use strict'
const {createConnection, DidChangeWatchedFilesNotification} = require('vscode-languageserver')
const {URI} = require('vscode-uri')

const connection = createConnection()
console.log = connection.console.log.bind(connection.console)
console.error = connection.console.error.bind(connection.console)
connection.onInitialize((_params) => {
  return {capabilities: {}}
})

let disposables = []
connection.onInitialized(() => {
  connection.client.register(DidChangeWatchedFilesNotification.type, {
    watchers: [{
      globPattern: '**/jsconfig.json',
    }, {
      globPattern: '**/*.ts',
      kind: 1
    }, {
      globPattern: {
        baseUri: URI.file(process.cwd()).toString(),
        pattern: '**/*.vim'
      },
      kind: 1
    }, {
      globPattern: '**/*.js',
      kind: 2
    }, {
      globPattern: -1
    }]
  }).then(d => {
    disposables.push(d)
  })
  connection.client.register(DidChangeWatchedFilesNotification.type, {
    watchers: null
  }).then(d => {
    disposables.push(d)
  })
})
connection.onNotification(DidChangeWatchedFilesNotification.type, params => {
  connection.sendNotification('filesChange', params)
})

connection.onNotification('unwatch', () => {
  for (let d of disposables) {
    d.dispose()
  }
})

connection.listen()
