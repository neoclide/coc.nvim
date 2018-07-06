import path from 'path'
import {LanguageService} from '../../language-client'
import {ROOT} from '../../util'
import workspace from '../../workspace'
const logger = require('../../util/logger')('extension-html')

export default class HtmlService extends LanguageService {
  constructor() {
    const config = workspace.getConfiguration().get('html') as any
    super('html', 'HTML Language Server', {
      module: path.join(ROOT, 'node_modules/vscode-html-languageserver-bin/htmlServerMain.js'),
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
    }, ['html', 'javascript'])
  }
}
