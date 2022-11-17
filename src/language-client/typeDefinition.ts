'use strict'
import type { ClientCapabilities, Definition, DefinitionLink, Disposable, DocumentSelector, Position, ServerCapabilities, TypeDefinitionOptions, TypeDefinitionRegistrationOptions } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import languages from '../languages'
import { ProviderResult, TypeDefinitionProvider } from '../provider'
import { CancellationToken, TypeDefinitionRequest } from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
import * as cv from './utils/converter'

export interface ProvideTypeDefinitionSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<Definition | DefinitionLink[]>
}

export interface TypeDefinitionMiddleware {
  provideTypeDefinition?: (
    this: void,
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    next: ProvideTypeDefinitionSignature
  ) => ProviderResult<Definition | DefinitionLink[]>
}

export class TypeDefinitionFeature extends TextDocumentLanguageFeature<boolean | TypeDefinitionOptions, TypeDefinitionRegistrationOptions, TypeDefinitionProvider, TypeDefinitionMiddleware> {
  constructor(client: FeatureClient<TypeDefinitionMiddleware>) {
    super(client, TypeDefinitionRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    const typeDefinitionSupport = ensure(ensure(capabilities, 'textDocument')!, 'typeDefinition')!
    typeDefinitionSupport.dynamicRegistration = true
    typeDefinitionSupport.linkSupport = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    const [id, options] = this.getRegistration(documentSelector, capabilities.typeDefinitionProvider)
    if (!id || !options) {
      return
    }
    this.register({ id, registerOptions: options })
  }

  protected registerLanguageProvider(options: TypeDefinitionRegistrationOptions): [Disposable, TypeDefinitionProvider] {
    const provider: TypeDefinitionProvider = {
      provideTypeDefinition: (document, position, token) => {
        const client = this._client
        const provideTypeDefinition: ProvideTypeDefinitionSignature = (document, position, token) =>
          this.sendRequest(TypeDefinitionRequest.type, cv.asTextDocumentPositionParams(document, position), token)
        const middleware = client.middleware
        return middleware.provideTypeDefinition
          ? middleware.provideTypeDefinition(document, position, token, provideTypeDefinition)
          : provideTypeDefinition(document, position, token)
      }
    }
    return [languages.registerTypeDefinitionProvider(options.documentSelector, provider), provider]
  }
}
