'use strict'
import { Emitter, FoldingRangeRefreshRequest, type CancellationToken, type ClientCapabilities, type Disposable, type DocumentSelector, type FoldingRange, type FoldingRangeOptions, type FoldingRangeParams, type FoldingRangeRegistrationOptions, type ServerCapabilities } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import languages from '../languages'
import { FoldingContext, FoldingRangeProvider, ProviderResult } from '../provider'
import { FoldingRangeKind, FoldingRangeRequest } from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'

export type ProvideFoldingRangeSignature = (
  this: void,
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

export interface FoldingRangeProviderShape {
  provider: FoldingRangeProvider;
  onDidChangeFoldingRange: Emitter<void>;
}

export class FoldingRangeFeature extends TextDocumentLanguageFeature<
  boolean | FoldingRangeOptions, FoldingRangeRegistrationOptions, FoldingRangeProviderShape, FoldingRangeProviderMiddleware
> {
  constructor(client: FeatureClient<FoldingRangeProviderMiddleware>) {
    super(client, FoldingRangeRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    let capability = ensure(ensure(capabilities, 'textDocument')!, 'foldingRange')!
    capability.dynamicRegistration = true
    capability.rangeLimit = 5000
    capability.lineFoldingOnly = true
    capability.foldingRangeKind = { valueSet: [FoldingRangeKind.Comment, FoldingRangeKind.Imports, FoldingRangeKind.Region] }
    capability.foldingRange = { collapsedText: false }
    ensure(ensure(capabilities, 'workspace')!, 'foldingRange')!.refreshSupport = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    this._client.onRequest(FoldingRangeRefreshRequest.type, async () => {
      for (const provider of this.getAllProviders()) {
        provider.onDidChangeFoldingRange.fire()
      }
    })

    const [id, options] = this.getRegistration(documentSelector, capabilities.foldingRangeProvider)
    if (!id || !options) {
      return
    }
    this.register({ id, registerOptions: options })
  }

  protected registerLanguageProvider(
    options: FoldingRangeRegistrationOptions
  ): [Disposable, FoldingRangeProviderShape] {
    const eventEmitter: Emitter<void> = new Emitter<void>()
    const provider: FoldingRangeProvider = {
      onDidChangeFoldingRanges: eventEmitter.event,
      provideFoldingRanges: (document, context, token) => {
        const client = this._client
        const provideFoldingRanges: ProvideFoldingRangeSignature = (document, _, token) => {
          const requestParams: FoldingRangeParams = {
            textDocument: client.code2ProtocolConverter.asTextDocumentIdentifier(document)
          }
          return this.sendRequest(FoldingRangeRequest.type, requestParams, token)
        }
        const middleware = client.middleware
        return middleware.provideFoldingRanges
          ? middleware.provideFoldingRanges(document, context, token, provideFoldingRanges)
          : provideFoldingRanges(document, context, token)
      }
    }

    this._client.attachExtensionName(provider)
    return [languages.registerFoldingRangeProvider(options.documentSelector, provider), { provider, onDidChangeFoldingRange: eventEmitter }]
  }
}
