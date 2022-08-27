'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, Command, Disposable, DocumentSelector, Range } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { ExtendedCodeAction } from '../types'
import { omit } from '../util/lodash'
import { CodeActionProvider } from './index'
import Manager from './manager'
const logger = require('../util/logger')('codeActionManager')

interface ProviderMeta {
  kinds: CodeActionKind[] | undefined
  clientId: string
}

export default class CodeActionManager extends Manager<CodeActionProvider, ProviderMeta> {
  public register(selector: DocumentSelector, provider: CodeActionProvider, clientId: string | undefined, codeActionKinds?: CodeActionKind[]): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider,
      kinds: codeActionKinds,
      clientId
    })
  }

  public async provideCodeActions(
    document: TextDocument,
    range: Range,
    context: CodeActionContext,
    token: CancellationToken
  ): Promise<ExtendedCodeAction[]> {
    let providers = this.getProviders(document)
    if (context.only && providers.length > 0) {
      let { only } = context
      providers = providers.filter(p => {
        if (Array.isArray(p.kinds) && !p.kinds.some(kind => only.includes(kind))) {
          return false
        }
        return true
      })
    }
    let res: ExtendedCodeAction[] = []
    let results = await Promise.allSettled(providers.map(item => {
      let { provider, id } = item
      return Promise.resolve(provider.provideCodeActions(document, range, context, token)).then(actions => {
        if (!actions || actions.length == 0) return
        let noCheck = res.length === 0
        for (let action of actions) {
          if (Command.is(action)) {
            let codeAction: ExtendedCodeAction = {
              title: action.title,
              command: action,
              providerId: id
            }
            res.push(codeAction)
          } else {
            if (context.only && context.only.length > 0) {
              let match = context.only.some(k => (action as CodeAction).kind?.startsWith(k))
              if (!match) continue
            }
            if (noCheck || res.findIndex(o => o.title == action.title) === -1) {
              res.push(Object.assign({ providerId: id }, action))
            }
          }
        }
      })
    }))
    this.handleResults(results, 'provideCodeActions')
    return res
  }

  public async resolveCodeAction(codeAction: ExtendedCodeAction, token: CancellationToken): Promise<CodeAction> {
    // no need to resolve
    if (codeAction.edit != null || codeAction.providerId == null) return codeAction
    let provider = this.getProviderById(codeAction.providerId)
    if (!provider || typeof provider.resolveCodeAction !== 'function') {
      return codeAction
    }
    let resolved = await Promise.resolve(provider.resolveCodeAction(omit(codeAction, ['providerId']), token))
    return resolved ?? codeAction
  }
}
