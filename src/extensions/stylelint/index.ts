import path from 'path'
import {LanguageService} from '../../language-client'
import workspace from '../../workspace'
import {LanguageClientOptions} from '../../language-client/main'
const logger = require('../../util/logger')('extension-stylelint')

const ID = 'stylelint'
export default class JsonService extends LanguageService {
  constructor() {
    const config = workspace.getConfiguration().get(ID) as any
    super(ID, 'Stylelint Language Server', {
      module: path.join(__dirname, 'server.js'),
      args: ['--node-ipc'],
      execArgv: config.execArgv,
      filetypes: config.filetypes || ['css', 'wxss', 'less', 'scss'],
      enable: config.enable !== false
    }, ID)
  }

  protected resolveClientOptions(clientOptions:LanguageClientOptions):LanguageClientOptions {
    Object.assign(clientOptions, {
      synchronize: {
        configurationSection: ID,
        diagnosticCollectionName: 'stylelint',
        fileEvents: workspace.createFileSystemWatcher('**/stylelint.config.js')
      }
    })
    return clientOptions
  }
}
