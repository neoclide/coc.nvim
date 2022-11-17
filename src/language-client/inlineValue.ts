'use strict'
import type { CancellationToken, ClientCapabilities, Disposable, DocumentSelector, InlineValue, InlineValueContext, InlineValueOptions, InlineValueParams, InlineValueRegistrationOptions, Range, ServerCapabilities } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import languages from '../languages'
import { InlineValuesProvider, ProviderResult } from '../provider'
import { Emitter, InlineValueRefreshRequest, InlineValueRequest } from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
import * as cv from './utils/converter'

export type ProvideInlineValuesSignature = (this: void, document: TextDocument, viewPort: Range, context: InlineValueContext, token: CancellationToken) => ProviderResult<InlineValue[]>

export interface InlineValueMiddleware {
  provideInlineValues?: (this: void, document: TextDocument, viewPort: Range, context: InlineValueContext, token: CancellationToken, next: ProvideInlineValuesSignature) => ProviderResult<InlineValue[]>
}

export interface InlineValueProviderShape {
  provider: InlineValuesProvider
  onDidChangeInlineValues: Emitter<void>
}

export class InlineValueFeature extends TextDocumentLanguageFeature<
  boolean | InlineValueOptions, InlineValueRegistrationOptions, InlineValueProviderShape, InlineValueMiddleware
> {
  constructor(client: FeatureClient<InlineValueMiddleware>) {
    super(client, InlineValueRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(ensure(capabilities, 'textDocument')!, 'inlineValue')!.dynamicRegistration = true
    ensure(ensure(capabilities, 'workspace')!, 'inlineValue')!.refreshSupport = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    this._client.onRequest(InlineValueRefreshRequest.type, async () => {
      for (const provider of this.getAllProviders()) {
        provider.onDidChangeInlineValues.fire()
      }
    })

    const [id, options] = this.getRegistration(documentSelector, capabilities.inlineValueProvider)
    if (!id || !options) {
      return
    }
    this.register({ id, registerOptions: options })
  }

  protected registerLanguageProvider(options: InlineValueRegistrationOptions): [Disposable, InlineValueProviderShape] {
    const eventEmitter: Emitter<void> = new Emitter<void>()
    const provider: InlineValuesProvider = {
      onDidChangeInlineValues: eventEmitter.event,
      provideInlineValues: (document, viewPort, context, token) => {
        const client = this._client
        const provideInlineValues: ProvideInlineValuesSignature = (document, range, context, token) => {
          const requestParams: InlineValueParams = {
            textDocument: cv.asTextDocumentIdentifier(document),
            range,
            context
          }
          return this.sendRequest(InlineValueRequest.type, requestParams, token)
        }
        const middleware = client.middleware!
        return middleware.provideInlineValues
          ? middleware.provideInlineValues(document, viewPort, context, token, provideInlineValues)
          : provideInlineValues(document, viewPort, context, token)

      }
    }
    const selector = options.documentSelector!
    return [languages.registerInlineValuesProvider(selector, provider), { provider, onDidChangeInlineValues: eventEmitter }]
  }
}
