import { CancellationToken, CodeLens, Disposable, DocumentSelector, TextDocument } from 'vscode-languageserver-protocol'
import workspace from '../workspace'
import { CodeLensProvider } from './index'
import Manager, { ProviderItem } from './manager'
import uuid = require('uuid/v4')
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
      let res = Promise.resolve(provider.provideCodeLenses(document, token))
      if (Array.isArray(res)) {
        for (let o of res) {
          o.data = o.data || []
          o.data.source = id
        }
      }
      return res || []
    }))
    return [].concat(...arr)
  }

  public async resolveCodeLens(
    codeLens: CodeLens,
    token: CancellationToken
  ): Promise<CodeLens> {
    let { data } = codeLens
    if (!data || !data.id) {
      workspace.showMessage('Source id of codelens not found', 'error')
      return null
    }
    let provider = this.poviderById(data.id)
    if (!provider) return null
    return await Promise.resolve(provider.resolveCodeLens(codeLens, token))
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
