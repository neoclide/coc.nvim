"use strict"
const {createConnection, ResponseError} = require("vscode-languageserver")
const connection = createConnection()
connection.onInitialize((_params) => {
  return {
    capabilities: {}
  }
})

connection.onSignatureHelp(_params => {
  return new ResponseError(-32803, 'failed')
})

connection.listen()
