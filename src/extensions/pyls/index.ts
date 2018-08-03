import which from 'which'
import {LanguageService} from '../../language-client'
import workspace from '../../workspace'
import { showQuickpick, echoMessage } from '../../util'
const logger = require('../../util/logger')('extension-pyls')

const ID = 'pyls'
export default class PythonService extends LanguageService {

  constructor() {
    const config = workspace.getConfiguration().get(ID) as any
    const command = config.commandPath || 'pyls'
    super(ID, 'Python Language Server', {
      command,
      args: ['-vv'].concat(config.args || []),
      filetypes: config.filetypes || ['python'],
      enable: config.enable !== false
    }, ID)
  }

  public async init(): Promise<void> {
    let {command} = this.config
    try {
      which.sync(command)
      this.enable = true
    } catch (e) {
      this.enable = false
      let items = [
        'Install python-language-server with pip',
        'Install python-language-server with pip3',
        'Checkout documentation of python-language-server',
        'Disable pyls extension'
      ]
      let idx = await showQuickpick(workspace.nvim, items, `${command} not found in $PATH`)
      if (idx == -1) return
      if (idx == 2) {
        workspace.nvim.call('coc#util#open', ['https://github.com/palantir/python-language-server#installation'], true) // tslint:disable-line
        return
      }
      if (idx == 3) {
        let config = workspace.getConfiguration('pyls')
        config.update('enable', false, true)
        echoMessage(workspace.nvim, `pyls disabled`)
        return
      }
      let cmd = `${idx == 1 ? 'pip' : 'pip3'} install python-language-server`
      let res = await workspace.runTerminalCommand(cmd)
      if (!res.success) return
      try {
        which.sync('pyls')
        this.enable = true
      } catch (e) {
        return
      }
    }
    await super.init()
  }
}
