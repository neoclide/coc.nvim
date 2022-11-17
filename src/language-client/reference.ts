'use strict'
import type { CancellationToken, ClientCapabilities, Disposable, DocumentSelector, Location, Position, ReferenceOptions, ReferenceRegistrationOptions, ServerCapabilities, TextDocumentRegistrationOptions } from 'vscode-languageserver-protocol'
import { TextDocument } from "vscode-languageserver-textdocument"
import languages from '../languages'
import { ProviderResult, ReferenceProvider } from '../provider'
import { ReferencesRequest } from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
import * as cv from './utils/converter'
import * as UUID from './utils/uuid'

export interface ProvideReferencesSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    options: { includeDeclaration: boolean },
    token: CancellationToken
  ): ProviderResult<Location[]>
}

export interface ReferencesMiddleware {
  provideReferences?: (
    this: void,
    document: TextDocument,
    position: Position,
    options: { includeDeclaration: boolean },
    token: CancellationToken,
    next: ProvideReferencesSignature
  ) => ProviderResult<Location[]>
}

export class ReferencesFeature extends TextDocumentLanguageFeature<
  boolean | ReferenceOptions, ReferenceRegistrationOptions, ReferenceProvider, ReferencesMiddleware
> {
  constructor(client: FeatureClient<ReferencesMiddleware>) {
    super(client, ReferencesRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(
      ensure(capabilities, 'textDocument')!,
      'references'
    )!.dynamicRegistration = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.referencesProvider)
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
  ): [Disposable, ReferenceProvider] {
    const provider: ReferenceProvider = {
      provideReferences: (document, position, options, token) => {
        const client = this._client
        const _providerReferences: ProvideReferencesSignature = (document, position, options, token) => {
          return this.sendRequest(
            ReferencesRequest.type,
            cv.asReferenceParams(document, position, options),
            token
          )
        }
        const middleware = client.middleware!
        return middleware.provideReferences
          ? middleware.provideReferences(document, position, options, token, _providerReferences)
          : _providerReferences(document, position, options, token)
      }
    }
    return [languages.registerReferencesProvider(options.documentSelector!, provider), provider]
  }
}
