import path from 'path'
import {CancellationToken, CompletionContext, CompletionItem, CompletionList, Position, TextDocument} from 'vscode-languageserver-protocol'
import {ProviderResult} from '../../provider'
import {LanguageService} from '../../language-client'
import {ROOT} from '../../util'
import workspace from '../../workspace'
import catalog from './catalog.json'
import {LanguageClientOptions, ProvideCompletionItemsSignature} from '../../language-client/main'
import Uri from 'vscode-uri'
import {readdirAsync} from '../../util/fs'
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
    const files = await this.getSchemaFiles()
    associations['coc-settings.json'] = files.map(f => Uri.file(f).toString())
    this.client.sendNotification('json/schemaAssociations', associations)
  }

  private async getSchemaFiles(): Promise<string[]> {
    const files = [path.join(ROOT, 'data/schema.json')]
    try {
      const base = path.join(ROOT, 'src/extensions')
      const folders = await readdirAsync(base)
      files.push(...folders.map(f => path.join(base, f + '/schema.json')))
    } catch (e) {
      logger.error(e.message)
    }
    return files
  }

  protected resolveClientOptions(clientOptions: LanguageClientOptions): LanguageClientOptions {
    Object.assign(clientOptions, {
      middleware: {
        provideCompletionItem: (
          document: TextDocument,
          position: Position,
          context: CompletionContext,
          token: CancellationToken,
          next: ProvideCompletionItemsSignature
        ): ProviderResult<CompletionItem[] | CompletionList> => {
          return Promise.resolve(next(document, position, context, token)).then((res: CompletionItem[] | CompletionList) => {
            let doc = workspace.getDocument(document.uri)
            if (!doc) return []
            let items: CompletionItem[] = res.hasOwnProperty('isIncomplete') ? (res as CompletionList).items : res as CompletionItem[]
            for (let item of items) {
              let {textEdit, insertText} = item
              item.insertText = null
              if (textEdit && textEdit.newText) {
                let newText = insertText || textEdit.newText
                textEdit.newText = newText.replace(/(\n|\t)/g, '')
              }
            }
            return items
          })
        }
      }
    })
    return clientOptions
  }
}
