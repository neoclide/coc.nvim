'use strict'
const {createConnection, ConfigurationRequest, DidChangeConfigurationNotification} = require('vscode-languageserver')
const {URI} = require('vscode-uri')

const connection = createConnection()
console.log = connection.console.log.bind(connection.console)
console.error = connection.console.error.bind(connection.console)
connection.onInitialize((_params) => {
  return {capabilities: {}}
})

connection.onNotification('pull0', () => {
  connection.sendRequest(ConfigurationRequest.type, {
    items: [{
      scopeUri: URI.file(__filename).toString()
    }]
  })
})

connection.onNotification('pull1', () => {
  connection.sendRequest(ConfigurationRequest.type, {
    items: [{
      section: 'http'
    }, {
      section: 'editor.cpp.format'
    }, {
      section: 'unknown'
    }]
  })
})

connection.onNotification(DidChangeConfigurationNotification.type, params => {
  connection.sendNotification('configurationChange', params)
})

connection.listen()
