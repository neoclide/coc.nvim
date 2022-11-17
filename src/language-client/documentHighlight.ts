'use strict'
import type { CancellationToken, ClientCapabilities, Disposable, DocumentHighlight, DocumentHighlightOptions, DocumentHighlightRegistrationOptions, DocumentSelector, Position, ServerCapabilities, TextDocumentRegistrationOptions } from 'vscode-languageserver-protocol'
import { TextDocument } from "vscode-languageserver-textdocument"
import languages from '../languages'
import { DocumentHighlightRequest } from '../util/protocol'
import { DocumentHighlightProvider, ProviderResult } from '../provider'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
import * as cv from './utils/converter'
import * as UUID from './utils/uuid'

export interface ProvideDocumentHighlightsSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<DocumentHighlight[]>
}

export interface DocumentHighlightMiddleware {
  provideDocumentHighlights?: (
    this: void,
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    next: ProvideDocumentHighlightsSignature
  ) => ProviderResult<DocumentHighlight[]>
}

export class DocumentHighlightFeature extends TextDocumentLanguageFeature<
  boolean | DocumentHighlightOptions, DocumentHighlightRegistrationOptions, DocumentHighlightProvider, DocumentHighlightMiddleware
> {
  constructor(client: FeatureClient<DocumentHighlightMiddleware>) {
    super(client, DocumentHighlightRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(
      ensure(capabilities, 'textDocument')!,
      'documentHighlight'
    )!.dynamicRegistration = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.documentHighlightProvider)
    if (!options) {
      return
    }
    this.register({
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: TextDocumentRegistrationOptions
  ): [Disposable, DocumentHighlightProvider] {
    const provider: DocumentHighlightProvider = {
      provideDocumentHighlights: (document, position, token) => {
        const client = this._client
        const _provideDocumentHighlights: ProvideDocumentHighlightsSignature = (document, position, token) => {
          return this.sendRequest(
            DocumentHighlightRequest.type,
            cv.asTextDocumentPositionParams(document, position),
            token
          )
        }
        const middleware = client.middleware!
        return middleware.provideDocumentHighlights
          ? middleware.provideDocumentHighlights(document, position, token, _provideDocumentHighlights)
          : _provideDocumentHighlights(document, position, token)
      }
    }
    return [languages.registerDocumentHighlightProvider(options.documentSelector!, provider), provider]
  }
}
