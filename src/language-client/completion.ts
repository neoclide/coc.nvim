'use strict'
import type { CancellationToken, ClientCapabilities, CompletionContext, CompletionOptions, CompletionRegistrationOptions, DocumentSelector, ServerCapabilities } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { CompletionItem, CompletionItemKind, CompletionItemTag, CompletionList, InsertTextMode, Position } from 'vscode-languageserver-types'
import languages from '../languages'
import { CompletionItemProvider, ProviderResult } from '../provider'
import { CompletionRequest, CompletionResolveRequest, Disposable } from '../util/protocol'
import { ensure, FeatureClient, TextDocumentLanguageFeature } from './features'
import * as cv from './utils/converter'
import * as UUID from './utils/uuid'

const SupportedCompletionItemKinds: CompletionItemKind[] = [
  CompletionItemKind.Text,
  CompletionItemKind.Method,
  CompletionItemKind.Function,
  CompletionItemKind.Constructor,
  CompletionItemKind.Field,
  CompletionItemKind.Variable,
  CompletionItemKind.Class,
  CompletionItemKind.Interface,
  CompletionItemKind.Module,
  CompletionItemKind.Property,
  CompletionItemKind.Unit,
  CompletionItemKind.Value,
  CompletionItemKind.Enum,
  CompletionItemKind.Keyword,
  CompletionItemKind.Snippet,
  CompletionItemKind.Color,
  CompletionItemKind.File,
  CompletionItemKind.Reference,
  CompletionItemKind.Folder,
  CompletionItemKind.EnumMember,
  CompletionItemKind.Constant,
  CompletionItemKind.Struct,
  CompletionItemKind.Event,
  CompletionItemKind.Operator,
  CompletionItemKind.TypeParameter
]

export interface ProvideCompletionItemsSignature {
  (
    this: void,
    document: TextDocument,
    position: Position,
    context: CompletionContext,
    token: CancellationToken,
  ): ProviderResult<CompletionItem[] | CompletionList>
}

export interface ResolveCompletionItemSignature {
  (this: void, item: CompletionItem, token: CancellationToken): ProviderResult<CompletionItem>
}

export interface CompletionMiddleware {
  provideCompletionItem?: (
    this: void,
    document: TextDocument,
    position: Position,
    context: CompletionContext,
    token: CancellationToken,
    next: ProvideCompletionItemsSignature
  ) => ProviderResult<CompletionItem[] | CompletionList>
  resolveCompletionItem?: (
    this: void,
    item: CompletionItem,
    token: CancellationToken,
    next: ResolveCompletionItemSignature
  ) => ProviderResult<CompletionItem>
}

export interface $CompletionOptions {
  disableSnippetCompletion?: boolean
}

export class CompletionItemFeature extends TextDocumentLanguageFeature<CompletionOptions, CompletionRegistrationOptions, CompletionItemProvider, CompletionMiddleware, $CompletionOptions> {
  constructor(client: FeatureClient<CompletionMiddleware, $CompletionOptions>) {
    super(client, CompletionRequest.type)
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    let snippetSupport = this._client.clientOptions.disableSnippetCompletion !== true
    let completion = ensure(ensure(capabilities, 'textDocument')!, 'completion')!
    completion.dynamicRegistration = true
    completion.contextSupport = true
    completion.completionItem = {
      snippetSupport,
      commitCharactersSupport: true,
      documentationFormat: this._client.supportedMarkupKind,
      deprecatedSupport: true,
      preselectSupport: true,
      insertReplaceSupport: true,
      tagSupport: { valueSet: [CompletionItemTag.Deprecated] },
      resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
      labelDetailsSupport: true,
      insertTextModeSupport: { valueSet: [InsertTextMode.asIs, InsertTextMode.adjustIndentation] }
    }
    completion.completionItemKind = { valueSet: SupportedCompletionItemKinds }
    completion.insertTextMode = InsertTextMode.adjustIndentation
    completion.completionList = {
      itemDefaults: [
        'commitCharacters', 'editRange', 'insertTextFormat', 'insertTextMode'
      ]
    }
  }

  public initialize(
    capabilities: ServerCapabilities,
    documentSelector: DocumentSelector
  ): void {
    const options = this.getRegistrationOptions(documentSelector, capabilities.completionProvider)
    if (!options) return
    this.register({
      id: UUID.generateUuid(),
      registerOptions: options
    })
  }

  protected registerLanguageProvider(options: CompletionRegistrationOptions & { priority?: number }, id: string): [Disposable, CompletionItemProvider] {
    let triggerCharacters = options.triggerCharacters || []
    let allCommitCharacters = options.allCommitCharacters || []
    const provider: CompletionItemProvider = {
      provideCompletionItems: (document: TextDocument, position: Position, token: CancellationToken, context: CompletionContext): ProviderResult<CompletionList | CompletionItem[]> => {
        const middleware = this._client.middleware
        const provideCompletionItems: ProvideCompletionItemsSignature = (document, position, context, token) => {
          return this.sendRequest(
            CompletionRequest.type,
            cv.asCompletionParams(document, position, context),
            token,
            []
          )
        }
        return middleware.provideCompletionItem
          ? middleware.provideCompletionItem(document, position, context, token, provideCompletionItems)
          : provideCompletionItems(document, position, context, token)
      },
      resolveCompletionItem: options.resolveProvider
        ? (item: CompletionItem, token: CancellationToken): ProviderResult<CompletionItem> => {
          const middleware = this._client.middleware!
          const resolveCompletionItem: ResolveCompletionItemSignature = (item, token) => {
            return this.sendRequest(
              CompletionResolveRequest.type,
              item,
              token,
              item
            )
          }

          return middleware.resolveCompletionItem
            ? middleware.resolveCompletionItem(item, token, resolveCompletionItem)
            : resolveCompletionItem(item, token)
        } : undefined
    }
    // index is needed since one language server could create many sources.
    let name = this._client.id + (this.registrationLength == 0 ? '' : '-' + id)
    const disposable = languages.registerCompletionItemProvider(
      name,
      'LS',
      options.documentSelector,
      provider,
      triggerCharacters,
      options.priority,
      allCommitCharacters)
    return [disposable, provider]
  }
}
