import path from 'path'
import {CancellationToken, CompletionContext, CompletionItem, CompletionList, InsertTextFormat, Position, TextDocument} from 'vscode-languageserver-protocol'
import {LanguageService} from '../../language-client'
import {LanguageClientOptions, ProvideCompletionItemsSignature} from '../../language-client/main'
import {ProviderResult} from '../../provider'
import workspace from '../../workspace'
const logger = require('../../util/logger')('cssserver')

const ID = 'cssserver'

export default class CssService extends LanguageService {

  constructor() {
    const config = workspace.getConfiguration().get(ID) as any
    super(ID, 'CSS Language Server', {
      module: () => {
        return new Promise(resolve => {
          workspace.resolveModule('css-langserver', 'cssserver').then(folder => {
            resolve(folder ? path.join(folder, 'lib/server.js') : null)
          }, () => {
            resolve(null)
          })
        })
      },
      args: ['--node-ipc'],
      execArgv: config.execArgv,
      filetypes: config.filetypes,
      enable: config.enable !== false
    }, ['cssserver', 'css', 'less', 'scss', 'wxss'])

    workspace.onDidModuleInstalled(mod => {
      if (mod == 'css-langserver') {
        this.init().catch(e => {
          logger.error(e)
        })
      }
    })
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
            let pre = doc.getline(position.line).slice(0, position.character)
            // searching for class name
            if (/(^|\s)\.\w*$/.test(pre)) {
              items = items.filter(o => o.label.startsWith('.'))
              items.forEach(fixItem)
            }
            if (context.triggerCharacter == ':'
              || /\:\w*$/.test(pre)) {
              items = items.filter(o => o.label.startsWith(':'))
              items.forEach(fixItem)
            }
            return items
          })
        }
      }
    })
    return clientOptions
  }
}

function fixItem(item: CompletionItem): void {
  item.data = item.data || {}
  item.data.abbr = item.label
  item.label = item.label.slice(1)
  item.textEdit = null
  item.insertTextFormat = InsertTextFormat.PlainText
}
