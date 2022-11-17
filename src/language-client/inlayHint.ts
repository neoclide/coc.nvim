'use strict'
import type {
  CancellationToken, ClientCapabilities, Disposable, DocumentSelector, InlayHint, InlayHintOptions, InlayHintParams, InlayHintRegistrationOptions, Range, ServerCapabilities
} from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import languages from '../languages'
import { InlayHintsProvider, ProviderResult } from '../provider'
import { Emitter, InlayHintRefreshRequest, InlayHintRequest, InlayHintResolveRequest } from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
import * as cv from './utils/converter'

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

export class InlayHintsFeature extends TextDocumentLanguageFeature<
  boolean | InlayHintOptions, InlayHintRegistrationOptions, InlayHintsProviderShape, InlayHintsMiddleware
> {
  constructor(client: FeatureClient<InlayHintsMiddleware>) {
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
        const provideInlayHints: ProvideInlayHintsSignature = (document, range, token) => {
          const requestParams: InlayHintParams = {
            textDocument: cv.asTextDocumentIdentifier(document),
            range
          }
          return this.sendRequest(InlayHintRequest.type, requestParams, token, null)
        }
        const middleware = client.middleware!
        return middleware.provideInlayHints
          ? middleware.provideInlayHints(document, range, token, provideInlayHints)
          : provideInlayHints(document, range, token)
      }
    }
    provider.resolveInlayHint = options.resolveProvider === true
      ? (hint, token) => {
        const client = this._client
        const resolveInlayHint: ResolveInlayHintSignature = (item, token) => {
          return this.sendRequest(InlayHintResolveRequest.type, item, token)
        }
        const middleware = client.middleware!
        return middleware.resolveInlayHint
          ? middleware.resolveInlayHint(hint, token, resolveInlayHint)
          : resolveInlayHint(hint, token)
      }
      : undefined
    const selector = options.documentSelector!
    return [languages.registerInlayHintsProvider(selector, provider), { provider, onDidChangeInlayHints: eventEmitter }]
  }
}
