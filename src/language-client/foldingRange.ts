'use strict'
import type { CancellationToken, ClientCapabilities, Disposable, DocumentSelector, FoldingRange, FoldingRangeOptions, FoldingRangeParams, FoldingRangeRegistrationOptions, ServerCapabilities } from 'vscode-languageserver-protocol'
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

export class FoldingRangeFeature extends TextDocumentLanguageFeature<
  boolean | FoldingRangeOptions, FoldingRangeRegistrationOptions, FoldingRangeProvider, FoldingRangeProviderMiddleware
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
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const [id, options] = this.getRegistration(documentSelector, capabilities.foldingRangeProvider)
    if (!id || !options) {
      return
    }
    this.register({ id, registerOptions: options })
  }

  protected registerLanguageProvider(
    options: FoldingRangeRegistrationOptions
  ): [Disposable, FoldingRangeProvider] {
    const provider: FoldingRangeProvider = {
      provideFoldingRanges: (document, context, token) => {
        const client = this._client
        const provideFoldingRanges: ProvideFoldingRangeSignature = (document, _, token) => {
          const requestParams: FoldingRangeParams = {
            textDocument: { uri: document.uri }
          }
          return this.sendRequest(FoldingRangeRequest.type, requestParams, token)
        }
        const middleware = client.middleware
        return middleware.provideFoldingRanges
          ? middleware.provideFoldingRanges(document, context, token, provideFoldingRanges)
          : provideFoldingRanges(document, context, token)
      }
    }

    return [languages.registerFoldingRangeProvider(options.documentSelector, provider), provider]
  }
}
