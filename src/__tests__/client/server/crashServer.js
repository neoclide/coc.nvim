"use strict"
Object.defineProperty(exports, "__esModule", {value: true})
const node_1 = require('vscode-languageserver')
var CrashNotification;
(function (CrashNotification) {
  CrashNotification.type = new node_1.NotificationType0('test/crash')
})(CrashNotification || (CrashNotification = {}))
const connection = (0, node_1.createConnection)()
connection.onInitialize((_params) => {
  return {
    capabilities: {}
  }
})
connection.onNotification(CrashNotification.type, () => {
  process.exit(100)
})
connection.listen()
