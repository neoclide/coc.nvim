import { CancellationToken, CodeLens, Disposable, DocumentSelector, TextDocument } from 'vscode-languageserver-protocol'
import { CodeLensProvider } from './index'
import Manager, { ProviderItem } from './manager'
import uuid = require('uuid/v4')
import { omit } from '../util/lodash'
// const logger = require('../util/logger')('codeActionManager')

export default class CodeLensManager extends Manager<CodeLensProvider> implements Disposable {

  public register(selector: DocumentSelector, provider: CodeLensProvider): Disposable {
    let item: ProviderItem<CodeLensProvider> = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
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
        return res || []
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
    let provider = this.poviderById(source)
    if (!provider || typeof provider.resolveCodeLens != 'function') {
      // tslint:disable-next-line:no-console
      console.error(`CodeLens Resolve not supported`)
      return codeLens
    }
    let res = await Promise.resolve(provider.resolveCodeLens(omit(codeLens, ['source']), token))
    Object.assign(codeLens, res)
    return codeLens
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
