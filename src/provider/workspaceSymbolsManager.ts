'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, SymbolInformation } from 'vscode-languageserver-protocol'
import { WorkspaceSymbolProvider } from './index'
import Manager from './manager'

export default class WorkspaceSymbolManager extends Manager<WorkspaceSymbolProvider> {
  public register(provider: WorkspaceSymbolProvider): Disposable {
    return this.addProvider({
      id: uuid(),
      selector: [{ language: '*' }],
      provider
    })
  }

  public async provideWorkspaceSymbols(
    query: string,
    token: CancellationToken
  ): Promise<SymbolInformation[]> {
    let entries = Array.from(this.providers)
    if (!entries.length) return []
    let res: SymbolInformation[] = []
    await Promise.all(entries.map(o => {
      let { id, provider } = o
      return Promise.resolve(provider.provideWorkspaceSymbols(query, token)).then(list => {
        if (list) res.push(...list.map(item => Object.assign({ source: id }, item)))
      })
    }))
    return res
  }

  public async resolveWorkspaceSymbol(
    symbolInfo: SymbolInformation,
    token: CancellationToken
  ): Promise<SymbolInformation> {
    let provider = this.getProviderById((symbolInfo as any).source)
    if (!provider) return
    if (typeof provider.resolveWorkspaceSymbol != 'function') {
      return Promise.resolve(symbolInfo)
    }
    return await Promise.resolve(provider.resolveWorkspaceSymbol(symbolInfo, token))
  }

  public hasProvider(): boolean {
    return this.providers.size > 0
  }
}
