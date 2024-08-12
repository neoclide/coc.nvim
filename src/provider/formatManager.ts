'use strict'
import { v4 as uuid } from 'uuid'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { FormattingOptions, TextEdit } from 'vscode-languageserver-types'
import { createLogger } from '../logger'
import { TextDocumentMatch } from '../types'
import { CancellationToken, Disposable } from '../util/protocol'
import workspace from '../workspace'
import { DocumentFormattingEditProvider, DocumentSelector } from './index'
import Manager, { ProviderItem } from './manager'

const logger = createLogger('provider-formatManager')

interface ProviderMeta {
  extensionName: string,
}

export default class FormatManager extends Manager<DocumentFormattingEditProvider, ProviderMeta> {

  public register(extensionName: string, selector: DocumentSelector, provider: DocumentFormattingEditProvider, priority: number): Disposable {
    return this.addProvider({
      id: uuid(),
      selector,
      priority,
      provider,
      extensionName,
    })
  }

  public async provideDocumentFormattingEdits(
    document: TextDocument,
    options: FormattingOptions,
    token: CancellationToken
  ): Promise<TextEdit[]> {
    let item = this.getProvider(document)
    if (!item) return null
    logger.info("Format by:", item.extensionName)
    let { provider } = item
    return await Promise.resolve(provider.provideDocumentFormattingEdits(document, options, token))
  }

  protected override getProvider(document: TextDocumentMatch): ProviderItem<DocumentFormattingEditProvider, ProviderMeta> {
    // Prefer user choice
    const userChoice = workspace.getConfiguration('coc.preferences', document).get<string>('formatterExtension')
    if (userChoice) {
      const items = this.getProviders(document)
      const userChoiceProvider = items.find(item => item.extensionName === userChoice)
      if (userChoiceProvider) {
        logger.info("Using user-specified formatter:", userChoice)
        return userChoiceProvider
      }

      logger.error("User-specified formatter not found:", userChoice)
      return null
    }

    return super.getProvider(document)
  }
}
