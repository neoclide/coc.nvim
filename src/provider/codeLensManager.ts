'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable } from '../util/protocol'
import type { CodeLens } from 'vscode-languageserver-types'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { omit } from '../util/lodash'
import { CodeLensProvider, DocumentSelector } from './index'
import Manager from './manager'
import { isCommand } from '../util/is'

interface CodeLensWithSource extends CodeLens {
  source?: string
}

export default class CodeLensManager extends Manager<CodeLensProvider> {

  public register(selector: DocumentSelector, provider: CodeLensProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider
    })
  }

  public async provideCodeLenses(
    document: TextDocument,
    token: CancellationToken
  ): Promise<CodeLensWithSource[] | null> {
    let providers = this.getProviders(document)
    let codeLens: CodeLens[] = []
    let results = await Promise.allSettled(providers.map(item => {
      let { provider, id } = item
      return Promise.resolve(provider.provideCodeLenses(document, token)).then(res => {
        if (Array.isArray(res)) {
          for (let item of res) {
            codeLens.push(Object.assign({ source: id }, item))
          }
        }
      })
    }))
    this.handleResults(results, 'provideCodeLenses')
    return codeLens
  }

  public async resolveCodeLens(
    codeLens: CodeLensWithSource,
    token: CancellationToken
  ): Promise<CodeLens> {
    // no need to resolve
    if (isCommand(codeLens.command)) return codeLens
    let provider = this.getProviderById(codeLens.source)
    if (!provider || typeof provider.resolveCodeLens != 'function') {
      return codeLens
    }
    let res = await Promise.resolve(provider.resolveCodeLens(omit(codeLens, ['source']), token))
    Object.assign(codeLens, res)
    return codeLens
  }
}
