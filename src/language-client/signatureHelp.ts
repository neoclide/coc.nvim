'use strict'
import type { CancellationToken, ClientCapabilities, Disposable, DocumentSelector, Position, ServerCapabilities, SignatureHelp, SignatureHelpContext, SignatureHelpOptions, SignatureHelpRegistrationOptions } from 'vscode-languageserver-protocol'
import { TextDocument } from "vscode-languageserver-textdocument"
import languages from '../languages'
import { ProviderResult, SignatureHelpProvider } from '../provider'
import { SignatureHelpRequest } from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
import * as cv from './utils/converter'
import * as UUID from './utils/uuid'

export interface ProvideSignatureHelpSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    context: SignatureHelpContext,
    token: CancellationToken
  ): ProviderResult<SignatureHelp>
}

export interface SignatureHelpMiddleware {
  provideSignatureHelp?: (
    this: void,
    document: TextDocument,
    position: Position,
    context: SignatureHelpContext,
    token: CancellationToken,
    next: ProvideSignatureHelpSignature
  ) => ProviderResult<SignatureHelp>
}

export class SignatureHelpFeature extends TextDocumentLanguageFeature<SignatureHelpOptions, SignatureHelpRegistrationOptions, SignatureHelpProvider, SignatureHelpMiddleware> {
  constructor(client: FeatureClient<SignatureHelpMiddleware>) {
    super(client, SignatureHelpRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    let config = ensure(ensure(capabilities, 'textDocument')!, 'signatureHelp')!
    config.dynamicRegistration = true
    config.contextSupport = true
    config.signatureInformation = {
      documentationFormat: this._client.supportedMarkupKind,
      activeParameterSupport: true,
      parameterInformation: {
        labelOffsetSupport: true
      }
    }
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.signatureHelpProvider)
    if (!options) return

    this.register({
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: SignatureHelpRegistrationOptions
  ): [Disposable, SignatureHelpProvider] {
    const provider: SignatureHelpProvider = {
      provideSignatureHelp: (document, position, token, context) => {
        const client = this._client
        const providerSignatureHelp: ProvideSignatureHelpSignature = (document, position, context, token) => {
          return this.sendRequest(
            SignatureHelpRequest.type,
            cv.asSignatureHelpParams(document, position, context),
            token
          )
        }
        const middleware = client.middleware!
        return middleware.provideSignatureHelp
          ? middleware.provideSignatureHelp(document, position, context, token, providerSignatureHelp)
          : providerSignatureHelp(document, position, context, token)
      }
    }

    const disposable = languages.registerSignatureHelpProvider(options.documentSelector!, provider, options.triggerCharacters)
    return [disposable, provider]
  }
}
