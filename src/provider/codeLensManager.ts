'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, CodeLens, Disposable, DocumentSelector } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { omit } from '../util/lodash'
import { CodeLensProvider } from './index'
import Manager from './manager'
// const logger = require('../util/logger')('codeActionManager')

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
  ): Promise<CodeLens[] | null> {
    let providers = this.getProviders(document)
    if (!providers.length) return null
    let arr = await Promise.all(providers.map(item => {
      let { provider, id } = item
      return Promise.resolve(provider.provideCodeLenses(document, token)).then(res => {
        if (Array.isArray(res)) {
          for (let item of res) {
            (item as any).source = id
          }
        }
        return res
      })
    }))
    return [].concat(...arr)
  }

  public async resolveCodeLens(
    codeLens: CodeLens,
    token: CancellationToken
  ): Promise<CodeLens> {
    // no need to resolve
    if (codeLens.command) return codeLens
    let { source } = codeLens as any
    let provider = this.getProviderById(source)
    if (!provider || typeof provider.resolveCodeLens != 'function') {
      return codeLens
    }
    let res = await Promise.resolve(provider.resolveCodeLens(omit(codeLens, ['source']), token))
    Object.assign(codeLens, res)
    return codeLens
  }
}
