/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

import * as Is from '../util/is'
import * as UUID from './utils/uuid'
import languages from '../languages'
import { Declaration, ClientCapabilities, Disposable, CancellationToken, ServerCapabilities, TextDocumentRegistrationOptions, DocumentSelector, DeclarationRequest, TextDocument, Position } from 'vscode-languageserver-protocol'
import { asTextDocumentPositionParams } from './utils/converter'

import { TextDocumentFeature, BaseLanguageClient } from './client'
import { ProviderResult } from '../provider'

function ensure<T, K extends keyof T>(target: T, key: K): T[K] {
  if (target[key] === void 0) {
    target[key] = {} as any
  }
  return target[key]
}

export interface ProvideDeclarationSignature {
  (document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Declaration>
}

export interface DeclarationMiddleware {
  provideDeclaration?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideDeclarationSignature) => ProviderResult<Declaration>
}

export class DeclarationFeature extends TextDocumentFeature<TextDocumentRegistrationOptions> {

  constructor(client: BaseLanguageClient) {
    super(client, DeclarationRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    let declarationSupport = ensure(ensure(capabilites, 'textDocument')!, 'declaration')!
    declarationSupport.dynamicRegistration = true
    // declarationSupport.linkSupport = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    if (!capabilities.declarationProvider) {
      return
    }
    if (capabilities.declarationProvider === true) {
      if (!documentSelector) {
        return
      }
      this.register(this.messages, {
        id: UUID.generateUuid(),
        registerOptions: Object.assign({}, { documentSelector })
      })
    } else {
      const declCapabilities = capabilities.declarationProvider
      const id = Is.string(declCapabilities.id) && declCapabilities.id.length > 0 ? declCapabilities.id : UUID.generateUuid()
      const selector = declCapabilities.documentSelector || documentSelector
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
    let provideDeclaration: ProvideDeclarationSignature = (document, position, token) => {
      return client.sendRequest(DeclarationRequest.type, asTextDocumentPositionParams(document, position), token).then(
        res => res, error => {
          client.logFailedRequest(DeclarationRequest.type, error)
          return Promise.resolve(null)
        }
      )
    }
    let middleware = client.clientOptions.middleware!
    return languages.registerDeclarationProvider(options.documentSelector!, {
      provideDeclaration: (document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Declaration> => {
        return middleware.provideDeclaration
          ? middleware.provideDeclaration(document, position, token, provideDeclaration)
          : provideDeclaration(document, position, token)
      }
    })
  }
}
