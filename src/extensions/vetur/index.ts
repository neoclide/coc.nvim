import path from 'path'
import {LanguageService} from '../../language-client'
import {ROOT} from '../../util'
import workspace from '../../workspace'
import { WorkspaceConfiguration } from '../../types'
import { LanguageClientOptions } from '../../language-client/main'
const logger = require('../../util/logger')('extension-vetur')

const sections = ['vetur', 'emmet', 'html', 'javascript', 'typescript', 'prettier', 'stylusSupremacy']

function getConfig(config:WorkspaceConfiguration):any {
  let res = {}
  for (let section of sections) {
    let o = config.get(section)
    res[section] = o || {}
  }
  return res
}

export default class VeturService extends LanguageService {
  constructor() {
    let c = workspace.getConfiguration()
    const config = c.get('vetur') as any
    super('vetur', 'Vetur Language Server', {
      module: path.join(ROOT, 'node_modules/vue-language-server/dist/vueServerMain.js'),
      execArgv: config.execArgv || [],
      filetypes: config.filetypes || ['vue'],
      initializationOptions: {
        config: getConfig(c)
      },
      enable: config.enable !== false
    })
  }

  protected resolveClientOptions(clientOptions: LanguageClientOptions): LanguageClientOptions {
    Object.assign(clientOptions, {
      synchronize: {
        configurationSection: sections,
        fileEvents: workspace.createFileSystemWatcher('{**/*.js,**/*.ts}', true, false, true)
      }
    })
    return clientOptions
  }
}
