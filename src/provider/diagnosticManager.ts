'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentDiagnosticReport, DocumentSelector } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DiagnosticProvider } from './index'
import Manager, { ProviderItem } from './manager'

export default class DiagnosticManager extends Manager<DiagnosticProvider> {

  public register(selector: DocumentSelector, provider: DiagnosticProvider): Disposable {
    let item: ProviderItem<DiagnosticProvider> = {
      id: uuid(),
      selector,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async provideDiagnostics(document: TextDocument, previousResultId: string | undefined, token: CancellationToken): Promise<DocumentDiagnosticReport> {
    const item = this.getProvider(document)
    if (!item) return null

    const { provider } = item
    if (provider.provideDiagnostics === null) return null

    return await Promise.resolve(provider.provideDiagnostics(document, previousResultId, token))
  }
}
