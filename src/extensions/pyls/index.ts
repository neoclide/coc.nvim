import which from 'which'
import {LanguageService} from '../../language-client'
import workspace from '../../workspace'
const logger = require('../../util/logger')('extension-pyls')

const ID = 'pyls'
export default class PythonService extends LanguageService {

  constructor() {
    const config = workspace.getConfiguration().get(ID) as any
    const command = config.commandPath || 'pyls'
    super(ID, 'Python Language Server', {
      command,
      args: ['-vv'],
      filetypes: config.filetypes || ['python'],
      enable: config.enable !== false
    }, ID)
    try {
      which.sync(command)
      this.enable = config.enable !== false
    } catch (e) {
      this.enable = false
    }
    // TODO support snippet for function params
  }
}
