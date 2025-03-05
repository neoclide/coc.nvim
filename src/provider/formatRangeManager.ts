'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { FormattingOptions, Range, TextEdit } from 'vscode-languageserver-types'
import { createLogger } from '../logger'
import { TextDocumentMatch } from '../types'
import { CancellationToken, Disposable } from '../util/protocol'
import workspace from '../workspace'
import { DocumentRangeFormattingEditProvider, DocumentSelector } from './index'
import Manager, { ProviderItem } from './manager'

const logger = createLogger('provider-formatRangeManager')

interface ProviderMeta {
  extensionName: string,
}

export default class FormatRangeManager extends Manager<DocumentRangeFormattingEditProvider, ProviderMeta> {

  public register(extensionName: string, selector: DocumentSelector,
    provider: DocumentRangeFormattingEditProvider,
    priority: number): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      provider,
      priority,
      extensionName,
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
    logger.info("Range format by:", item.extensionName)
    let { provider } = item
    return await Promise.resolve(provider.provideDocumentRangeFormattingEdits(document, range, options, token))
  }

  protected override getProvider(document: TextDocumentMatch): ProviderItem<DocumentRangeFormattingEditProvider, ProviderMeta> {
    // Prefer user choice
    const userChoice = workspace.getConfiguration('coc.preferences', document).get<string>('formatterExtension')
    if (userChoice) {
      const items = this.getProviders(document)
      const userChoiceProvider = items.find(item => item.extensionName === userChoice)
      if (userChoiceProvider) {
        logger.info("Using user-specified range formatter:", userChoice)
        return userChoiceProvider
      }

      logger.error("User-specified range formatter not found:", userChoice)
      return null
    }

    return super.getProvider(document)
  }
}
