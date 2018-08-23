import { LanguageClient, LanguageClientOptions, Middleware, ServerOptions } from '../../language-client/main'
import workspace from '../../workspace'
import { Configuration } from './configuration'
// const logger = require('../../util/logger')('extension-solargraph-client')

export function makeLanguageClient(
  languageIds: string[],
  configurations: Configuration
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
  let serverOptions: ServerOptions = {
    command: configurations.commandPath || ' solargraph',
    args: ['stdio']
  }

  return new LanguageClient(
    'solargraph',
    'Ruby Language Server',
    serverOptions,
    clientOptions
  )
}
