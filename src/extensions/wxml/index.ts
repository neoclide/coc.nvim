import path from 'path'
import {LanguageService} from '../../language-client'
import workspace from '../../workspace'
const logger = require('../../util/logger')('extension-wxml')
const file = 'lib/wxmlServerMain.js'

export default class WxmlService extends LanguageService {
  constructor() {
    const config = workspace.getConfiguration().get('wxml') as any
    super('wxml', 'wxml Language Server', {
      module: () => {
        return new Promise(resolve => {
          workspace.resolveModule('wxml-langserver', 'wxml').then(folder => {
            resolve(folder ? path.join(folder, file) : null)
          }, () => {
            resolve(null)
          })
        })
      },
      args: ['--node-ipc'],
      execArgv: config.execArgv,
      filetypes: config.filetypes || ['wxml'],
      enable: config.enable !== false
    }, 'wxml')

    workspace.onDidModuleInstalled(mod => {
      if (mod == 'wxml-langserver') {
        this.init().catch(e => {
          logger.error(e)
        })
      }
    })
  }
}
