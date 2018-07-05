import path from 'path'
import {LanguageService} from '../../language-client'
import {ROOT} from '../../util'
import workspace from '../../workspace'

const ID = 'cssserver'

export default class CssService extends LanguageService {

  constructor() {
    const config = workspace.getConfiguration().get(ID) as any
    super(ID, 'CSS Language Server', {
      module: path.join(ROOT, 'lib/extensions/css/server.js'),
      execArgv: config.execArgv,
      filetypes: config.filetypes,
      enable: config.enable !== false
    }, ID)
  }
}
