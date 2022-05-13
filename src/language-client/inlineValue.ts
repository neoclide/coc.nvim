/* --------------------------------------------------------------------------------------------
* Copyright (c) Microsoft Corporation. All rights reserved.
* Licensed under the MIT License. See License.txt in the project root for license information.
* ------------------------------------------------------------------------------------------ */

import { CancellationToken, ClientCapabilities, Disposable, DocumentSelector, Emitter, InlineValue, InlineValueContext, InlineValueOptions, InlineValueParams, InlineValueRefreshRequest, InlineValueRegistrationOptions, InlineValueRequest, Range, ServerCapabilities } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import languages from '../languages'
import { InlineValuesProvider, ProviderResult } from '../provider'
import { BaseLanguageClient, ensure, Middleware, TextDocumentFeature } from './client'
import * as cv from './utils/converter'

export type ProvideInlineValuesSignature = (this: void, document: TextDocument, viewPort: Range, context: InlineValueContext, token: CancellationToken) => ProviderResult<InlineValue[]>

export interface InlineValueMiddleware {
  provideInlineValues?: (this: void, document: TextDocument, viewPort: Range, context: InlineValueContext, token: CancellationToken, next: ProvideInlineValuesSignature) => ProviderResult<InlineValue[]>
}

export interface InlineValueProviderShape {
  provider: InlineValuesProvider
  onDidChangeInlineValues: Emitter<void>
}

export class InlineValueFeature extends TextDocumentFeature<boolean | InlineValueOptions, InlineValueRegistrationOptions, InlineValueProviderShape> {
  constructor(client: BaseLanguageClient) {
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
          return client.sendRequest(InlineValueRequest.type, requestParams, token).then(values => {
            if (token.isCancellationRequested) {
              return null
            }
            return values
          }, (error: any) => {
              return client.handleFailedRequest(InlineValueRequest.type, token, error, null)
            })
        }
        const middleware = client.clientOptions.middleware!
        return middleware.provideInlineValues
          ? middleware.provideInlineValues(document, viewPort, context, token, provideInlineValues)
          : provideInlineValues(document, viewPort, context, token)

      }
    }
    const selector = options.documentSelector!
    return [languages.registerInlineValuesProvider(selector, provider), { provider, onDidChangeInlineValues: eventEmitter }]
  }
}
