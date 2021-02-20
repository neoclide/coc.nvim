import { CancellationToken, CodeActionContext, CodeActionKind, Command, Disposable, DocumentSelector, Range } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { CodeActionProvider } from './index'
import Manager, { ProviderItem } from './manager'
import { v4 as uuid } from 'uuid'
import { CodeAction } from '../types'
import { intersect } from '../util/array'
const logger = require('../util/logger')('codeActionManager')

export default class CodeActionManager extends Manager<CodeActionProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: CodeActionProvider, clientId: string | undefined, codeActionKinds?: CodeActionKind[]): Disposable {
    let item: ProviderItem<CodeActionProvider> = {
      id: uuid(),
      selector,
      provider,
      kinds: codeActionKinds,
      clientId
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async provideCodeActions(
    document: TextDocument,
    range: Range,
    context: CodeActionContext,
    token: CancellationToken
  ): Promise<CodeAction[]> {
    let providers = this.getProviders(document)
    if (!providers.length) return null
    if (context.only) {
      let { only } = context
      providers = providers.filter(p => {
        if (p.kinds && !p.kinds.some(kind => only.includes(kind))) {
          return false
        }
        return true
      })
    }
    let res: CodeAction[] = []
    await Promise.all(providers.map(item => {
      let { provider, clientId } = item
      return Promise.resolve(provider.provideCodeActions(document, range, context, token)).then(actions => {
        if (!actions || actions.length == 0) return
        for (let action of actions) {
          if (Command.is(action)) {
            let codeAction: CodeAction = {
              title: action.title,
              command: action,
              clientId
            }
            res.push(codeAction)
          } else {
            if (context.only) {
              if (!action.kind) continue
              let found = false
              for (let only of context.only) {
                if (action.kind.startsWith(only)) {
                  found = true
                  break
                }
              }
              if (!found) continue
            }
            let idx = res.findIndex(o => o.title == action.title)
            if (idx == -1) res.push(Object.assign({ clientId }, action))
          }
        }
      })
    }))
    return res
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
