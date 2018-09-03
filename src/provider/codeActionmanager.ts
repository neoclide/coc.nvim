import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, Command, Disposable, DocumentSelector, Range, TextDocument } from 'vscode-languageserver-protocol'
import { CodeActionProvider } from './index'
import Manager, { ProviderItem } from './manager'
import uuid = require('uuid/v4')
const logger = require('../util/logger')('codeActionManager')

export default class CodeActionManager extends Manager<CodeActionProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: CodeActionProvider, codeActionKinds?: CodeActionKind[]): Disposable {
    let item: ProviderItem<CodeActionProvider> = {
      id: uuid(),
      selector,
      provider,
      kinds: codeActionKinds
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  private mergeCodeActions(arr: (Command | CodeAction)[][]): CodeAction[] {
    let res: CodeAction[] = []
    for (let actions of arr) {
      if (actions == null) continue
      for (let action of actions) {
        if (CodeAction.is(action)) {
          let idx = res.findIndex(o => o.title == action.title)
          if (idx == -1) res.push(action)
        } else {
          res.push(CodeAction.create(action.title, action))
        }
      }
    }
    return res
  }

  public async provideCodeActions(
    document: TextDocument,
    range: Range,
    context: CodeActionContext,
    token: CancellationToken
  ): Promise<CodeAction[] | null> {
    let providers = this.getProviders(document)
    if (!providers.length) return null
    let arr = await Promise.all(providers.map(item => {
      let { provider } = item
      return Promise.resolve(provider.provideCodeActions(document, range, context, token))
    }))
    return this.mergeCodeActions(arr)
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
