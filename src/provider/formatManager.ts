'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, FormattingOptions, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DocumentFormattingEditProvider } from './index'
import Manager from './manager'

export default class FormatManager extends Manager<DocumentFormattingEditProvider> {

  public register(selector: DocumentSelector, provider: DocumentFormattingEditProvider, priority: number): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      priority,
      provider
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
}
