'use strict'
import type { CancellationToken, ClientCapabilities, Disposable, DocumentSelector, Hover, HoverOptions, HoverRegistrationOptions, Position, ServerCapabilities } from 'vscode-languageserver-protocol'
import { TextDocument } from "vscode-languageserver-textdocument"
import languages from '../languages'
import { HoverProvider, ProviderResult } from '../provider'
import { HoverRequest } from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
import * as cv from './utils/converter'
import * as UUID from './utils/uuid'

export interface ProvideHoverSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<Hover>
}

export interface HoverMiddleware {
  provideHover?: (
    this: void,
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    next: ProvideHoverSignature
  ) => ProviderResult<Hover>
}

export class HoverFeature extends TextDocumentLanguageFeature<
  boolean | HoverOptions, HoverRegistrationOptions, HoverProvider, HoverMiddleware
> {
  constructor(client: FeatureClient<HoverMiddleware>) {
    super(client, HoverRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    const hoverCapability = ensure(
      ensure(capabilities, 'textDocument')!,
      'hover'
    )!
    hoverCapability.dynamicRegistration = true
    hoverCapability.contentFormat = this._client.supportedMarkupKind
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.hoverProvider)
    if (!options) {
      return
    }
    this.register({
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: HoverRegistrationOptions
  ): [Disposable, HoverProvider] {
    const provider: HoverProvider = {
      provideHover: (document, position, token) => {
        const client = this._client
        const provideHover: ProvideHoverSignature = (document, position, token) => {
          return this.sendRequest(
            HoverRequest.type,
            cv.asTextDocumentPositionParams(document, position),
            token
          )
        }

        const middleware = client.middleware!
        return middleware.provideHover
          ? middleware.provideHover(document, position, token, provideHover)
          : provideHover(document, position, token)
      }
    }
    return [languages.registerHoverProvider(options.documentSelector!, provider), provider]
  }
}
