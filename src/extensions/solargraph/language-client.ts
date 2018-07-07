import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  Middleware,
} from '../../language-client/main'
import * as net from 'net'
import {Hover} from 'vscode-languageserver-protocol'
import * as solargraph from '@chemzqm/solargraph-utils'
import workspace from '../../workspace'
const logger = require('../../util/logger')('extension-solargraph-client')

export function makeLanguageClient(
  languageIds: string[],
  socketProvider: solargraph.SocketProvider,
): LanguageClient {

  let middleware: Middleware = {
    provideHover: (document, position, token, next): Promise<Hover> => {
      return new Promise(resolve => {
        let promise = next(document, position, token)
        // HACK: It's a promise, but TypeScript doesn't recognize it
        promise['then'](hover => {
          let contents = []
          hover.contents.forEach(orig => {
            contents.push(orig.value)
          })
          resolve({ contents } as Hover)
        })
      })
    }
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
      enablePages: true
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
