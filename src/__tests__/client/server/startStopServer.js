"use strict"
Object.defineProperty(exports, "__esModule", {value: true})
const node_1 = require("vscode-languageserver")
const connection = (0, node_1.createConnection)()
connection.onInitialize((_params) => {
  return {
    capabilities: {
      executeCommandProvider: {
        commands: ['foo.command'],
      }
    }
  }
})
connection.onShutdown(() => {
})
connection.listen()
