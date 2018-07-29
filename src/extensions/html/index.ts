import path from 'path'
import {LanguageService} from '../../language-client'
import workspace from '../../workspace'
const logger = require('../../util/logger')('extension-html')

export default class HtmlService extends LanguageService {
  constructor() {
    const config = workspace.getConfiguration().get('html') as any
    super('html', 'HTML Language Server', {
      module: () => {
        return new Promise(resolve => {
          workspace.resolveModule('vscode-html-languageserver-bin', 'html').then(folder => {
            resolve(folder ? path.join(folder, 'htmlServerMain.js') : null)
          }, () => {
            resolve(null)
          })
        })
      },
      args: ['--node-ipc'],
      execArgv: config.execArgv,
      filetypes: config.filetypes,
      initializationOptions: {
        embeddedLanguages: {
          css: true,
          javascript: true
        }
      },
      enable: config.enable !== false
    }, ['html', 'javascript', 'css'])

    workspace.onDidModuleInstalled(mod => {
      if (mod == 'vscode-html-languageserver-bin') {
        this.init().catch(e => {
          logger.error(e)
        })
      }
    })
  }
}
