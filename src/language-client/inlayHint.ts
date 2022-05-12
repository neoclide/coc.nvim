/* --------------------------------------------------------------------------------------------
* Copyright (c) Microsoft Corporation. All rights reserved.
* Licensed under the MIT License. See License.txt in the project root for license information.
* ------------------------------------------------------------------------------------------ */

import {
  CancellationToken, ClientCapabilities, Disposable, DocumentSelector, Emitter, InlayHintOptions, InlayHintParams, InlayHintRefreshRequest, InlayHintRegistrationOptions, InlayHintRequest, InlayHintResolveRequest, Range, ServerCapabilities
} from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { InlayHint } from '../inlayHint'
import languages from '../languages'
import { InlayHintsProvider, ProviderResult } from '../provider'
import { BaseLanguageClient, ensure, Middleware, TextDocumentFeature } from './client'
import * as cv from './utils/converter'
const logger = require('../util/logger')('language-client-inlayHint')

export type ProvideInlayHintsSignature = (this: void, document: TextDocument, viewPort: Range, token: CancellationToken) => ProviderResult<InlayHint[]>
export type ResolveInlayHintSignature = (this: void, item: InlayHint, token: CancellationToken) => ProviderResult<InlayHint>

export interface InlayHintsMiddleware {
  provideInlayHints?: (this: void, document: TextDocument, viewPort: Range, token: CancellationToken, next: ProvideInlayHintsSignature) => ProviderResult<InlayHint[]>
  resolveInlayHint?: (this: void, item: InlayHint, token: CancellationToken, next: ResolveInlayHintSignature) => ProviderResult<InlayHint>
}

export interface InlayHintsProviderShape {
  provider: InlayHintsProvider
  onDidChangeInlayHints: Emitter<void>
}

export class InlayHintsFeature extends TextDocumentFeature<boolean | InlayHintOptions, InlayHintRegistrationOptions, InlayHintsProviderShape> {
  constructor(client: BaseLanguageClient) {
    super(client, InlayHintRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    const inlayHint = ensure(ensure(capabilities, 'textDocument')!, 'inlayHint')!
    inlayHint.dynamicRegistration = true
    inlayHint.resolveSupport = {
      properties: ['tooltip', 'textEdits', 'label.tooltip', 'label.location', 'label.command']
    }
    ensure(ensure(capabilities, 'workspace')!, 'inlayHint')!.refreshSupport = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    this._client.onRequest(InlayHintRefreshRequest.type, async () => {
      for (const provider of this.getAllProviders()) {
        provider.onDidChangeInlayHints.fire()
      }
    })

    const [id, options] = this.getRegistration(documentSelector, capabilities.inlayHintProvider)
    if (!id || !options) {
      return
    }
    this.register({ id, registerOptions: options })
  }

  protected registerLanguageProvider(options: InlayHintRegistrationOptions): [Disposable, InlayHintsProviderShape] {
    const eventEmitter: Emitter<void> = new Emitter<void>()
    const provider: InlayHintsProvider = {
      onDidChangeInlayHints: eventEmitter.event,
      provideInlayHints: (document, range, token) => {
        const client = this._client
        const provideInlayHints: ProvideInlayHintsSignature = async (document, range, token) => {
          const requestParams: InlayHintParams = {
            textDocument: cv.asTextDocumentIdentifier(document),
            range
          }
          try {
            const values = await client.sendRequest(InlayHintRequest.type, requestParams, token)
            if (token.isCancellationRequested || !values) {
              return []
            }
            return values
          } catch (error) {
            return client.handleFailedRequest(InlayHintRequest.type, token, error, [])
          }
        }
        const middleware = client.clientOptions.middleware! as Middleware & InlayHintsMiddleware
        return middleware.provideInlayHints
          ? middleware.provideInlayHints(document, range, token, provideInlayHints)
          : provideInlayHints(document, range, token)
      }
    }
    provider.resolveInlayHint = options.resolveProvider === true
      ? (hint, token) => {
        const client = this._client
        const resolveInlayHint: ResolveInlayHintSignature = async (item, token) => {
          try {
            const value = await client.sendRequest(InlayHintResolveRequest.type, item, token)
            if (token.isCancellationRequested) {
              return null
            }
            return value
          } catch (error) {
            return client.handleFailedRequest(InlayHintResolveRequest.type, token, error, null)
          }
        }
        const middleware = client.clientOptions.middleware! as Middleware & InlayHintsMiddleware
        return middleware.resolveInlayHint
          ? middleware.resolveInlayHint(hint, token, resolveInlayHint)
          : resolveInlayHint(hint, token)
      }
      : undefined
    const selector = options.documentSelector!
    return [languages.registerInlayHintsProvider(selector, provider), { provider, onDidChangeInlayHints: eventEmitter }]
  }
}
