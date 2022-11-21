'use strict'
import type { ClientCapabilities, DocumentSymbolOptions, DocumentSelector, DocumentSymbolRegistrationOptions, ServerCapabilities } from 'vscode-languageserver-protocol'
import { TextDocument } from "vscode-languageserver-textdocument"
import { DocumentSymbol, SymbolInformation, SymbolKind, SymbolTag } from 'vscode-languageserver-types'
import languages from '../languages'
import { DocumentSymbolProvider, ProviderResult } from '../provider'
import { CancellationToken, Disposable, DocumentSymbolRequest } from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
import * as cv from './utils/converter'
import * as UUID from './utils/uuid'

export const SupportedSymbolKinds: SymbolKind[] = [
  SymbolKind.File,
  SymbolKind.Module,
  SymbolKind.Namespace,
  SymbolKind.Package,
  SymbolKind.Class,
  SymbolKind.Method,
  SymbolKind.Property,
  SymbolKind.Field,
  SymbolKind.Constructor,
  SymbolKind.Enum,
  SymbolKind.Interface,
  SymbolKind.Function,
  SymbolKind.Variable,
  SymbolKind.Constant,
  SymbolKind.String,
  SymbolKind.Number,
  SymbolKind.Boolean,
  SymbolKind.Array,
  SymbolKind.Object,
  SymbolKind.Key,
  SymbolKind.Null,
  SymbolKind.EnumMember,
  SymbolKind.Struct,
  SymbolKind.Event,
  SymbolKind.Operator,
  SymbolKind.TypeParameter
]

export const SupportedSymbolTags: SymbolTag[] = [
  SymbolTag.Deprecated
]

export interface ProvideDocumentSymbolsSignature {
  (this: void, document: TextDocument, token: CancellationToken): ProviderResult<SymbolInformation[] | DocumentSymbol[]>
}

export interface DocumentSymbolMiddleware {
  provideDocumentSymbols?: (
    this: void,
    document: TextDocument,
    token: CancellationToken,
    next: ProvideDocumentSymbolsSignature
  ) => ProviderResult<SymbolInformation[] | DocumentSymbol[]>
}

export class DocumentSymbolFeature extends TextDocumentLanguageFeature<
  boolean | DocumentSymbolOptions, DocumentSymbolRegistrationOptions, DocumentSymbolProvider, DocumentSymbolMiddleware
> {
  constructor(client: FeatureClient<DocumentSymbolMiddleware>) {
    super(client, DocumentSymbolRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    let symbolCapabilities = ensure(ensure(capabilities, 'textDocument')!, 'documentSymbol')! as any
    symbolCapabilities.dynamicRegistration = true
    symbolCapabilities.symbolKind = {
      valueSet: SupportedSymbolKinds
    }
    symbolCapabilities.hierarchicalDocumentSymbolSupport = true
    symbolCapabilities.tagSupport = {
      valueSet: SupportedSymbolTags
    }
    symbolCapabilities.labelSupport = true
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.documentSymbolProvider)
    if (!options) {
      return
    }
    this.register({
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(
    options: DocumentSymbolRegistrationOptions
  ): [Disposable, DocumentSymbolProvider] {
    const provider: DocumentSymbolProvider = {
      meta: options.label ? { label: options.label } : undefined,
      provideDocumentSymbols: (document, token) => {
        const client = this._client
        const _provideDocumentSymbols: ProvideDocumentSymbolsSignature = (document, token) => {
          return this.sendRequest(
            DocumentSymbolRequest.type,
            cv.asDocumentSymbolParams(document),
            token
          )
        }
        const middleware = client.middleware!
        return middleware.provideDocumentSymbols
          ? middleware.provideDocumentSymbols(document, token, _provideDocumentSymbols)
          : _provideDocumentSymbols(document, token)
      }
    }
    return [languages.registerDocumentSymbolProvider(options.documentSelector!, provider), provider]
  }
}
