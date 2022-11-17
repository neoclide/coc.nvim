'use strict'
import type { CancellationToken, ClientCapabilities, Disposable, DocumentFormattingOptions, DocumentFormattingParams, DocumentHighlightRegistrationOptions, DocumentOnTypeFormattingOptions, DocumentOnTypeFormattingParams, DocumentOnTypeFormattingRegistrationOptions, DocumentRangeFormattingOptions, DocumentRangeFormattingParams, DocumentRangeFormattingRegistrationOptions, DocumentSelector, FormattingOptions, Position, Range, ServerCapabilities, TextDocumentRegistrationOptions, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from "vscode-languageserver-textdocument"
import languages from '../languages'
import { DocumentFormattingEditProvider, DocumentRangeFormattingEditProvider, OnTypeFormattingEditProvider, ProviderResult } from '../provider'
import {
  DocumentFormattingRequest, DocumentOnTypeFormattingRequest, DocumentRangeFormattingRequest
} from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
import * as cv from './utils/converter'
import * as UUID from './utils/uuid'

export interface ProvideDocumentFormattingEditsSignature {
  (
    this: void,
    document: TextDocument,
    options: FormattingOptions,
    token: CancellationToken
  ): ProviderResult<TextEdit[]>
}

export interface ProvideDocumentRangeFormattingEditsSignature {
  (
    this: void,
    document: TextDocument,
    range: Range,
    options: FormattingOptions,
    token: CancellationToken
  ): ProviderResult<TextEdit[]>
}

export interface ProvideOnTypeFormattingEditsSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    ch: string,
    options: FormattingOptions,
    token: CancellationToken
  ): ProviderResult<TextEdit[]>
}

export interface $FormattingOptions {
  formatterPriority?: number
}

export interface FormattingMiddleware {
  provideDocumentFormattingEdits?: (
    this: void,
    document: TextDocument,
    options: FormattingOptions,
    token: CancellationToken,
    next: ProvideDocumentFormattingEditsSignature
  ) => ProviderResult<TextEdit[]>
  provideDocumentRangeFormattingEdits?: (
    this: void,
    document: TextDocument,
    range: Range,
    options: FormattingOptions,
    token: CancellationToken,
    next: ProvideDocumentRangeFormattingEditsSignature
  ) => ProviderResult<TextEdit[]>
  provideOnTypeFormattingEdits?: (
    this: void,
    document: TextDocument,
    position: Position,
    ch: string,
    options: FormattingOptions,
    token: CancellationToken,
    next: ProvideOnTypeFormattingEditsSignature
  ) => ProviderResult<TextEdit[]>
}

export class DocumentFormattingFeature extends TextDocumentLanguageFeature<
  boolean | DocumentFormattingOptions, DocumentHighlightRegistrationOptions, DocumentFormattingEditProvider, FormattingMiddleware, $FormattingOptions
> {

  constructor(client: FeatureClient<FormattingMiddleware>) {
    super(client, DocumentFormattingRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(
      ensure(capabilities, 'textDocument')!,
      'formatting'
    )!.dynamicRegistration = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.documentFormattingProvider)
    if (!options) {
      return
    }
    this.register({
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: TextDocumentRegistrationOptions
  ): [Disposable, DocumentFormattingEditProvider] {
    const provider: DocumentFormattingEditProvider = {
      provideDocumentFormattingEdits: (document, options, token) => {
        const client = this._client
        const provideDocumentFormattingEdits: ProvideDocumentFormattingEditsSignature = (document, options, token) => {
          const params: DocumentFormattingParams = {
            textDocument: { uri: document.uri },
            options
          }
          return this.sendRequest(DocumentFormattingRequest.type, params, token)
        }
        const middleware = client.middleware!
        return middleware.provideDocumentFormattingEdits
          ? middleware.provideDocumentFormattingEdits(document, options, token, provideDocumentFormattingEdits)
          : provideDocumentFormattingEdits(document, options, token)
      }
    }

    return [
      languages.registerDocumentFormatProvider(options.documentSelector!, provider, this._client.clientOptions.formatterPriority),
      provider
    ]
  }
}

export class DocumentRangeFormattingFeature extends TextDocumentLanguageFeature<
  boolean | DocumentRangeFormattingOptions, DocumentRangeFormattingRegistrationOptions, DocumentRangeFormattingEditProvider, FormattingMiddleware
> {
  constructor(client: FeatureClient<FormattingMiddleware>) {
    super(client, DocumentRangeFormattingRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(
      ensure(capabilities, 'textDocument')!,
      'rangeFormatting'
    )!.dynamicRegistration = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.documentRangeFormattingProvider)
    if (!options) {
      return
    }
    this.register({
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: TextDocumentRegistrationOptions
  ): [Disposable, DocumentRangeFormattingEditProvider] {
    const provider: DocumentRangeFormattingEditProvider = {
      provideDocumentRangeFormattingEdits: (document, range, options, token) => {
        const client = this._client
        const provideDocumentRangeFormattingEdits: ProvideDocumentRangeFormattingEditsSignature = (document, range, options, token) => {
          const params: DocumentRangeFormattingParams = {
            textDocument: { uri: document.uri },
            range,
            options,
          }
          return this.sendRequest(DocumentRangeFormattingRequest.type, params, token)
        }
        const middleware = client.middleware!
        return middleware.provideDocumentRangeFormattingEdits
          ? middleware.provideDocumentRangeFormattingEdits(document, range, options, token, provideDocumentRangeFormattingEdits)
          : provideDocumentRangeFormattingEdits(document, range, options, token)
      }
    }

    return [languages.registerDocumentRangeFormatProvider(options.documentSelector, provider), provider]
  }
}

export class DocumentOnTypeFormattingFeature extends TextDocumentLanguageFeature<
  DocumentOnTypeFormattingOptions, DocumentOnTypeFormattingRegistrationOptions, OnTypeFormattingEditProvider, FormattingMiddleware
> {

  constructor(client: FeatureClient<FormattingMiddleware>) {
    super(client, DocumentOnTypeFormattingRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(ensure(capabilities, 'textDocument')!, 'onTypeFormatting')!.dynamicRegistration = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.documentOnTypeFormattingProvider)
    if (!options) {
      return
    }
    this.register({
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(options: DocumentOnTypeFormattingRegistrationOptions): [Disposable, OnTypeFormattingEditProvider] {
    const provider: OnTypeFormattingEditProvider = {
      provideOnTypeFormattingEdits: (document, position, ch, options, token) => {
        const client = this._client
        const provideOnTypeFormattingEdits: ProvideOnTypeFormattingEditsSignature = (document, position, ch, options, token) => {
          const params: DocumentOnTypeFormattingParams = {
            textDocument: cv.asVersionedTextDocumentIdentifier(document),
            position,
            ch,
            options
          }
          return this.sendRequest(DocumentOnTypeFormattingRequest.type, params, token)
        }
        const middleware = client.middleware!
        return middleware.provideOnTypeFormattingEdits
          ? middleware.provideOnTypeFormattingEdits(document, position, ch, options, token, provideOnTypeFormattingEdits)
          : provideOnTypeFormattingEdits(document, position, ch, options, token)
      }
    }

    const moreTriggerCharacter = options.moreTriggerCharacter || []
    const characters = [options.firstTriggerCharacter, ...moreTriggerCharacter]
    return [languages.registerOnTypeFormattingEditProvider(options.documentSelector!, provider, characters), provider]
  }
}
