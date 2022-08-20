"use strict"
Object.defineProperty(exports, "__esModule", {value: true})
const node_1 = require("vscode-languageserver")
const connection = (0, node_1.createConnection)()
connection.onInitialize((_params) => {
  return {
    capabilities: {}
  }
})
connection.onRequest('request', (param) => {
  return param.value + 1
})
connection.onNotification('notification', () => {
})
connection.onRequest('triggerRequest', async () => {
  await connection.sendRequest('request')
})
connection.onRequest('triggerNotification', async () => {
  await connection.sendNotification('notification')
})
connection.listen()
