/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

import { CancellationToken, ClientCapabilities, Color, ColorInformation, ColorPresentation, ColorPresentationRequest, ColorProviderOptions, Disposable, DocumentColorRequest, DocumentSelector, Range, ServerCapabilities, StaticRegistrationOptions, TextDocument, TextDocumentRegistrationOptions } from 'vscode-languageserver-protocol'
import Languages from '../languages'
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

export type ProvideDocumentColorsSignature = (document: TextDocument, token: CancellationToken) => ProviderResult<ColorInformation[]>

export type ProvideColorPresentationSignature = (
  color: Color,
  context: { document: TextDocument; range: Range },
  token: CancellationToken
) => ProviderResult<ColorPresentation[]>

export interface ColorProviderMiddleware {
  provideDocumentColors?: (
    this: void,
    document: TextDocument,
    token: CancellationToken,
    next: ProvideDocumentColorsSignature
  ) => ProviderResult<ColorInformation[]>
  provideColorPresentations?: (
    this: void,
    color: Color,
    context: { document: TextDocument; range: Range },
    token: CancellationToken,
    next: ProvideColorPresentationSignature
  ) => ProviderResult<ColorPresentation[]>
}

export class ColorProviderFeature extends TextDocumentFeature<
  TextDocumentRegistrationOptions
  > {
  constructor(client: BaseLanguageClient) {
    super(client, DocumentColorRequest.type)
  }

  public fillClientCapabilities(capabilites: ClientCapabilities): void {
    ensure(
      ensure(capabilites, 'textDocument')!,
      'colorProvider'
    )!.dynamicRegistration = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    if (!capabilities.colorProvider) {
      return
    }

    const implCapabilities = capabilities.colorProvider as TextDocumentRegistrationOptions &
      StaticRegistrationOptions &
      ColorProviderOptions
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
    let provideColorPresentations: ProvideColorPresentationSignature = (
      color,
      context,
      token
    ) => {
      const requestParams = {
        color,
        textDocument: {
          uri: context.document.uri
        },
        range: context.range
      }
      return client
        .sendRequest(ColorPresentationRequest.type, requestParams, token)
        .then(res => res, (error: any) => {
          client.logFailedRequest(ColorPresentationRequest.type, error)
          return Promise.resolve(null)
        })
    }
    let provideDocumentColors: ProvideDocumentColorsSignature = (
      document,
      token
    ) => {
      const requestParams = {
        textDocument: {
          uri: document.uri
        }
      }
      return client
        .sendRequest(DocumentColorRequest.type, requestParams, token)
        .then(res => res, (error: any) => {
          client.logFailedRequest(ColorPresentationRequest.type, error)
          return Promise.resolve(null)
        })
    }
    let middleware = client.clientOptions.middleware!
    return Languages.registerDocumentColorProvider(options.documentSelector!, {
      provideColorPresentations: (
        color: Color,
        context: { document: TextDocument; range: Range },
        token: CancellationToken
      ) => {
        return middleware.provideColorPresentations
          ? middleware.provideColorPresentations(
            color,
            context,
            token,
            provideColorPresentations
          )
          : provideColorPresentations(color, context, token)
      },
      provideDocumentColors: (
        document: TextDocument,
        token: CancellationToken
      ) => {
        return middleware.provideDocumentColors
          ? middleware.provideDocumentColors(
            document,
            token,
            provideDocumentColors
          )
          : provideDocumentColors(document, token)
      }
    })
  }
}
