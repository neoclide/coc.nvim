'use strict'
import type { CancellationToken, ClientCapabilities, Definition, DefinitionLink, Disposable, DocumentSelector, ImplementationOptions, ImplementationRegistrationOptions, Position, ServerCapabilities } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import languages from '../languages'
import { ImplementationProvider, ProviderResult } from '../provider'
import { ImplementationRequest } from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
import * as cv from './utils/converter'

export interface ProvideImplementationSignature {
  (this: void, document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Definition | DefinitionLink[]>
}

export interface ImplementationMiddleware {
  provideImplementation?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideImplementationSignature) => ProviderResult<Definition | DefinitionLink[]>
}

export class ImplementationFeature extends TextDocumentLanguageFeature<boolean | ImplementationOptions, ImplementationRegistrationOptions, ImplementationProvider, ImplementationMiddleware> {

  constructor(client: FeatureClient<ImplementationMiddleware>) {
    super(client, ImplementationRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    const implementationSupport = ensure(ensure(capabilities, 'textDocument')!, 'implementation')!
    implementationSupport.dynamicRegistration = true
    implementationSupport.linkSupport = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    const [id, options] = this.getRegistration(documentSelector, capabilities.implementationProvider)
    if (!id || !options) {
      return
    }
    this.register({ id, registerOptions: options })
  }

  protected registerLanguageProvider(options: ImplementationRegistrationOptions): [Disposable, ImplementationProvider] {
    const provider: ImplementationProvider = {
      provideImplementation: (document, position, token) => {
        const client = this._client
        const provideImplementation: ProvideImplementationSignature = (document, position, token) =>
          this.sendRequest(ImplementationRequest.type, cv.asTextDocumentPositionParams(document, position), token)
        const middleware = client.middleware
        return middleware.provideImplementation
          ? middleware.provideImplementation(document, position, token, provideImplementation)
          : provideImplementation(document, position, token)
      }
    }

    return [languages.registerImplementationProvider(options.documentSelector, provider), provider]
  }
}
