'use strict'
import type { CancellationToken, ClientCapabilities, Disposable, DocumentLink, DocumentLinkOptions, DocumentLinkRegistrationOptions, DocumentSelector, ServerCapabilities } from 'vscode-languageserver-protocol'
import { TextDocument } from "vscode-languageserver-textdocument"
import languages from '../languages'
import { DocumentLinkProvider, ProviderResult } from '../provider'
import { DocumentLinkRequest, DocumentLinkResolveRequest } from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
import * as UUID from './utils/uuid'

export interface ProvideDocumentLinksSignature {
  (this: void, document: TextDocument, token: CancellationToken): ProviderResult<DocumentLink[]>
}

export interface ResolveDocumentLinkSignature {
  (this: void, link: DocumentLink, token: CancellationToken): ProviderResult<DocumentLink>
}

export interface DocumentLinkMiddleware {
  provideDocumentLinks?: (
    this: void,
    document: TextDocument,
    token: CancellationToken,
    next: ProvideDocumentLinksSignature
  ) => ProviderResult<DocumentLink[]>
  resolveDocumentLink?: (
    this: void,
    link: DocumentLink,
    token: CancellationToken,
    next: ResolveDocumentLinkSignature
  ) => ProviderResult<DocumentLink>
}

export class DocumentLinkFeature extends TextDocumentLanguageFeature<DocumentLinkOptions, DocumentLinkRegistrationOptions, DocumentLinkProvider, DocumentLinkMiddleware> {
  constructor(client: FeatureClient<DocumentLinkMiddleware>) {
    super(client, DocumentLinkRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    const documentLinkCapabilities = ensure(ensure(capabilities, 'textDocument')!, 'documentLink')!
    documentLinkCapabilities.dynamicRegistration = true
    documentLinkCapabilities.tooltipSupport = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.documentLinkProvider)
    if (!options) {
      return
    }
    this.register({
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: DocumentLinkRegistrationOptions
  ): [Disposable, DocumentLinkProvider] {
    const provider: DocumentLinkProvider = {
      provideDocumentLinks: (document: TextDocument, token: CancellationToken): ProviderResult<DocumentLink[]> => {
        const client = this._client
        const provideDocumentLinks: ProvideDocumentLinksSignature = (document, token) => {
          return this.sendRequest(
            DocumentLinkRequest.type,
            { textDocument: { uri: document.uri } },
            token
          )
        }
        const middleware = client.middleware!
        return middleware.provideDocumentLinks
          ? middleware.provideDocumentLinks(document, token, provideDocumentLinks)
          : provideDocumentLinks(document, token)
      },
      resolveDocumentLink: options.resolveProvider
        ? (link, token) => {
          const client = this._client
          let resolveDocumentLink: ResolveDocumentLinkSignature = (link, token) => {
            return this.sendRequest(DocumentLinkResolveRequest.type, link, token, link)
          }
          const middleware = client.middleware!
          return middleware.resolveDocumentLink
            ? middleware.resolveDocumentLink(link, token, resolveDocumentLink)
            : resolveDocumentLink(link, token)
        }
        : undefined
    }

    return [languages.registerDocumentLinkProvider(options.documentSelector, provider), provider]
  }
}
