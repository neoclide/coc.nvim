'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, SymbolInformation } from 'vscode-languageserver-protocol'
import { WorkspaceSymbolProvider } from './index'
import Manager from './manager'

interface SymbolInformationWithSource extends SymbolInformation {
  source?: string
}

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
    let infos: SymbolInformation[] = []
    let results = await Promise.allSettled(entries.map(o => {
      let { id, provider } = o
      return Promise.resolve(provider.provideWorkspaceSymbols(query, token)).then(list => {
        if (list) infos.push(...list.map(item => Object.assign({ source: id }, item)))
      })
    }))
    this.handleResults(results, 'provideWorkspaceSymbols')
    return infos
  }

  public async resolveWorkspaceSymbol(
    symbolInfo: SymbolInformationWithSource,
    token: CancellationToken
  ): Promise<SymbolInformation> {
    let provider = this.getProviderById(symbolInfo.source)
    if (!provider || typeof provider.resolveWorkspaceSymbol !== 'function') return symbolInfo
    return provider.resolveWorkspaceSymbol(symbolInfo, token)
  }

  public hasProvider(): boolean {
    return this.providers.size > 0
  }
}
