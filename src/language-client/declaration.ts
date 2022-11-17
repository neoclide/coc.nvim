'use strict'
import type { CancellationToken, ClientCapabilities, Declaration, DeclarationLink, DeclarationOptions, DeclarationRegistrationOptions, Disposable, DocumentSelector, Position, ServerCapabilities } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import languages from '../languages'
import { DeclarationProvider, ProviderResult } from '../provider'
import { DeclarationRequest } from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
import { asTextDocumentPositionParams } from './utils/converter'

export interface ProvideDeclarationSignature {
  (this: void, document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Declaration | DeclarationLink[]>
}

export interface DeclarationMiddleware {
  provideDeclaration?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideDeclarationSignature) => ProviderResult<Declaration | DeclarationLink[]>
}

export class DeclarationFeature extends TextDocumentLanguageFeature<boolean | DeclarationOptions, DeclarationRegistrationOptions, DeclarationProvider, DeclarationMiddleware> {

  constructor(client: FeatureClient<DeclarationMiddleware>) {
    super(client, DeclarationRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    let declarationSupport = ensure(ensure(capabilities, 'textDocument')!, 'declaration')!
    declarationSupport.dynamicRegistration = true
    declarationSupport.linkSupport = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    const [id, options] = this.getRegistration(documentSelector, capabilities.declarationProvider)
    if (!id || !options) {
      return
    }
    this.register({ id, registerOptions: options })
  }

  protected registerLanguageProvider(options: DeclarationRegistrationOptions): [Disposable, DeclarationProvider] {
    const provider: DeclarationProvider = {
      provideDeclaration: (document: TextDocument, position: Position, token: CancellationToken) => {
        const client = this._client
        const provideDeclaration: ProvideDeclarationSignature = (document, position, token) =>
          this.sendRequest(DeclarationRequest.type, asTextDocumentPositionParams(document, position), token)
        const middleware = client.middleware
        return middleware.provideDeclaration ? middleware.provideDeclaration(document, position, token, provideDeclaration)
          : provideDeclaration(document, position, token)
      }
    }

    return [languages.registerDeclarationProvider(options.documentSelector, provider), provider]
  }
}
