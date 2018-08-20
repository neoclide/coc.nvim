import path from 'path'
import { LanguageService } from '../../language-client'
import { LanguageClientOptions } from '../../language-client/main'
import workspace from '../../workspace'
const logger = require('../../util/logger')('extension-stylelint')
const file = 'lib/server.js'

const ID = 'stylelint'
export default class JsonService extends LanguageService {
  constructor() {
    const config = workspace.getConfiguration().get(ID) as any
    super(ID, 'Stylelint Language Server', {
      module: () => {
        return new Promise(resolve => {
          workspace.resolveModule('stylelint-langserver', 'stylelint').then(folder => {
            if (!folder) return
            resolve(folder ? path.join(folder, file) : null)
          }, () => {
            resolve(null)
          })
        })
      },
      args: ['--node-ipc'],
      execArgv: config.execArgv,
      filetypes: config.filetypes || ['css', 'wxss', 'less', 'scss'],
      enable: config.enable !== false
    }, ID)
  }

  protected resolveClientOptions(clientOptions: LanguageClientOptions): LanguageClientOptions {
    Object.assign(clientOptions, {
      synchronize: {
        configurationSection: ID,
        diagnosticCollectionName: 'stylelint',
        fileEvents: [
          workspace.createFileSystemWatcher('**/stylelint.config.js'),
          workspace.createFileSystemWatcher('**/.stylelintrc'),
          workspace.createFileSystemWatcher('**/package.json')
        ]
      }
    })
    return clientOptions
  }
}
