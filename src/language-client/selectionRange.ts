/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

import { SelectionRange, SelectionRangeRequest, SelectionRangeParams, SelectionRangeClientCapabilities, SelectionRangeServerCapabilities, CancellationToken, ClientCapabilities, Disposable, DocumentSelector, Position, ServerCapabilities, StaticRegistrationOptions, TextDocument, TextDocumentRegistrationOptions } from 'vscode-languageserver-protocol'
import languages from '../languages'
import { ProviderResult } from '../provider'
import * as Is from '../util/is'
import { BaseLanguageClient, TextDocumentFeature } from './client'
import * as UUID from './utils/uuid'

function ensure<T, K extends keyof T>(target: T, key: K): T[K] {
  if (target[key] === void 0) {
    target[key] = {} as any
  }
  return target[key]
}

export interface SelectionRangeProviderMiddleware {
  provideSelectionRanges?: (this: void, document: TextDocument, positions: Position[], token: CancellationToken, next: ProvideSelectionRangeSignature) => ProviderResult<SelectionRange[]>
}

export interface ProvideSelectionRangeSignature {
  (document: TextDocument, positions: Position[], token: CancellationToken): ProviderResult<SelectionRange[]>
}

export class SelectionRangeFeature extends TextDocumentFeature<TextDocumentRegistrationOptions> {
  constructor(client: BaseLanguageClient) {
    super(client, SelectionRangeRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities & SelectionRangeClientCapabilities): void {
    let capability = ensure(ensure(capabilites, 'textDocument')!, 'selectionRange')!
    capability.dynamicRegistration = true
  }

  public initialize(capabilities: ServerCapabilities & SelectionRangeServerCapabilities, documentSelector: DocumentSelector): void {
    if (!capabilities.selectionRangeProvider) {
      return
    }

    const implCapabilities = capabilities.selectionRangeProvider as TextDocumentRegistrationOptions & StaticRegistrationOptions
    const id = Is.string(implCapabilities.id) && implCapabilities.id.length > 0 ? implCapabilities.id : UUID.generateUuid()
    const selector = implCapabilities.documentSelector || documentSelector
    if (selector) {
      this.register(this.messages, {
        id,
        registerOptions: Object.assign({}, { documentSelector: selector })
      })
    }
  }

  protected registerLanguageProvider(options: TextDocumentRegistrationOptions): Disposable {
    let client = this._client
    let provideSelectionRanges: ProvideSelectionRangeSignature = (document, positions, token) => {
      const requestParams: SelectionRangeParams = {
        textDocument: { uri: document.uri },
        positions
      }

      return client.sendRequest(SelectionRangeRequest.type, requestParams, token).then(
        ranges => ranges,
        (error: any) => {
          client.logFailedRequest(SelectionRangeRequest.type, error)
          return Promise.resolve(null)
        }
      )
    }
    let middleware = client.clientOptions.middleware!
    return languages.registerSelectionRangeProvider(options.documentSelector!, {
      provideSelectionRanges(document: TextDocument, positions: Position[], token: CancellationToken): ProviderResult<SelectionRange[]> {
        return middleware.provideSelectionRanges
          ? middleware.provideSelectionRanges(document, positions, token, provideSelectionRanges)
          : provideSelectionRanges(document, positions, token)

      }
    })
  }
}
