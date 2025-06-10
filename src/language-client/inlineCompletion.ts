import {
  CancellationToken,
  ClientCapabilities,
  Disposable,
  DocumentSelector,
  InlineCompletionContext,
  InlineCompletionItem,
  InlineCompletionList,
  InlineCompletionOptions,
  InlineCompletionParams,
  InlineCompletionRegistrationOptions,
  InlineCompletionRequest,
  Position,
  ServerCapabilities
} from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import languages from '../languages'
import { InlineCompletionItemProvider, ProviderResult } from '../provider'
import {
  ensure,
  FeatureClient,
  TextDocumentLanguageFeature
} from './features'
import * as UUID from './utils/uuid'

export interface ProvideInlineCompletionItemsSignature {
  (this: void, document: TextDocument, position: Position, context: InlineCompletionContext, token: CancellationToken): ProviderResult<InlineCompletionItem[] | InlineCompletionList>
}

export interface InlineCompletionMiddleware {
  provideInlineCompletionItems?: (this: void, document: TextDocument, position: Position, context: InlineCompletionContext, token: CancellationToken, next: ProvideInlineCompletionItemsSignature) => ProviderResult<InlineCompletionItem[] | InlineCompletionList>
}

export interface InlineCompletionProviderShape {
  provider: InlineCompletionItemProvider
}

export class InlineCompletionItemFeature extends TextDocumentLanguageFeature<boolean | InlineCompletionOptions, InlineCompletionRegistrationOptions, InlineCompletionItemProvider, InlineCompletionMiddleware> {

  constructor(client: FeatureClient<InlineCompletionMiddleware>) {
    super(client, InlineCompletionRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    const inlineCompletion = ensure(ensure(capabilities, 'textDocument')!, 'inlineCompletion')!
    inlineCompletion.dynamicRegistration = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.inlineCompletionProvider)
    if (!options) {
      return
    }

    this.register({
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(options: InlineCompletionRegistrationOptions): [Disposable, InlineCompletionItemProvider] {
    const provider: InlineCompletionItemProvider = {
      provideInlineCompletionItems: (document: TextDocument, position: Position, context: InlineCompletionContext, token: CancellationToken): ProviderResult<InlineCompletionList | InlineCompletionItem[]> => {
        const provideInlineCompletionItems: ProvideInlineCompletionItemsSignature = (document, position, context, token) => {
          const params: InlineCompletionParams = {
            textDocument: { uri: document.uri },
            position,
            context
          }
          return this.sendRequest(InlineCompletionRequest.type, params, token, null)
        }

        const middleware = this._client.middleware
        return middleware.provideInlineCompletionItems
          ? middleware.provideInlineCompletionItems(document, position, context, token, provideInlineCompletionItems)
          : provideInlineCompletionItems(document, position, context, token)
      }
    }
    this._client.attachExtensionName(provider)
    return [languages.registerInlineCompletionItemProvider(options.documentSelector, provider), provider]
  }
}
