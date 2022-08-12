'use strict'
const {createConnection, DidChangeWatchedFilesNotification} = require('vscode-languageserver')
const {URI} = require('vscode-uri')

const connection = createConnection()
console.log = connection.console.log.bind(connection.console)
console.error = connection.console.error.bind(connection.console)
connection.onInitialize((_params) => {
  return {capabilities: {}}
})

let disposable
connection.onInitialized(() => {
  connection.client.register(DidChangeWatchedFilesNotification.type, {
    watchers: [{
      globPattern: '**/jsconfig.json'
    }, {
      globPattern: '**/*.ts',
      kind: 1
    }, {
      globPattern: -1
    }]
  }).then(d => {
    disposable = d
  })
})
connection.onNotification(DidChangeWatchedFilesNotification.type, params => {
  connection.sendNotification('filesChange', params)
})

connection.onNotification('unwatch', () => {
  if (disposable) disposable.dispose()
})

connection.listen()
