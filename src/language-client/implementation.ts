/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken, ClientCapabilities, Definition, Disposable, DocumentSelector, ImplementationRequest, Position, ServerCapabilities, TextDocument, TextDocumentRegistrationOptions } from 'vscode-languageserver-protocol'
import languages from '../languages'
import { ProviderResult } from '../provider'
import * as Is from '../util/is'
import { BaseLanguageClient, TextDocumentFeature } from './client'
import * as UUID from './utils/uuid'
import * as cv from './utils/converter'

function ensure<T, K extends keyof T>(target: T, key: K): T[K] {
  if (target[key] === void 0) {
    target[key] = {} as any
  }
  return target[key]
}

export interface ProvideImplementationSignature {
  (document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Definition> // tslint:disable-line
}

export interface ImplementationMiddleware {
  provideImplementation?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideImplementationSignature) => ProviderResult<Definition>
}

export class ImplementationFeature extends TextDocumentFeature<TextDocumentRegistrationOptions> {

  constructor(client: BaseLanguageClient) {
    super(client, ImplementationRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    ensure(ensure(capabilites, 'textDocument')!, 'implementation')!.dynamicRegistration = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    if (!capabilities.implementationProvider) {
      return
    }
    if (capabilities.implementationProvider === true) {
      if (!documentSelector) {
        return
      }
      this.register(this.messages, {
        id: UUID.generateUuid(),
        registerOptions: Object.assign({}, { documentSelector })
      })
    } else {
      const implCapabilities = capabilities.implementationProvider
      const id = Is.string(implCapabilities.id) && implCapabilities.id.length > 0 ? implCapabilities.id : UUID.generateUuid()
      const selector = implCapabilities.documentSelector || documentSelector
      if (selector) {
        this.register(this.messages, {
          id,
          registerOptions: Object.assign({}, { documentSelector: selector })
        })
      }
    }
  }

  protected registerLanguageProvider(options: TextDocumentRegistrationOptions): Disposable {
    let client = this._client
    let provideImplementation: ProvideImplementationSignature = (document, position, token) => {
      return client.sendRequest(ImplementationRequest.type, cv.asTextDocumentPositionParams(document, position), token)
        .then(res => res, error => {
          client.logFailedRequest(ImplementationRequest.type, error)
          return Promise.resolve(null)
        }
        )
    }
    let middleware = client.clientOptions.middleware!
    return languages.registerImplementationProvider(
      options.documentSelector, {
        provideImplementation: (document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Definition> => {
          return middleware.provideImplementation
            ? middleware.provideImplementation(document, position, token, provideImplementation)
            : provideImplementation(document, position, token)
        }
      })
  }
}
