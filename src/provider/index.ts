import { CallHierarchyIncomingCall, CallHierarchyItem, CallHierarchyOutgoingCall, CancellationToken, CodeAction, CodeActionContext, CodeActionKind, CodeLens, Color, ColorInformation, ColorPresentation, Command, CompletionContext, CompletionItem, CompletionList, Definition, DefinitionLink, DocumentHighlight, DocumentLink, DocumentSymbol, Event, FoldingRange, FormattingOptions, Hover, Location, Position, Range, SelectionRange, SignatureHelp, SignatureHelpContext, SymbolInformation, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'

/**
 * A provider result represents the values a provider, like the [`HoverProvider`](#HoverProvider),
 * may return. For once this is the actual result type `T`, like `Hover`, or a thenable that resolves
 * to that type `T`. In addition, `null` and `undefined` can be returned - either directly or from a
 * thenable.
 *
 * The snippets below are all valid implementations of the [`HoverProvider`](#HoverProvider):
 *
 * ```ts
 * let a: HoverProvider = {
 *   provideHover(doc, pos, token): ProviderResult<Hover> {
 *     return new Hover('Hello World')
 *   }
 * }
 *
 * let b: HoverProvider = {
 *   provideHover(doc, pos, token): ProviderResult<Hover> {
 *     return new Promise(resolve => {
 *       resolve(new Hover('Hello World'))
 *      })
 *   }
 * }
 *
 * let c: HoverProvider = {
 *   provideHover(doc, pos, token): ProviderResult<Hover> {
 *     return; // undefined
 *   }
 * }
 * ```
 */
export type ProviderResult<T> =
  | T
  | undefined
  | null
  | Thenable<T | undefined | null>

/**
 * The completion item provider interface defines the contract between extensions and
 * [IntelliSense](https://code.visualstudio.com/docs/editor/intellisense).
 *
 * Providers can delay the computation of the [`detail`](#CompletionItem.detail)
 * and [`documentation`](#CompletionItem.documentation) properties by implementing the
 * [`resolveCompletionItem`](#CompletionItemProvider.resolveCompletionItem)-function. However, properties that
 * are needed for the inital sorting and filtering, like `sortText`, `filterText`, `insertText`, and `range`, must
 * not be changed during resolve.
 *
 * Providers are asked for completions either explicitly by a user gesture or -depending on the configuration-
 * implicitly when typing words or trigger characters.
 */
export interface CompletionItemProvider {
  /**
   * Provide completion items for the given position and document.
   *
   * @param document The document in which the command was invoked.
   * @param position The position at which the command was invoked.
   * @param token A cancellation token.
   * @param context How the completion was triggered.
   *
   * @return An array of completions, a [completion list](#CompletionList), or a thenable that resolves to either.
   * The lack of a result can be signaled by returning `undefined`, `null`, or an empty array.
   */
  provideCompletionItems(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    context?: CompletionContext
  ): ProviderResult<CompletionItem[] | CompletionList>

  /**
   * Given a completion item fill in more data, like [doc-comment](#CompletionItem.documentation)
   * or [details](#CompletionItem.detail).
   *
   * The editor will only resolve a completion item once.
   *
   * @param item A completion item currently active in the UI.
   * @param token A cancellation token.
   * @return The resolved completion item or a thenable that resolves to of such. It is OK to return the given
   * `item`. When no result is returned, the given `item` will be used.
   */
  resolveCompletionItem?(
    item: CompletionItem,
    token: CancellationToken
  ): ProviderResult<CompletionItem>
}

/**
 * The hover provider interface defines the contract between extensions and
 * the [hover](https://code.visualstudio.com/docs/editor/intellisense)-feature.
 */
export interface HoverProvider {
  /**
   * Provide a hover for the given position and document. Multiple hovers at the same
   * position will be merged by the editor. A hover can have a range which defaults
   * to the word range at the position when omitted.
   *
   * @param document The document in which the command was invoked.
   * @param position The position at which the command was invoked.
   * @param token A cancellation token.
   * @return A hover or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined` or `null`.
   */
  provideHover(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<Hover>
}

/**
 * The definition provider interface defines the contract between extensions and
 * the [go to definition](https://code.visualstudio.com/docs/editor/editingevolved#_go-to-definition)
 * and peek definition features.
 */
export interface DefinitionProvider {
  /**
   * Provide the definition of the symbol at the given position and document.
   *
   * @param document The document in which the command was invoked.
   * @param position The position at which the command was invoked.
   * @param token A cancellation token.
   * @return A definition or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined` or `null`.
   */
  provideDefinition(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<Definition | DefinitionLink[]>
}

/**
 * The definition provider interface defines the contract between extensions and
 * the [go to definition](https://code.visualstudio.com/docs/editor/editingevolved#_go-to-definition)
 * and peek definition features.
 */
export interface DeclarationProvider {
  /**
   * Provide the declaration of the symbol at the given position and document.
   */
  provideDeclaration(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Definition | DefinitionLink[]>
}

/**
 * The signature help provider interface defines the contract between extensions and
 * the [parameter hints](https://code.visualstudio.com/docs/editor/intellisense)-feature.
 */
export interface SignatureHelpProvider {
  /**
   * Provide help for the signature at the given position and document.
   *
   * @param document The document in which the command was invoked.
   * @param position The position at which the command was invoked.
   * @param token A cancellation token.
   * @return Signature help or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined` or `null`.
   */
  provideSignatureHelp(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    context: SignatureHelpContext
  ): ProviderResult<SignatureHelp>
}

/**
 * The type definition provider defines the contract between extensions and
 * the go to type definition feature.
 */
export interface TypeDefinitionProvider {
  /**
   * Provide the type definition of the symbol at the given position and document.
   *
   * @param document The document in which the command was invoked.
   * @param position The position at which the command was invoked.
   * @param token A cancellation token.
   * @return A definition or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined` or `null`.
   */
  provideTypeDefinition(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<Definition | DefinitionLink[]>
}

/**
 * Value-object that contains additional information when
 * requesting references.
 */
export interface ReferenceContext {
  /**
   * Include the declaration of the current symbol.
   */
  includeDeclaration: boolean
}

/**
 * The reference provider interface defines the contract between extensions and
 * the [find references](https://code.visualstudio.com/docs/editor/editingevolved#_peek)-feature.
 */
export interface ReferenceProvider {
  /**
   * Provide a set of project-wide references for the given position and document.
   *
   * @param document The document in which the command was invoked.
   * @param position The position at which the command was invoked.
   * @param context
   * @param token A cancellation token.
   * @return An array of locations or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined`, `null`, or an empty array.
   */
  provideReferences(
    document: TextDocument,
    position: Position,
    context: ReferenceContext,
    token: CancellationToken
  ): ProviderResult<Location[]>
}

/**
 * Folding context (for future use)
 */
export interface FoldingContext { }

/**
 * The folding range provider interface defines the contract between extensions and
 * [Folding](https://code.visualstudio.com/docs/editor/codebasics#_folding) in the editor.
 */
export interface FoldingRangeProvider {
  /**
   * Returns a list of folding ranges or null and undefined if the provider
   * does not want to participate or was cancelled.
   *
   * @param document The document in which the command was invoked.
   * @param context Additional context information (for future use)
   * @param token A cancellation token.
   */
  provideFoldingRanges(
    document: TextDocument,
    context: FoldingContext,
    token: CancellationToken
  ): ProviderResult<FoldingRange[]>
}

/**
 * The document symbol provider interface defines the contract between extensions and
 * the [go to symbol](https://code.visualstudio.com/docs/editor/editingevolved#_go-to-symbol)-feature.
 */
export interface DocumentSymbolProvider {
  /**
   * Provide symbol information for the given document.
   *
   * @param document The document in which the command was invoked.
   * @param token A cancellation token.
   * @return An array of document highlights or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined`, `null`, or an empty array.
   */
  provideDocumentSymbols(
    document: TextDocument,
    token: CancellationToken
  ): ProviderResult<SymbolInformation[] | DocumentSymbol[]>
}

/**
 * The implemenetation provider interface defines the contract between extensions and
 * the go to implementation feature.
 */
export interface ImplementationProvider {
  /**
   * Provide the implementations of the symbol at the given position and document.
   *
   * @param document The document in which the command was invoked.
   * @param position The position at which the command was invoked.
   * @param token A cancellation token.
   * @return A definition or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined` or `null`.
   */
  provideImplementation(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<Definition | DefinitionLink[]>
}

/**
 * The workspace symbol provider interface defines the contract between extensions and
 * the [symbol search](https://code.visualstudio.com/docs/editor/editingevolved#_open-symbol-by-name)-feature.
 */
export interface WorkspaceSymbolProvider {
  /**
   * Project-wide search for a symbol matching the given query string. It is up to the provider
   * how to search given the query string, like substring, indexOf etc. To improve performance implementors can
   * skip the [location](#SymbolInformation.location) of symbols and implement `resolveWorkspaceSymbol` to do that
   * later.
   *
   * The `query`-parameter should be interpreted in a *relaxed way* as the editor will apply its own highlighting
   * and scoring on the results. A good rule of thumb is to match case-insensitive and to simply check that the
   * characters of *query* appear in their order in a candidate symbol. Don't use prefix, substring, or similar
   * strict matching.
   *
   * @param query A non-empty query string.
   * @param token A cancellation token.
   * @return An array of document highlights or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined`, `null`, or an empty array.
   */
  provideWorkspaceSymbols(
    query: string,
    token: CancellationToken
  ): ProviderResult<SymbolInformation[]>

  /**
   * Given a symbol fill in its [location](#SymbolInformation.location). This method is called whenever a symbol
   * is selected in the UI. Providers can implement this method and return incomplete symbols from
   * [`provideWorkspaceSymbols`](#WorkspaceSymbolProvider.provideWorkspaceSymbols) which often helps to improve
   * performance.
   *
   * @param symbol The symbol that is to be resolved. Guaranteed to be an instance of an object returned from an
   * earlier call to `provideWorkspaceSymbols`.
   * @param token A cancellation token.
   * @return The resolved symbol or a thenable that resolves to that. When no result is returned,
   * the given `symbol` is used.
   */
  resolveWorkspaceSymbol?(
    symbol: SymbolInformation,
    token: CancellationToken
  ): ProviderResult<SymbolInformation>
}

/**
 * The rename provider interface defines the contract between extensions and
 * the [rename](https://code.visualstudio.com/docs/editor/editingevolved#_rename-symbol)-feature.
 */
export interface RenameProvider {
  /**
   * Provide an edit that describes changes that have to be made to one
   * or many resources to rename a symbol to a different name.
   *
   * @param document The document in which the command was invoked.
   * @param position The position at which the command was invoked.
   * @param newName The new name of the symbol. If the given name is not valid, the provider must return a rejected promise.
   * @param token A cancellation token.
   * @return A workspace edit or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined` or `null`.
   */
  provideRenameEdits(
    document: TextDocument,
    position: Position,
    newName: string,
    token: CancellationToken
  ): ProviderResult<WorkspaceEdit>

  /**
   * Optional function for resolving and validating a position *before* running rename. The result can
   * be a range or a range and a placeholder text. The placeholder text should be the identifier of the symbol
   * which is being renamed - when omitted the text in the returned range is used.
   *
   * @param document The document in which rename will be invoked.
   * @param position The position at which rename will be invoked.
   * @param token A cancellation token.
   * @return The range or range and placeholder text of the identifier that is to be renamed. The lack of a result can signaled by returning `undefined` or `null`.
   */
  prepareRename?(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<Range | { range: Range; placeholder: string }>
}

/**
 * The document formatting provider interface defines the contract between extensions and
 * the formatting-feature.
 */
export interface DocumentFormattingEditProvider {
  /**
   * Provide formatting edits for a whole document.
   *
   * @param document The document in which the command was invoked.
   * @param options Options controlling formatting.
   * @param token A cancellation token.
   * @return A set of text edits or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined`, `null`, or an empty array.
   */
  provideDocumentFormattingEdits(
    document: TextDocument,
    options: FormattingOptions,
    token: CancellationToken
  ): ProviderResult<TextEdit[]>
}

/**
 * The document formatting provider interface defines the contract between extensions and
 * the formatting-feature.
 */
export interface DocumentRangeFormattingEditProvider {
  /**
   * Provide formatting edits for a range in a document.
   *
   * The given range is a hint and providers can decide to format a smaller
   * or larger range. Often this is done by adjusting the start and end
   * of the range to full syntax nodes.
   *
   * @param document The document in which the command was invoked.
   * @param range The range which should be formatted.
   * @param options Options controlling formatting.
   * @param token A cancellation token.
   * @return A set of text edits or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined`, `null`, or an empty array.
   */
  provideDocumentRangeFormattingEdits(
    document: TextDocument,
    range: Range,
    options: FormattingOptions,
    token: CancellationToken
  ): ProviderResult<TextEdit[]>
}

/**
 * The code action interface defines the contract between extensions and
 * the [light bulb](https://code.visualstudio.com/docs/editor/editingevolved#_code-action) feature.
 *
 * A code action can be any command that is [known](#commands.getCommands) to the system.
 */
export interface CodeActionProvider<T extends CodeAction = CodeAction> {
  /**
   * Provide commands for the given document and range.
   *
   * @param document The document in which the command was invoked.
   * @param range The selector or range for which the command was invoked. This will always be a selection if
   * there is a currently active editor.
   * @param context Context carrying additional information.
   * @param token A cancellation token.
   * @return An array of commands, quick fixes, or refactorings or a thenable of such. The lack of a result can be
   * signaled by returning `undefined`, `null`, or an empty array.
   */
  provideCodeActions(
    document: TextDocument,
    range: Range,
    context: CodeActionContext,
    token: CancellationToken
  ): ProviderResult<(Command | CodeAction)[]>

  /**
   * Given a code action fill in its [`edit`](#CodeAction.edit)-property. Changes to
   * all other properties, like title, are ignored. A code action that has an edit
   * will not be resolved.
   *
   * @param codeAction A code action.
   * @param token A cancellation token.
   * @return The resolved code action or a thenable that resolves to such. It is OK to return the given
   * `item`. When no result is returned, the given `item` will be used.
   */
  resolveCodeAction?(codeAction: T, token: CancellationToken): ProviderResult<T>
}

/**
 * Metadata about the type of code actions that a [CodeActionProvider](#CodeActionProvider) providers
 */
export interface CodeActionProviderMetadata {
  /**
   * [CodeActionKinds](#CodeActionKind) that this provider may return.
   *
   * The list of kinds may be generic, such as `CodeActionKind.Refactor`, or the provider
   * may list our every specific kind they provide, such as `CodeActionKind.Refactor.Extract.append('function`)`
   */
  readonly providedCodeActionKinds?: ReadonlyArray<CodeActionKind>
}

/**
 * The document highlight provider interface defines the contract between extensions and
 * the word-highlight-feature.
 */
export interface DocumentHighlightProvider {

  /**
   * Provide a set of document highlights, like all occurrences of a variable or
   * all exit-points of a function.
   *
   * @param document The document in which the command was invoked.
   * @param position The position at which the command was invoked.
   * @param token A cancellation token.
   * @return An array of document highlights or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined`, `null`, or an empty array.
   */
  provideDocumentHighlights(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<DocumentHighlight[]>
}

/**
 * The document link provider defines the contract between extensions and feature of showing
 * links in the editor.
 */
export interface DocumentLinkProvider {

  /**
   * Provide links for the given document. Note that the editor ships with a default provider that detects
   * `http(s)` and `file` links.
   *
   * @param document The document in which the command was invoked.
   * @param token A cancellation token.
   * @return An array of [document links](#DocumentLink) or a thenable that resolves to such. The lack of a result
   * can be signaled by returning `undefined`, `null`, or an empty array.
   */
  provideDocumentLinks(document: TextDocument, token: CancellationToken): ProviderResult<DocumentLink[]>

  /**
   * Given a link fill in its [target](#DocumentLink.target). This method is called when an incomplete
   * link is selected in the UI. Providers can implement this method and return incomple links
   * (without target) from the [`provideDocumentLinks`](#DocumentLinkProvider.provideDocumentLinks) method which
   * often helps to improve performance.
   *
   * @param link The link that is to be resolved.
   * @param token A cancellation token.
   */
  resolveDocumentLink?(link: DocumentLink, token: CancellationToken): ProviderResult<DocumentLink>
}

/**
 * A code lens provider adds [commands](#Command) to source text. The commands will be shown
 * as dedicated horizontal lines in between the source text.
 */
export interface CodeLensProvider {

  /**
   * Compute a list of [lenses](#CodeLens). This call should return as fast as possible and if
   * computing the commands is expensive implementors should only return code lens objects with the
   * range set and implement [resolve](#CodeLensProvider.resolveCodeLens).
   *
   * @param document The document in which the command was invoked.
   * @param token A cancellation token.
   * @return An array of code lenses or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined`, `null`, or an empty array.
   */
  provideCodeLenses(document: TextDocument, token: CancellationToken): ProviderResult<CodeLens[]>

  /**
   * This function will be called for each visible code lens, usually when scrolling and after
   * calls to [compute](#CodeLensProvider.provideCodeLenses)-lenses.
   *
   * @param codeLens code lens that must be resolved.
   * @param token A cancellation token.
   * @return The given, resolved code lens or thenable that resolves to such.
   */
  resolveCodeLens?(codeLens: CodeLens, token: CancellationToken): ProviderResult<CodeLens>
}

/**
 * The document formatting provider interface defines the contract between extensions and
 * the formatting-feature.
 */
export interface OnTypeFormattingEditProvider {

  /**
   * Provide formatting edits after a character has been typed.
   *
   * The given position and character should hint to the provider
   * what range the position to expand to, like find the matching `{`
   * when `}` has been entered.
   *
   * @param document The document in which the command was invoked.
   * @param position The position at which the command was invoked.
   * @param ch The character that has been typed.
   * @param options Options controlling formatting.
   * @param token A cancellation token.
   * @return A set of text edits or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined`, `null`, or an empty array.
   */
  provideOnTypeFormattingEdits(document: TextDocument, position: Position, ch: string, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>
}

/**
 * The document color provider defines the contract between extensions and feature of
 * picking and modifying colors in the editor.
 */
export interface DocumentColorProvider {

  /**
   * Provide colors for the given document.
   *
   * @param document The document in which the command was invoked.
   * @param token A cancellation token.
   * @return An array of [color information](#ColorInformation) or a thenable that resolves to such. The lack of a result
   * can be signaled by returning `undefined`, `null`, or an empty array.
   */
  provideDocumentColors(document: TextDocument, token: CancellationToken): ProviderResult<ColorInformation[]>

  /**
   * Provide [representations](#ColorPresentation) for a color.
   *
   * @param color The color to show and insert.
   * @param context A context object with additional information
   * @param token A cancellation token.
   * @return An array of color presentations or a thenable that resolves to such. The lack of a result
   * can be signaled by returning `undefined`, `null`, or an empty array.
   */
  provideColorPresentations(color: Color, context: { document: TextDocument; range: Range }, token: CancellationToken): ProviderResult<ColorPresentation[]>
}

export interface TextDocumentContentProvider {

  /**
   * An event to signal a resource has changed.
   */
  onDidChange?: Event<URI>

  /**
   * Provide textual content for a given uri.
   *
   * The editor will use the returned string-content to create a readonly
   * [document](#TextDocument). Resources allocated should be released when
   * the corresponding document has been [closed](#workspace.onDidCloseTextDocument).
   *
   * @param uri An uri which scheme matches the scheme this provider was [registered](#workspace.registerTextDocumentContentProvider) for.
   * @param token A cancellation token.
   * @return A string or a thenable that resolves to such.
   */
  provideTextDocumentContent(uri: URI, token: CancellationToken): ProviderResult<string>
}

export interface SelectionRangeProvider {
  /**
   * Provide selection ranges starting at a given position. The first range must [contain](#Range.contains)
   * position and subsequent ranges must contain the previous range.
   */
  provideSelectionRanges(document: TextDocument, positions: Position[], token: CancellationToken): ProviderResult<SelectionRange[]>
}

/**
 * The call hierarchy provider interface describes the contract between extensions
 * and the call hierarchy feature which allows to browse calls and caller of function,
 * methods, constructor etc.
 */
export interface CallHierarchyProvider {

  /**
   * Bootstraps call hierarchy by returning the item that is denoted by the given document
   * and position. This item will be used as entry into the call graph. Providers should
   * return `undefined` or `null` when there is no item at the given location.
   *
   * @param document The document in which the command was invoked.
   * @param position The position at which the command was invoked.
   * @param token A cancellation token.
   * @returns A call hierarchy item or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined` or `null`.
   */
  prepareCallHierarchy(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<CallHierarchyItem | CallHierarchyItem[]>

  /**
   * Provide all incoming calls for an item, e.g all callers for a method. In graph terms this describes directed
   * and annotated edges inside the call graph, e.g the given item is the starting node and the result is the nodes
   * that can be reached.
   *
   * @param item The hierarchy item for which incoming calls should be computed.
   * @param token A cancellation token.
   * @returns A set of incoming calls or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined` or `null`.
   */
  provideCallHierarchyIncomingCalls(item: CallHierarchyItem, token: CancellationToken): ProviderResult<CallHierarchyIncomingCall[]>

  /**
   * Provide all outgoing calls for an item, e.g call calls to functions, methods, or constructors from the given item. In
   * graph terms this describes directed and annotated edges inside the call graph, e.g the given item is the starting
   * node and the result is the nodes that can be reached.
   *
   * @param item The hierarchy item for which outgoing calls should be computed.
   * @param token A cancellation token.
   * @returns A set of outgoing calls or a thenable that resolves to such. The lack of a result can be
   * signaled by returning `undefined` or `null`.
   */
  provideCallHierarchyOutgoingCalls(item: CallHierarchyItem, token: CancellationToken): ProviderResult<CallHierarchyOutgoingCall[]>
}

