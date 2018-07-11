import * as solargraph from '@chemzqm/solargraph-utils'
import * as net from 'net'
import {LanguageClient, LanguageClientOptions, Middleware, ServerOptions} from '../../language-client/main'
import workspace from '../../workspace'
const logger = require('../../util/logger')('extension-solargraph-client')

export function makeLanguageClient(
  languageIds: string[],
  socketProvider: solargraph.SocketProvider,
): LanguageClient {

  let middleware: Middleware = {
  }

  // Options to control the language client
  let clientOptions: LanguageClientOptions = {
    documentSelector: languageIds,
    synchronize: {
      // Synchronize the setting section 'solargraph' to the server
      configurationSection: 'solargraph',
      // Notify the server about file changes to any file in the workspace
      fileEvents: workspace.createFileSystemWatcher('**/*')
    },
    middleware,
    initializationOptions: {
      enablePages: false
    }
  }
  let serverOptions: ServerOptions = () => {
    return new Promise(resolve => {
      let socket: net.Socket = net.createConnection(socketProvider.port, '127.0.0.1')
      resolve({
        reader: socket,
        writer: socket
      })
    })
  }

  return new LanguageClient(
    'solargraph',
    'Ruby Language Server',
    serverOptions,
    clientOptions
  )
}
