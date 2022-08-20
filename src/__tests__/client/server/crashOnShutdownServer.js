'use strict'
const {createConnection} = require('vscode-languageserver')

const connection = createConnection()
console.log = connection.console.log.bind(connection.console)
console.error = connection.console.error.bind(connection.console)
connection.onInitialize((_params) => {
  return {capabilities: {}}
})
connection.onShutdown(() => {
  process.exit(100)
})
connection.listen()
