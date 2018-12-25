import { CancellationToken, Disposable, DocumentSelector, FormattingOptions, TextDocument, TextEdit } from 'vscode-languageserver-protocol'
import { DocumentFormattingEditProvider } from './index'
import Manager, { ProviderItem } from './manager'
import uuid = require('uuid/v4')

export default class FormatManager extends Manager<DocumentFormattingEditProvider> implements Disposable {

  public register(selector: DocumentSelector,
    provider: DocumentFormattingEditProvider,
    priority = 0): Disposable {
    let item: ProviderItem<DocumentFormattingEditProvider> = {
      id: uuid(),
      selector,
      priority,
      provider
    }
    this.providers.add(item)
    return Disposable.create(() => {
      this.providers.delete(item)
    })
  }

  public async provideDocumentFormattingEdits(
    document: TextDocument,
    options: FormattingOptions,
    token: CancellationToken
  ): Promise<TextEdit[]> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    return await Promise.resolve(provider.provideDocumentFormattingEdits(document, options, token))
  }

  public dispose(): void {
    this.providers = new Set()
  }
}
