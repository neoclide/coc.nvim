'use strict'
import type { CancellationToken, ClientCapabilities, Definition, DefinitionLink, DefinitionOptions, DefinitionRegistrationOptions, Disposable, DocumentSelector, Position, ServerCapabilities } from 'vscode-languageserver-protocol'
import { TextDocument } from "vscode-languageserver-textdocument"
import languages from '../languages'
import { DefinitionProvider, ProviderResult } from '../provider'
import { DefinitionRequest } from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
import * as cv from './utils/converter'
import * as UUID from './utils/uuid'

export interface ProvideDefinitionSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<Definition | DefinitionLink[]>
}

export interface DefinitionMiddleware {
  provideDefinition?: (
    this: void,
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    next: ProvideDefinitionSignature
  ) => ProviderResult<Definition | DefinitionLink[]>
}

export class DefinitionFeature extends TextDocumentLanguageFeature<
  boolean | DefinitionOptions, DefinitionRegistrationOptions, DefinitionProvider, DefinitionMiddleware
> {
  constructor(client: FeatureClient<DefinitionMiddleware>) {
    super(client, DefinitionRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    let definitionSupport = ensure(ensure(capabilities, 'textDocument')!, 'definition')!
    definitionSupport.dynamicRegistration = true
    definitionSupport.linkSupport = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.definitionProvider)
    if (!options) {
      return
    }
    this.register({
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: DefinitionRegistrationOptions
  ): [Disposable, DefinitionProvider] {
    const provider: DefinitionProvider = {
      provideDefinition: (document, position, token) => {
        const client = this._client
        const provideDefinition: ProvideDefinitionSignature = (document, position, token) => {
          return this.sendRequest(
            DefinitionRequest.type,
            cv.asTextDocumentPositionParams(document, position),
            token
          )
        }
        const middleware = client.middleware!
        return middleware.provideDefinition
          ? middleware.provideDefinition(document, position, token, provideDefinition)
          : provideDefinition(document, position, token)
      }
    }

    return [languages.registerDefinitionProvider(options.documentSelector!, provider), provider]
  }
}
