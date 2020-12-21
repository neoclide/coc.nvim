/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken, ClientCapabilities, Definition, DefinitionLink, Disposable, DocumentSelector, ImplementationOptions, ImplementationRegistrationOptions, ImplementationRequest, Position, ServerCapabilities } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import languages from '../languages'
import { ImplementationProvider, ProviderResult } from '../provider'
import { BaseLanguageClient, TextDocumentFeature } from './client'
import * as cv from './utils/converter'

function ensure<T, K extends keyof T>(target: T, key: K): T[K] {
  if (target[key] === void 0) {
    target[key] = {} as any
  }
  return target[key]
}

export interface ProvideImplementationSignature {
  (this: void, document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Definition | DefinitionLink[]>
}

export interface ImplementationMiddleware {
  provideImplementation?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideImplementationSignature) => ProviderResult<Definition | DefinitionLink[]>
}

export class ImplementationFeature extends TextDocumentFeature<boolean | ImplementationOptions, ImplementationRegistrationOptions, ImplementationProvider> {

  constructor(client: BaseLanguageClient) {
    super(client, ImplementationRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    const implementationSupport = ensure(ensure(capabilites, 'textDocument')!, 'implementation')!
    implementationSupport.dynamicRegistration = true
    // implementationSupport.linkSupport = true
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
        const provideImplementation: ProvideImplementationSignature = (document, position, token) => client.sendRequest(ImplementationRequest.type, cv.asTextDocumentPositionParams(document, position), token).then(
          res => res, error => {
            client.logFailedRequest(ImplementationRequest.type, error)
            return Promise.resolve(null)
          }
        )
        const middleware = client.clientOptions.middleware
        return middleware.provideImplementation
          ? middleware.provideImplementation(document, position, token, provideImplementation)
          : provideImplementation(document, position, token)
      }
    }

    return [languages.registerImplementationProvider(options.documentSelector, provider), provider]
  }
}
