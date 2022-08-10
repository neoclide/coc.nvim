/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
