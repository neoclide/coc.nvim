import path from 'path'
import {LanguageService} from '../../language-client'
import {ROOT} from '../../util'
import workspace from '../../workspace'
const logger = require('../../util/logger')('extension-json')

export default class WxmlService extends LanguageService {
  constructor() {
    const config = workspace.getConfiguration().get('wxml') as any
    super('wxml', 'wxml Language Server', {
      module: path.join(ROOT, 'node_modules/wxml-langserver/bin/wxml-langserver'),
      args: ['--node-ipc'],
      execArgv: config.execArgv,
      filetypes: config.filetypes || ['wxml'],
      enable: config.enable !== false
    }, 'wxml')
  }
}
