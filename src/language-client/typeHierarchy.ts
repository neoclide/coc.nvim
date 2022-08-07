/* --------------------------------------------------------------------------------------------
* Copyright (c) Microsoft Corporation. All rights reserved.
* Licensed under the MIT License. See License.txt in the project root for license information.
* ------------------------------------------------------------------------------------------ */

import { CancellationToken, ClientCapabilities, Disposable, DocumentSelector, Position, ServerCapabilities, TypeHierarchyItem, TypeHierarchyOptions, TypeHierarchyPrepareRequest, TypeHierarchyRegistrationOptions, TypeHierarchySubtypesRequest, TypeHierarchySupertypesRequest } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import languages from '../languages'
import { ProviderResult } from '../provider'
import { BaseLanguageClient, ensure, Middleware, TextDocumentFeature } from './client'
import * as cv from './utils/converter'

export type PrepareTypeHierarchySignature = (this: void, document: TextDocument, position: Position, token: CancellationToken) => ProviderResult<TypeHierarchyItem[]>

export type TypeHierarchySupertypesSignature = (this: void, item: TypeHierarchyItem, token: CancellationToken) => ProviderResult<TypeHierarchyItem[]>

export type TypeHierarchySubtypesSignature = (this: void, item: TypeHierarchyItem, token: CancellationToken) => ProviderResult<TypeHierarchyItem[]>

/**
 * Type hierarchy middleware
 *
 * @since 3.17.0
 */
export interface TypeHierarchyMiddleware {
  prepareTypeHierarchy?: (this: void, document: TextDocument, positions: Position, token: CancellationToken, next: PrepareTypeHierarchySignature) => ProviderResult<TypeHierarchyItem[]>
  provideTypeHierarchySupertypes?: (this: void, item: TypeHierarchyItem, token: CancellationToken, next: TypeHierarchySupertypesSignature) => ProviderResult<TypeHierarchyItem[]>
  provideTypeHierarchySubtypes?: (this: void, item: TypeHierarchyItem, token: CancellationToken, next: TypeHierarchySubtypesSignature) => ProviderResult<TypeHierarchyItem[]>
}

class TypeHierarchyProvider implements TypeHierarchyProvider {
  constructor(private client: BaseLanguageClient) {}

  public prepareTypeHierarchy(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<TypeHierarchyItem[]> {
    const client = this.client
    const prepareTypeHierarchy: PrepareTypeHierarchySignature = (document, position, token) => {
      const params = cv.asTextDocumentPositionParams(document, position)
      return client.sendRequest(TypeHierarchyPrepareRequest.type, params, token).then(
        res => token.isCancellationRequested ? null : res,
        error => {
          return client.handleFailedRequest(TypeHierarchyPrepareRequest.type, token, error, null)
        })
    }
    const middleware = client.clientOptions.middleware!
    return middleware.prepareTypeHierarchy
      ? middleware.prepareTypeHierarchy(document, position, token, prepareTypeHierarchy)
      : prepareTypeHierarchy(document, position, token)
  }

  public provideTypeHierarchySupertypes(item: TypeHierarchyItem, token: CancellationToken): ProviderResult<TypeHierarchyItem[]> {
    const client = this.client
    const provideTypeHierarchySupertypes: TypeHierarchySupertypesSignature = (item, token) => {
      return client.sendRequest(TypeHierarchySupertypesRequest.type, { item }, token).then(
        res => token.isCancellationRequested ? null : res,
        error => {
          return client.handleFailedRequest(TypeHierarchySupertypesRequest.type, token, error, null)
        })
    }
    const middleware = client.clientOptions.middleware!
    return middleware.provideTypeHierarchySupertypes
      ? middleware.provideTypeHierarchySupertypes(item, token, provideTypeHierarchySupertypes)
      : provideTypeHierarchySupertypes(item, token)
  }

  public provideTypeHierarchySubtypes(item: TypeHierarchyItem, token: CancellationToken): ProviderResult<TypeHierarchyItem[]> {
    const client = this.client
    const provideTypeHierarchySubtypes: TypeHierarchySubtypesSignature = (item, token) => {
      return client.sendRequest(TypeHierarchySubtypesRequest.type, { item }, token).then(
        res => token.isCancellationRequested ? null : res,
        error => {
          return client.handleFailedRequest(TypeHierarchySubtypesRequest.type, token, error, null)
        })
    }
    const middleware = client.clientOptions.middleware!
    return middleware.provideTypeHierarchySubtypes
      ? middleware.provideTypeHierarchySubtypes(item, token, provideTypeHierarchySubtypes)
      : provideTypeHierarchySubtypes(item, token)
  }
}

export class TypeHierarchyFeature extends TextDocumentFeature<boolean | TypeHierarchyOptions, TypeHierarchyRegistrationOptions, TypeHierarchyProvider> {
  constructor(client: BaseLanguageClient) {
    super(client, TypeHierarchyPrepareRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    const capability = ensure(ensure(capabilities, 'textDocument')!, 'typeHierarchy')!
    capability.dynamicRegistration = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    const [id, options] = this.getRegistration(documentSelector, capabilities.typeHierarchyProvider)
    if (!id || !options) {
      return
    }
    this.register({ id, registerOptions: options })
  }

  protected registerLanguageProvider(options: TypeHierarchyRegistrationOptions): [Disposable, TypeHierarchyProvider] {
    const client = this._client
    const provider = new TypeHierarchyProvider(client)
    const selector = options.documentSelector!
    return [languages.registerTypeHierarchyProvider(selector, provider), provider]
  }
}
