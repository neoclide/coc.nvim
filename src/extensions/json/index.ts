import path from 'path'
import {LanguageService} from '../../language-client'
import {ROOT} from '../../util'
import workspace from '../../workspace'
import catalog from './catalog.json'
const logger = require('../../util/logger')('extension-json')

interface ISchemaAssociations {
  [pattern: string]: string[]
}

const ID = 'json'
export default class JsonService extends LanguageService {
  constructor() {
    const config = workspace.getConfiguration().get(ID) as any
    super('json', 'JSON Language Server', {
      module: path.join(ROOT, 'node_modules/vscode-json-languageserver/out/jsonServerMain.js'),
      args: ['--node-ipc'],
      execArgv: config.execArgv,
      filetypes: config.filetypes || ['json', 'jsonc'],
      enable: config.enable !== false
    }, ['json', 'http'])
  }

  public async init(): Promise<void> {
    await super.init()
    let associations: ISchemaAssociations = {}
    for (let item of catalog.schemas) {
      let {fileMatch, url} = item
      if (Array.isArray(fileMatch)) {
        for (let key of fileMatch) {
          associations[key] = [url]
        }
      } else if (typeof fileMatch === 'string') {
        associations[fileMatch] = [url]
      }
    }
    this.client.sendNotification('json/schemaAssociations', associations)
  }
}
