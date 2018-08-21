/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

import { CancellationToken, ClientCapabilities, Disposable, DocumentSelector, FoldingRange, FoldingRangeProviderOptions, FoldingRangeRequest, FoldingRangeRequestParam, ServerCapabilities, StaticRegistrationOptions, TextDocument, TextDocumentRegistrationOptions } from 'vscode-languageserver-protocol'
import languages from '../languages'
import { FoldingContext, ProviderResult } from '../provider'
import * as Is from '../util/is'
import { BaseLanguageClient, TextDocumentFeature } from './client'
import * as UUID from './utils/uuid'

function ensure<T, K extends keyof T>(target: T, key: K): T[K] {
  if (target[key] === void 0) {
    target[key] = {} as any
  }
  return target[key]
}

export type ProvideFoldingRangeSignature = (
  document: TextDocument,
  context: FoldingContext,
  token: CancellationToken
) => ProviderResult<FoldingRange[]>

export interface FoldingRangeProviderMiddleware {
  provideFoldingRanges?: (
    this: void,
    document: TextDocument,
    context: FoldingContext,
    token: CancellationToken,
    next: ProvideFoldingRangeSignature
  ) => ProviderResult<FoldingRange[]>
}

export class FoldingRangeFeature extends TextDocumentFeature<
  TextDocumentRegistrationOptions
  > {
  constructor(client: BaseLanguageClient) {
    super(client, FoldingRangeRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    let capability = ensure(
      ensure(capabilites, 'textDocument')!,
      'foldingRange'
    )!
    capability.dynamicRegistration = true
    capability.rangeLimit = 5000
    capability.lineFoldingOnly = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    if (!capabilities.foldingRangeProvider) {
      return
    }

    const implCapabilities = capabilities.foldingRangeProvider as TextDocumentRegistrationOptions &
      StaticRegistrationOptions &
      FoldingRangeProviderOptions
    const id =
      Is.string(implCapabilities.id) && implCapabilities.id.length > 0
        ? implCapabilities.id
        : UUID.generateUuid()
    const selector = implCapabilities.documentSelector || documentSelector
    if (selector) {
      this.register(this.messages, {
        id,
        registerOptions: Object.assign({}, { documentSelector: selector })
      })
    }
  }

  protected registerLanguageProvider(
    options: TextDocumentRegistrationOptions
  ): Disposable {
    let client = this._client
    let provideFoldingRanges: ProvideFoldingRangeSignature = (
      document,
      _,
      token
    ) => {
      const requestParams: FoldingRangeRequestParam = {
        textDocument: {
          uri: document.uri
        }
      }
      return client
        .sendRequest(FoldingRangeRequest.type, requestParams, token)
        .then(res => res, (error: any) => {
          client.logFailedRequest(FoldingRangeRequest.type, error)
          return Promise.resolve(null)
        })
    }
    let middleware = client.clientOptions.middleware!
    return languages.registerFoldingRangeProvider(options.documentSelector!, {
      provideFoldingRanges(
        document: TextDocument,
        context: FoldingContext,
        token: CancellationToken
      ): ProviderResult<FoldingRange[]> {
        return middleware.provideFoldingRanges
          ? middleware.provideFoldingRanges(
            document,
            context,
            token,
            provideFoldingRanges
          )
          : provideFoldingRanges(document, context, token)
      }
    })
  }
}
