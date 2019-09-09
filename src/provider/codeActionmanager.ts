import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, Command, Disposable, DocumentSelector, Range, TextDocument } from 'vscode-languageserver-protocol'
import { CodeActionProvider } from './index'
import Manager, { ProviderItem } from './manager'
import uuid = require('uuid/v4')
const logger = require('../util/logger')('codeActionManager')

export default class CodeActionManager extends Manager<CodeActionProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: CodeActionProvider, clientId: string, codeActionKinds?: CodeActionKind[]): Disposable {
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
  ): Promise<Map<string, CodeAction[]> | null> {
    let providers = this.getProviders(document)
    if (!providers.length) return null
    if (context.only) {
      let { only } = context
      providers = providers.filter(p => {
        if (p.kinds && !p.kinds.some(kind => only.indexOf(kind) != -1)) {
          return false
        }
        return true
      })
    }
    let res: Map<string, CodeAction[]> = new Map()
    await Promise.all(providers.map(item => {
      let { provider, clientId } = item
      clientId = clientId || uuid()
      return Promise.resolve(provider.provideCodeActions(document, range, context, token)).then(actions => {
        if (!actions || actions.length == 0) return
        let codeActions: CodeAction[] = res.get(clientId) || []
        for (let action of actions) {
          if (Command.is(action)) {
            codeActions.push(CodeAction.create(action.title, action))
          } else {
            if (context.only) {
              if (!action.kind || context.only.indexOf(action.kind) == -1) {
                continue
              }
            }
            let idx = codeActions.findIndex(o => o.title == action.title)
            if (idx == -1) codeActions.push(action)
          }
        }
        res.set(clientId, codeActions)
      })
    }))
    return res
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
