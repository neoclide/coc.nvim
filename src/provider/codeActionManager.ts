'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { CodeAction, CodeActionContext, CodeActionKind, Command, Range } from 'vscode-languageserver-types'
import { isFalsyOrEmpty } from '../util/array'
import * as Is from '../util/is'
import { omit } from '../util/lodash'
import { CancellationToken, Disposable } from '../util/protocol'
import { CodeActionProvider, DocumentSelector } from './index'
import Manager from './manager'

interface ProviderMeta {
  kinds: CodeActionKind[] | undefined
  clientId: string
}

/*
 * With providerId so it can be resolved.
 */
export interface ExtendedCodeAction extends CodeAction {
  providerId?: string
}

function codeActionContains(kinds: CodeActionKind[], kind: CodeActionKind): boolean {
  return kinds.some(k => kind === k || kind.startsWith(k + '.'))
}

export function checkAction(only: CodeActionKind[] | undefined, action: CodeAction | Command): boolean {
  if (isFalsyOrEmpty(only)) return true
  if (Command.is(action)) return false
  return codeActionContains(only, action.kind)
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
    const only = isFalsyOrEmpty(context.only) ? undefined : context.only
    if (only) {
      providers = providers.filter(p => {
        if (Array.isArray(p.kinds) && !p.kinds.some(kind => codeActionContains(only, kind))) {
          return false
        }
        return true
      })
    }
    let res: ExtendedCodeAction[] = []
    const titles: string[] = []
    let results = await Promise.allSettled(providers.map(item => {
      let { provider, id } = item
      let fn = async () => {
        let actions = await Promise.resolve(provider.provideCodeActions(document, range, context, token))
        if (isFalsyOrEmpty(actions)) return
        for (let action of actions) {
          if (titles.includes(action.title) || !checkAction(only, action)) continue
          if (Command.is(action)) {
            let codeAction: ExtendedCodeAction = {
              title: action.title,
              command: action,
              providerId: id
            }
            res.push(codeAction)
          } else {
            res.push(Object.assign({ providerId: id }, action))
          }
          titles.push(action.title)
        }
      }
      return fn()
    }))
    this.handleResults(results, 'provideCodeActions')
    return res
  }

  public async resolveCodeAction(codeAction: ExtendedCodeAction, token: CancellationToken): Promise<CodeAction> {
    // no need to resolve
    if (codeAction.edit != null || codeAction.providerId == null) return codeAction
    let provider = this.getProviderById(codeAction.providerId)
    if (!provider || !Is.func(provider.resolveCodeAction)) return codeAction
    let resolved = await Promise.resolve(provider.resolveCodeAction(omit(codeAction, ['providerId']), token))
    return resolved ?? codeAction
  }
}
