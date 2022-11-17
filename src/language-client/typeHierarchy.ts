'use strict'
import type { CancellationToken, ClientCapabilities, Disposable, DocumentSelector, Position, ServerCapabilities, TypeHierarchyItem, TypeHierarchyOptions, TypeHierarchyRegistrationOptions } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import languages from '../languages'
import { ProviderResult, TypeHierarchyProvider } from '../provider'
import { TypeHierarchyPrepareRequest, TypeHierarchySubtypesRequest, TypeHierarchySupertypesRequest } from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
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

export class TypeHierarchyFeature extends TextDocumentLanguageFeature<boolean | TypeHierarchyOptions, TypeHierarchyRegistrationOptions, TypeHierarchyProvider, TypeHierarchyMiddleware> {
  constructor(client: FeatureClient<TypeHierarchyMiddleware>) {
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
    const selector = options.documentSelector!
    const provider = {
      prepareTypeHierarchy: (document: TextDocument, position: Position, token: CancellationToken): ProviderResult<TypeHierarchyItem[]> => {
        const prepareTypeHierarchy: PrepareTypeHierarchySignature = (document, position, token) => {
          const params = cv.asTextDocumentPositionParams(document, position)
          return this.sendRequest(TypeHierarchyPrepareRequest.type, params, token)
        }
        const middleware = client.middleware!
        return middleware.prepareTypeHierarchy
          ? middleware.prepareTypeHierarchy(document, position, token, prepareTypeHierarchy)
          : prepareTypeHierarchy(document, position, token)
      },
      provideTypeHierarchySupertypes: (item: TypeHierarchyItem, token: CancellationToken): ProviderResult<TypeHierarchyItem[]> => {
        const provideTypeHierarchySupertypes: TypeHierarchySupertypesSignature = (item, token) => {
          return this.sendRequest(TypeHierarchySupertypesRequest.type, { item }, token)
        }
        const middleware = client.middleware!
        return middleware.provideTypeHierarchySupertypes
          ? middleware.provideTypeHierarchySupertypes(item, token, provideTypeHierarchySupertypes)
          : provideTypeHierarchySupertypes(item, token)
      },
      provideTypeHierarchySubtypes: (item: TypeHierarchyItem, token: CancellationToken): ProviderResult<TypeHierarchyItem[]> => {
        const provideTypeHierarchySubtypes: TypeHierarchySubtypesSignature = (item, token) => {
          return this.sendRequest(TypeHierarchySubtypesRequest.type, { item }, token)
        }
        const middleware = client.middleware!
        return middleware.provideTypeHierarchySubtypes
          ? middleware.provideTypeHierarchySubtypes(item, token, provideTypeHierarchySubtypes)
          : provideTypeHierarchySubtypes(item, token)
      }
    }
    return [languages.registerTypeHierarchyProvider(selector, provider), provider]
  }
}
