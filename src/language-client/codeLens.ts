'use strict'
/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import {
  ClientCapabilities, CancellationToken, CodeLens, ServerCapabilities, DocumentSelector, CodeLensOptions, CodeLensRegistrationOptions, CodeLensRequest, CodeLensRefreshRequest, CodeLensResolveRequest, Emitter, Disposable
} from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import * as UUID from './utils/uuid'
import { TextDocumentLanguageFeature, FeatureClient, ensure } from './features'
import { CodeLensProvider, ProviderResult } from '../provider'
import * as cv from './utils/converter'
import languages from '../languages'

export interface ProvideCodeLensesSignature {
  (this: void, document: TextDocument, token: CancellationToken): ProviderResult<CodeLens[]>
}

export interface ResolveCodeLensSignature {
  (this: void, codeLens: CodeLens, token: CancellationToken): ProviderResult<CodeLens>
}

export interface CodeLensMiddleware {
  provideCodeLenses?: (this: void, document: TextDocument, token: CancellationToken, next: ProvideCodeLensesSignature) => ProviderResult<CodeLens[]>
  resolveCodeLens?: (this: void, codeLens: CodeLens, token: CancellationToken, next: ResolveCodeLensSignature) => ProviderResult<CodeLens>
}

export interface CodeLensProviderShape {
  provider?: CodeLensProvider
  onDidChangeCodeLensEmitter: Emitter<void>
}

export class CodeLensFeature extends TextDocumentLanguageFeature<CodeLensOptions, CodeLensRegistrationOptions, CodeLensProviderShape, CodeLensMiddleware> {

  constructor(client: FeatureClient<CodeLensMiddleware>) {
    super(client, CodeLensRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(ensure(capabilities, 'textDocument')!, 'codeLens')!.dynamicRegistration = true
    ensure(ensure(capabilities, 'workspace')!, 'codeLens')!.refreshSupport = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    const client = this._client
    client.onRequest(CodeLensRefreshRequest.type, async () => {
      for (const provider of this.getAllProviders()) {
        provider.onDidChangeCodeLensEmitter.fire()
      }
    })
    const options = this.getRegistrationOptions(documentSelector, capabilities.codeLensProvider)
    if (!options) {
      return
    }
    this.register({ id: UUID.generateUuid(), registerOptions: options })
  }

  protected registerLanguageProvider(options: CodeLensRegistrationOptions): [Disposable, CodeLensProviderShape] {
    const emitter: Emitter<void> = new Emitter<void>()
    const provider: CodeLensProvider = {
      onDidChangeCodeLenses: emitter.event,
      provideCodeLenses: (document, token) => {
        const client = this._client
        const provideCodeLenses: ProvideCodeLensesSignature = (document, token) => {
          return client.sendRequest(
            CodeLensRequest.type,
            cv.asCodeLensParams(document),
            token
          ).then(
            res => token.isCancellationRequested ? null : res,
            error => {
              return client.handleFailedRequest(CodeLensRequest.type, token, error, null)
            })
        }
        const middleware = client.middleware!
        return middleware.provideCodeLenses
          ? middleware.provideCodeLenses(document, token, provideCodeLenses)
          : provideCodeLenses(document, token)
      },
      resolveCodeLens: (options.resolveProvider)
        ? (codeLens: CodeLens, token: CancellationToken): ProviderResult<CodeLens> => {
          const client = this._client
          const resolveCodeLens: ResolveCodeLensSignature = (codeLens, token) => {
            return client.sendRequest(
              CodeLensResolveRequest.type,
              codeLens,
              token
            ).then(
              res => token.isCancellationRequested ? codeLens : res,
              error => {
                return client.handleFailedRequest(CodeLensResolveRequest.type, token, error, codeLens)
              })
          }
          const middleware = client.middleware!
          return middleware.resolveCodeLens
            ? middleware.resolveCodeLens(codeLens, token, resolveCodeLens)
            : resolveCodeLens(codeLens, token)
        }
        : undefined
    }

    return [languages.registerCodeLensProvider(options.documentSelector, provider), { provider, onDidChangeCodeLensEmitter: emitter }]
  }
}
