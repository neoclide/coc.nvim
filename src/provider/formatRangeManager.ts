'use strict'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Disposable, DocumentSelector, FormattingOptions, Range, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { DocumentRangeFormattingEditProvider } from './index'
import Manager from './manager'

export default class FormatRangeManager extends Manager<DocumentRangeFormattingEditProvider> {

  public register(selector: DocumentSelector,
    provider: DocumentRangeFormattingEditProvider,
    priority: number): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider,
      priority
    })
  }

  /**
   * Multiple providers can be registered for a language. In that case providers are sorted
   * by their {@link languages.match score} and the best-matching provider is used. Failure
   * of the selected provider will cause a failure of the whole operation.
   */
  public async provideDocumentRangeFormattingEdits(
    document: TextDocument,
    range: Range,
    options: FormattingOptions,
    token: CancellationToken
  ): Promise<TextEdit[]> {
    let item = this.getProvider(document)
    if (!item) return null
    let { provider } = item
    return await Promise.resolve(provider.provideDocumentRangeFormattingEdits(document, range, options, token))
  }
}
