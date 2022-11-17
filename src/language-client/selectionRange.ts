'use strict'
import type { CancellationToken, ClientCapabilities, Disposable, DocumentSelector, Position, SelectionRange, SelectionRangeClientCapabilities, SelectionRangeOptions, SelectionRangeParams, SelectionRangeRegistrationOptions, ServerCapabilities } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import languages from '../languages'
import { ProviderResult, SelectionRangeProvider } from '../provider'
import { SelectionRangeRequest } from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'

export interface ProvideSelectionRangeSignature {
  (this: void, document: TextDocument, positions: Position[], token: CancellationToken): ProviderResult<SelectionRange[]>
}

export interface SelectionRangeProviderMiddleware {
  provideSelectionRanges?: (this: void, document: TextDocument, positions: Position[], token: CancellationToken, next: ProvideSelectionRangeSignature) => ProviderResult<SelectionRange[]>
}

export class SelectionRangeFeature extends TextDocumentLanguageFeature<boolean | SelectionRangeOptions, SelectionRangeRegistrationOptions, SelectionRangeProvider, SelectionRangeProviderMiddleware> {
  constructor(client: FeatureClient<SelectionRangeProviderMiddleware>) {
    super(client, SelectionRangeRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities & SelectionRangeClientCapabilities): void {
    let capability = ensure(ensure(capabilities, 'textDocument')!, 'selectionRange')!
    capability.dynamicRegistration = true
  }

  public initialize(capabilities: ServerCapabilities, documentSelector: DocumentSelector): void {
    let [id, options] = this.getRegistration(documentSelector, capabilities.selectionRangeProvider)
    if (!id || !options) {
      return
    }
    this.register({ id, registerOptions: options })
  }

  protected registerLanguageProvider(options: SelectionRangeRegistrationOptions): [Disposable, SelectionRangeProvider] {
    const provider: SelectionRangeProvider = {
      provideSelectionRanges: (document, positions, token) => {
        const client = this._client
        const provideSelectionRanges: ProvideSelectionRangeSignature = (document, positions, token) => {
          const requestParams: SelectionRangeParams = {
            textDocument: { uri: document.uri },
            positions
          }
          return this.sendRequest(SelectionRangeRequest.type, requestParams, token)
        }
        const middleware = client.middleware
        return middleware.provideSelectionRanges
          ? middleware.provideSelectionRanges(document, positions, token, provideSelectionRanges)
          : provideSelectionRanges(document, positions, token)
      }
    }
    return [languages.registerSelectionRangeProvider(options.documentSelector, provider), provider]
  }
}
