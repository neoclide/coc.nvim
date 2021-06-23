import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, Command, Disposable, DocumentSelector, Range } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { CodeActionProvider } from './index'
import Manager, { ProviderItem } from './manager'
import { v4 as uuid } from 'uuid'
const logger = require('../util/logger')('codeActionManager')

export default class CodeActionManager extends Manager<CodeActionProvider> implements Disposable {
  // action to provider uuid
  private providerMap: WeakMap<CodeAction, string> = new WeakMap()

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
      let { provider, id } = item
      return Promise.resolve(provider.provideCodeActions(document, range, context, token)).then(actions => {
        if (!actions || actions.length == 0) return
        for (let action of actions) {
          if (Command.is(action)) {
            let codeAction: CodeAction = {
              title: action.title,
              command: action
            }
            res.push(codeAction)
            this.providerMap.set(codeAction, id)
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
            if (idx == -1) {
              this.providerMap.set(action, id)
              res.push(action)
            }
          }
        }
      })
    }))
    return res
  }

  public async resolveCodeAction(codeAction: CodeAction, token: CancellationToken): Promise<CodeAction> {
    // no need to resolve
    if (codeAction.edit != null) return codeAction
    let id = this.providerMap.get(codeAction)
    if (!id) throw new Error(`provider id not found from codeAction`)
    let provider = this.getProviderById(id)
    if (!provider || typeof provider.resolveCodeAction !== 'function') {
      return codeAction
    }
    let resolved = await Promise.resolve(provider.resolveCodeAction(codeAction, token))
    // save the map to support resolveClientId
    if (resolved) this.providerMap.set(resolved, id)
    return resolved || codeAction
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
