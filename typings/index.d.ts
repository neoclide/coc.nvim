// vim: set sw=2 ts=2 sts=2 et foldmarker={{,}} foldmethod=marker foldlevel=0 nofen:

/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/

/// <reference types="node" />
import cp from 'child_process'

declare module 'coc.nvim' {
  // Language server protocol interfaces {{
  export interface Thenable<T> {
    then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => TResult | Thenable<TResult>): Thenable<TResult>
    // eslint-disable-next-line @typescript-eslint/unified-signatures
    then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => void): Thenable<TResult>
  }

  export interface Disposable {
    /**
     * Dispose this object.
     */
    dispose(): void
  }

  export namespace Disposable {
    function create(func: () => void): Disposable
  }
  /**
   * The declaration of a symbol representation as one or many [locations](#Location).
   */
  export type Declaration = Location | Location[]
  /**
   * Information about where a symbol is declared.
   *
   * Provides additional metadata over normal [location](#Location) declarations, including the range of
   * the declaring symbol.
   *
   * Servers should prefer returning `DeclarationLink` over `Declaration` if supported
   * by the client.
   */
  export type DeclarationLink = LocationLink

  export type ProgressToken = number | string

  export interface WorkDoneProgressBegin {
    kind: 'begin'
    /**
     * Mandatory title of the progress operation. Used to briefly inform about
     * the kind of operation being performed.
     *
     * Examples: "Indexing" or "Linking dependencies".
     */
    title: string
    /**
     * Controls if a cancel button should show to allow the user to cancel the
     * long running operation. Clients that don't support cancellation are allowed
     * to ignore the setting.
     */
    cancellable?: boolean
    /**
     * Optional, more detailed associated progress message. Contains
     * complementary information to the `title`.
     *
     * Examples: "3/25 files", "project/src/module2", "node_modules/some_dep".
     * If unset, the previous progress message (if any) is still valid.
     */
    message?: string
    /**
     * Optional progress percentage to display (value 100 is considered 100%).
     * If not provided infinite progress is assumed and clients are allowed
     * to ignore the `percentage` value in subsequent in report notifications.
     *
     * The value should be steadily rising. Clients are free to ignore values
     * that are not following this rule.
     */
    percentage?: number
  }

  export interface WorkDoneProgressReport {
    kind: 'report'
    /**
     * Controls enablement state of a cancel button. This property is only valid if a cancel
     * button got requested in the `WorkDoneProgressStart` payload.
     *
     * Clients that don't support cancellation or don't support control the button's
     * enablement state are allowed to ignore the setting.
     */
    cancellable?: boolean
    /**
     * Optional, more detailed associated progress message. Contains
     * complementary information to the `title`.
     *
     * Examples: "3/25 files", "project/src/module2", "node_modules/some_dep".
     * If unset, the previous progress message (if any) is still valid.
     */
    message?: string
    /**
     * Optional progress percentage to display (value 100 is considered 100%).
     * If not provided infinite progress is assumed and clients are allowed
     * to ignore the `percentage` value in subsequent in report notifications.
     *
     * The value should be steadily rising. Clients are free to ignore values
     * that are not following this rule.
     */
    percentage?: number
  }

  export type FileChangeType = 1 | 2 | 3

  /**
   * An event describing a file change.
   */
  export interface FileEvent {
    /**
     * The file's uri.
     */
    uri: string
    /**
     * The change type.
     */
    type: FileChangeType
  }

  export interface WorkDoneProgressEnd {
    kind: 'end'
    /**
     * Optional, a final message indicating to for example indicate the outcome
     * of the operation.
     */
    message?: string
  }

  /**
   * A literal to identify a text document in the client.
   */
  export interface TextDocumentIdentifier {
    /**
     * The text document's uri.
     */
    uri: string
  }

  export interface WorkspaceFolder {
    /**
     * The associated URI for this workspace folder.
     */
    uri: string
    /**
     * The name of the workspace folder. Used to refer to this
     * workspace folder in the user interface.
     */
    name: string
  }

  /**
   * An event describing a change to a text document.
   */
  export interface TextDocumentContentChange {
    /**
     * The range of the document that changed.
     */
    range: Range
    /**
     * The new text for the provided range.
     */
    text: string
  }

  /**
   * The workspace folder change event.
   */
  export interface WorkspaceFoldersChangeEvent {
    /**
     * The array of added workspace folders
     */
    added: WorkspaceFolder[]
    /**
     * The array of the removed workspace folders
     */
    removed: WorkspaceFolder[]
  }

  /**
   * An event that is fired when a [document](#TextDocument) will be saved.
   *
   * To make modifications to the document before it is being saved, call the
   * [`waitUntil`](#TextDocumentWillSaveEvent.waitUntil)-function with a thenable
   * that resolves to an array of [text edits](#TextEdit).
   */
  export interface TextDocumentWillSaveEvent {

    /**
     * The document that will be saved.
     */
    document: TextDocument

    /**
     * The reason why save was triggered.
     */
    reason: 1 | 2 | 3
  }

  /**
   * A document filter denotes a document by different properties like
   * the [language](#TextDocument.languageId), the [scheme](#Uri.scheme) of
   * its resource, or a glob-pattern that is applied to the [path](#TextDocument.fileName).
   *
   * Glob patterns can have the following syntax:
   * - `*` to match one or more characters in a path segment
   * - `?` to match on one character in a path segment
   * - `**` to match any number of path segments, including none
   * - `{}` to group conditions (e.g. `**​/*.{ts,js}` matches all TypeScript and JavaScript files)
   * - `[]` to declare a range of characters to match in a path segment (e.g., `example.[0-9]` to match on `example.0`, `example.1`, …)
   * - `[!...]` to negate a range of characters to match in a path segment (e.g., `example.[!0-9]` to match on `example.a`, `example.b`, but not `example.0`)
   *
   * @sample A language filter that applies to typescript files on disk: `{ language: 'typescript', scheme: 'file' }`
   * @sample A language filter that applies to all package.json paths: `{ language: 'json', pattern: '**package.json' }`
   */
  export type DocumentFilter = {
    /** A language id, like `typescript`. */
    language: string
    /** A Uri [scheme](#Uri.scheme), like `file` or `untitled`. */
    scheme?: string
    /** A glob pattern, like `*.{ts,js}`. */
    pattern?: string
  } | {
    /** A language id, like `typescript`. */
    language?: string
    /** A Uri [scheme](#Uri.scheme), like `file` or `untitled`. */
    scheme: string
    /** A glob pattern, like `*.{ts,js}`. */
    pattern?: string
  } | {
    /** A language id, like `typescript`. */
    language?: string
    /** A Uri [scheme](#Uri.scheme), like `file` or `untitled`. */
    scheme?: string
    /** A glob pattern, like `*.{ts,js}`. */
    pattern: string
  }
  /**
   * A document selector is the combination of one or many document filters.
   *
   * @sample `let sel:DocumentSelector = [{ language: 'typescript' }, { language: 'json', pattern: '**∕tsconfig.json' }]`;
   */
  export type DocumentSelector = (string | DocumentFilter)[]
  /**
   * A selection range represents a part of a selection hierarchy. A selection range
   * may have a parent selection range that contains it.
   */
  export interface SelectionRange {
    /**
     * The [range](#Range) of this selection range.
     */
    range: Range
    /**
     * The parent selection range containing this range. Therefore `parent.range` must contain `this.range`.
     */
    parent?: SelectionRange
  }

  /**
   * MarkedString can be used to render human readable text. It is either a markdown string
   * or a code-block that provides a language and a code snippet. The language identifier
   * is semantically equal to the optional language identifier in fenced code blocks in GitHub
   * issues. See https://help.github.com/articles/creating-and-highlighting-code-blocks/#syntax-highlighting
   *
   * The pair of a language and a value is an equivalent to markdown:
   * ```${language}
   * ${value}
   * ```
   *
   * Note that markdown strings will be sanitized - that means html will be escaped.
   * @deprecated use MarkupContent instead.
   */
  export type MarkedString = string | {
    language: string
    value: string
  }
  /**
   * The result of a hover request.
   */
  export interface Hover {
    /**
     * The hover's content
     */
    contents: MarkupContent | MarkedString | MarkedString[]
    /**
     * An optional range
     */
    range?: Range
  }

  /**
   * The definition of a symbol represented as one or many [locations](#Location).
   * For most programming languages there is only one location at which a symbol is
   * defined.
   *
   * Servers should prefer returning `DefinitionLink` over `Definition` if supported
   * by the client.
   */
  export type Definition = Location | Location[]

  /**
   * Information about where a symbol is defined.
   *
   * Provides additional metadata over normal [location](#Location) definitions, including the range of
   * the defining symbol
   */
  export type DefinitionLink = LocationLink

  export type SignatureHelpTriggerKind = 1 | 2 | 3

  /**
   * Represents the signature of something callable. A signature
   * can have a label, like a function-name, a doc-comment, and
   * a set of parameters.
   */
  export interface SignatureInformation {
    /**
     * The label of this signature. Will be shown in
     * the UI.
     */
    label: string
    /**
     * The human-readable doc-comment of this signature. Will be shown
     * in the UI but can be omitted.
     */
    documentation?: string | MarkupContent
    /**
     * The parameters of this signature.
     */
    parameters?: ParameterInformation[]
  }

  /**
   * Represents a parameter of a callable-signature. A parameter can
   * have a label and a doc-comment.
   */
  export interface ParameterInformation {
    /**
     * The label of this parameter information.
     *
     * Either a string or an inclusive start and exclusive end offsets within its containing
     * signature label. (see SignatureInformation.label). The offsets are based on a UTF-16
     * string representation as `Position` and `Range` does.
     *
     * *Note*: a label of type string should be a substring of its containing signature label.
     * Its intended use case is to highlight the parameter label part in the `SignatureInformation.label`.
     */
    label: string | [number, number]
    /**
     * The human-readable doc-comment of this signature. Will be shown
     * in the UI but can be omitted.
     */
    documentation?: string | MarkupContent
  }

  /**
   * Signature help represents the signature of something
   * callable. There can be multiple signature but only one
   * active and only one active parameter.
   */
  export interface SignatureHelp {
    /**
     * One or more signatures.
     */
    signatures: SignatureInformation[]
    /**
     * The active signature. Set to `null` if no
     * signatures exist.
     */
    activeSignature: number | null
    /**
     * The active parameter of the active signature. Set to `null`
     * if the active signature has no parameters.
     */
    activeParameter: number | null
  }
  /**
   * Additional information about the context in which a signature help request was triggered.
   *
   * @since 3.15.0
   */
  export interface SignatureHelpContext {
    /**
     * Action that caused signature help to be triggered.
     */
    triggerKind: SignatureHelpTriggerKind
    /**
     * Character that caused signature help to be triggered.
     *
     * This is undefined when `triggerKind !== SignatureHelpTriggerKind.TriggerCharacter`
     */
    triggerCharacter?: string
    /**
     * `true` if signature help was already showing when it was triggered.
     *
     * Retriggers occur when the signature help is already active and can be caused by actions such as
     * typing a trigger character, a cursor move, or document content changes.
     */
    isRetrigger: boolean
    /**
     * The currently active `SignatureHelp`.
     *
     * The `activeSignatureHelp` has its `SignatureHelp.activeSignature` field updated based on
     * the user navigating through available signatures.
     */
    activeSignatureHelp?: SignatureHelp
  }

  /**
   * Represents a folding range.
   */
  export interface FoldingRange {
    /**
     * The zero-based line number from where the folded range starts.
     */
    startLine: number
    /**
     * The zero-based character offset from where the folded range starts. If not defined, defaults to the length of the start line.
     */
    startCharacter?: number
    /**
     * The zero-based line number where the folded range ends.
     */
    endLine: number
    /**
     * The zero-based character offset before the folded range ends. If not defined, defaults to the length of the end line.
     */
    endCharacter?: number
    /**
     * Describes the kind of the folding range such as `comment' or 'region'. The kind
     * is used to categorize folding ranges and used by commands like 'Fold all comments'. See
     * [FoldingRangeKind](#FoldingRangeKind) for an enumeration of standardized kinds.
     */
    kind?: string
  }

  export type SymbolKind = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26

  /**
   * Represents information about programming constructs like variables, classes,
   * interfaces etc.
   */
  export interface SymbolInformation {
    /**
     * The name of this symbol.
     */
    name: string
    /**
     * The kind of this symbol.
     */
    kind: SymbolKind
    /**
     * Indicates if this symbol is deprecated.
     */
    deprecated?: boolean
    /**
     * The location of this symbol. The location's range is used by a tool
     * to reveal the location in the editor. If the symbol is selected in the
     * tool the range's start information is used to position the cursor. So
     * the range usually spans more than the actual symbol's name and does
     * normally include thinks like visibility modifiers.
     *
     * The range doesn't have to denote a node range in the sense of a abstract
     * syntax tree. It can therefore not be used to re-construct a hierarchy of
     * the symbols.
     */
    location: Location
    /**
     * The name of the symbol containing this symbol. This information is for
     * user interface purposes (e.g. to render a qualifier in the user interface
     * if necessary). It can't be used to re-infer a hierarchy for the document
     * symbols.
     */
    containerName?: string
  }

  /**
   * Represents programming constructs like variables, classes, interfaces etc.
   * that appear in a document. Document symbols can be hierarchical and they
   * have two ranges: one that encloses its definition and one that points to
   * its most interesting range, e.g. the range of an identifier.
   */
  export interface DocumentSymbol {
    /**
     * The name of this symbol. Will be displayed in the user interface and therefore must not be
     * an empty string or a string only consisting of white spaces.
     */
    name: string
    /**
     * More detail for this symbol, e.g the signature of a function.
     */
    detail?: string
    /**
     * The kind of this symbol.
     */
    kind: SymbolKind
    /**
     * Indicates if this symbol is deprecated.
     */
    deprecated?: boolean
    /**
     * The range enclosing this symbol not including leading/trailing whitespace but everything else
     * like comments. This information is typically used to determine if the the clients cursor is
     * inside the symbol to reveal in the symbol in the UI.
     */
    range: Range
    /**
     * The range that should be selected and revealed when this symbol is being picked, e.g the name of a function.
     * Must be contained by the the `range`.
     */
    selectionRange: Range
    /**
     * Children of this symbol, e.g. properties of a class.
     */
    children?: DocumentSymbol[]
  }

  export interface FormattingOptions {
    /**
     * If indentation is based on spaces (`insertSpaces` = true), the number of spaces that make an indent.
     */
    tabSize?: number
    /**
     * Is indentation based on spaces?
     */
    insertSpaces?: boolean
    /**
     * The default 'end of line' character. If not set, '\n' is used as default.
     */
    eol?: string
  }

  /**
   * Contains additional diagnostic information about the context in which
   * a [code action](#CodeActionProvider.provideCodeActions) is run.
   */
  export interface CodeActionContext {
    /**
     * An array of diagnostics known on the client side overlapping the range provided to the
     * `textDocument/codeAction` request. They are provied so that the server knows which
     * errors are currently presented to the user for the given range. There is no guarantee
     * that these accurately reflect the error state of the resource. The primary parameter
     * to compute code actions is the provided range.
     */
    diagnostics: Diagnostic[]
    /**
     * Requested kind of actions to return.
     *
     * Actions not of this kind are filtered out by the client before being shown. So servers
     * can omit computing them.
     */
    only?: string[]
  }

  export type DocumentHighlightKind = 1 | 2 | 3
  /**
   * A document highlight is a range inside a text document which deserves
   * special attention. Usually a document highlight is visualized by changing
   * the background color of its range.
   */
  export interface DocumentHighlight {
    /**
     * The range this highlight applies to.
     */
    range: Range
    /**
     * The highlight kind, default is [text](#DocumentHighlightKind.Text).
     */
    kind?: DocumentHighlightKind
  }

  /**
   * A document link is a range in a text document that links to an internal or external resource, like another
   * text document or a web site.
   */
  export interface DocumentLink {
    /**
     * The range this link applies to.
     */
    range: Range
    /**
     * The uri this link points to.
     */
    target?: string
    /**
     * The tooltip text when you hover over this link.
     *
     * If a tooltip is provided, is will be displayed in a string that includes instructions on how to
     * trigger the link, such as `{0} (ctrl + click)`. The specific instructions vary depending on OS,
     * user settings, and localization.
     *
     * @since 3.15.0
     */
    tooltip?: string
    /**
     * A data entry field that is preserved on a document link between a
     * DocumentLinkRequest and a DocumentLinkResolveRequest.
     */
    data?: any
  }

  /**
   * Represents a color in RGBA space.
   */
  export interface Color {
    /**
     * The red component of this color in the range [0-1].
     */
    readonly red: number
    /**
     * The green component of this color in the range [0-1].
     */
    readonly green: number
    /**
     * The blue component of this color in the range [0-1].
     */
    readonly blue: number
    /**
     * The alpha component of this color in the range [0-1].
     */
    readonly alpha: number
  }

  /**
   * Represents a color range from a document.
   */
  export interface ColorInformation {
    /**
     * The range in the document where this color appers.
     */
    range: Range
    /**
     * The actual color value for this color range.
     */
    color: Color
  }

  export interface ColorPresentation {
    /**
     * The label of this color presentation. It will be shown on the color
     * picker header. By default this is also the text that is inserted when selecting
     * this color presentation.
     */
    label: string
    /**
     * An [edit](#TextEdit) which is applied to a document when selecting
     * this presentation for the color.  When `falsy` the [label](#ColorPresentation.label)
     * is used.
     */
    textEdit?: TextEdit
    /**
     * An optional array of additional [text edits](#TextEdit) that are applied when
     * selecting this color presentation. Edits must not overlap with the main [edit](#ColorPresentation.textEdit) nor with themselves.
     */
    additionalTextEdits?: TextEdit[]
  }

  /**
   * A code lens represents a [command](#Command) that should be shown along with
   * source text, like the number of references, a way to run tests, etc.
   *
   * A code lens is _unresolved_ when no command is associated to it. For performance
   * reasons the creation of a code lens and resolving should be done to two stages.
   */
  export interface CodeLens {
    /**
     * The range in which this code lens is valid. Should only span a single line.
     */
    range: Range
    /**
     * The command this code lens represents.
     */
    command?: Command
    /**
     * An data entry field that is preserved on a code lens item between
     * a [CodeLensRequest](#CodeLensRequest) and a [CodeLensResolveRequest]
     * (#CodeLensResolveRequest)
     */
    data?: any
  }

  /**
   * Represents the connection of two locations. Provides additional metadata over normal [locations](#Location),
   * including an origin range.
   */
  export interface LocationLink {
    /**
     * Span of the origin of this link.
     *
     * Used as the underlined span for mouse definition hover. Defaults to the word range at
     * the definition position.
     */
    originSelectionRange?: Range
    /**
     * The target resource identifier of this link.
     */
    targetUri: string
    /**
     * The full target range of this link. If the target for example is a symbol then target range is the
     * range enclosing this symbol not including leading/trailing whitespace but everything else
     * like comments. This information is typically used to highlight the range in the editor.
     */
    targetRange: Range
    /**
     * The range that should be selected and revealed when this link is being followed, e.g the name of a function.
     * Must be contained by the the `targetRange`. See also `DocumentSymbol#range`
     */
    targetSelectionRange: Range
  }

  /**
   * The LocationLink namespace provides helper functions to work with
   * [LocationLink](#LocationLink) literals.
   */
  export namespace LocationLink {
    /**
     * Creates a LocationLink literal.
     * @param targetUri The definition's uri.
     * @param targetRange The full range of the definition.
     * @param targetSelectionRange The span of the symbol definition at the target.
     * @param originSelectionRange The span of the symbol being defined in the originating source file.
    */
    function create(targetUri: string, targetRange: Range, targetSelectionRange: Range, originSelectionRange?: Range): LocationLink
    /**
     * Checks whether the given literal conforms to the [LocationLink](#LocationLink) interface.
     */
    function is(value: any): value is LocationLink
  }

  export type MarkupKind = 'plaintext' | 'markdown'

  /**
   * A `MarkupContent` literal represents a string value which content is interpreted base on its
   * kind flag. Currently the protocol supports `plaintext` and `markdown` as markup kinds.
   *
   * If the kind is `markdown` then the value can contain fenced code blocks like in GitHub issues.
   * See https://help.github.com/articles/creating-and-highlighting-code-blocks/#syntax-highlighting
   *
   * Here is an example how such a string can be constructed using JavaScript / TypeScript:
   * ```ts
   * let markdown: MarkdownContent = {
   *  kind: MarkupKind.Markdown,
   *	value: [
   *		'# Header',
   *		'Some text',
   *		'```typescript',
   *		'someCode();',
   *		'```'
   *	].join('\n')
   * };
   * ```
   *
   * *Please Note* that clients might sanitize the return markdown. A client could decide to
   * remove HTML from the markdown to avoid script execution.
   */
  export interface MarkupContent {
    /**
     * The type of the Markup
     */
    kind: MarkupKind
    /**
     * The content itself
     */
    value: string
  }

  /**
   * The kind of a completion entry.
   */
  export namespace CompletionItemKind {
    const Text: 1
    const Method: 2
    const Function: 3
    const Constructor: 4
    const Field: 5
    const Variable: 6
    const Class: 7
    const Interface: 8
    const Module: 9
    const Property: 10
    const Unit: 11
    const Value: 12
    const Enum: 13
    const Keyword: 14
    const Snippet: 15
    const Color: 16
    const File: 17
    const Reference: 18
    const Folder: 19
    const EnumMember: 20
    const Constant: 21
    const Struct: 22
    const Event: 23
    const Operator: 24
    const TypeParameter: 25
  }

  export type CompletionItemKind = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25

  /**
   * Defines whether the insert text in a completion item should be interpreted as
   * plain text or a snippet.
   */
  export namespace InsertTextFormat {
    /**
     * The primary text to be inserted is treated as a plain string.
     */
    const PlainText: 1
    /**
     * The primary text to be inserted is treated as a snippet.
     *
     * A snippet can define tab stops and placeholders with `$1`, `$2`
     * and `${3:foo}`. `$0` defines the final tab stop, it defaults to
     * the end of the snippet. Placeholders with equal identifiers are linked,
     * that is typing in one will update others too.
     *
     * See also: https://github.com/Microsoft/vscode/blob/master/src/vs/editor/contrib/snippet/common/snippet.md
     */
    const Snippet: 2
  }
  export type InsertTextFormat = 1 | 2

  /**
   * A completion item represents a text snippet that is
   * proposed to complete text that is being typed.
   */
  export interface CompletionItem {
    /**
     * The label of this completion item. By default
     * also the text that is inserted when selecting
     * this completion.
     */
    label: string
    /**
     * The kind of this completion item. Based of the kind
     * an icon is chosen by the editor.
     */
    kind?: CompletionItemKind
    /**
     * Tags for this completion item.
     *
     * @since 3.15.0
     */
    tags?: number[]
    /**
     * A human-readable string with additional information
     * about this item, like type or symbol information.
     */
    detail?: string
    /**
     * A human-readable string that represents a doc-comment.
     */
    documentation?: string | MarkupContent
    /**
     * Indicates if this item is deprecated.
     * @deprecated Use `tags` instead.
     */
    deprecated?: boolean
    /**
     * Select this item when showing.
     *
     * *Note* that only one completion item can be selected and that the
     * tool / client decides which item that is. The rule is that the *first*
     * item of those that match best is selected.
     */
    preselect?: boolean
    /**
     * A string that should be used when comparing this item
     * with other items. When `falsy` the [label](#CompletionItem.label)
     * is used.
     */
    sortText?: string
    /**
     * A string that should be used when filtering a set of
     * completion items. When `falsy` the [label](#CompletionItem.label)
     * is used.
     */
    filterText?: string
    /**
     * A string that should be inserted into a document when selecting
     * this completion. When `falsy` the [label](#CompletionItem.label)
     * is used.
     *
     * The `insertText` is subject to interpretation by the client side.
     * Some tools might not take the string literally. For example
     * VS Code when code complete is requested in this example `con<cursor position>`
     * and a completion item with an `insertText` of `console` is provided it
     * will only insert `sole`. Therefore it is recommended to use `textEdit` instead
     * since it avoids additional client side interpretation.
     */
    insertText?: string
    /**
     * The format of the insert text. The format applies to both the `insertText` property
     * and the `newText` property of a provided `textEdit`. If ommitted defaults to
     * `InsertTextFormat.PlainText`.
     */
    insertTextFormat?: InsertTextFormat
    /**
     * An [edit](#TextEdit) which is applied to a document when selecting
     * this completion. When an edit is provided the value of
     * [insertText](#CompletionItem.insertText) is ignored.
     *
     * *Note:* The text edit's range must be a [single line] and it must contain the position
     * at which completion has been requested.
     */
    textEdit?: TextEdit
    /**
     * An optional array of additional [text edits](#TextEdit) that are applied when
     * selecting this completion. Edits must not overlap (including the same insert position)
     * with the main [edit](#CompletionItem.textEdit) nor with themselves.
     *
     * Additional text edits should be used to change text unrelated to the current cursor position
     * (for example adding an import statement at the top of the file if the completion item will
     * insert an unqualified type).
     */
    additionalTextEdits?: TextEdit[]
    /**
     * An optional set of characters that when pressed while this completion is active will accept it first and
     * then type that character. *Note* that all commit characters should have `length=1` and that superfluous
     * characters will be ignored.
     */
    commitCharacters?: string[]
    /**
     * An optional [command](#Command) that is executed *after* inserting this completion. *Note* that
     * additional modifications to the current document should be described with the
     * [additionalTextEdits](#CompletionItem.additionalTextEdits)-property.
     */
    command?: Command
    /**
     * An data entry field that is preserved on a completion item between
     * a [CompletionRequest](#CompletionRequest) and a [CompletionResolveRequest]
     * (#CompletionResolveRequest)
     */
    data?: any
  }

  /**
   * Represents a collection of [completion items](#CompletionItem) to be presented
   * in the editor.
   */
  export interface CompletionList {
    /**
     * This list it not complete. Further typing results in recomputing this list.
     */
    isIncomplete: boolean
    /**
     * The completion items.
     */
    items: CompletionItem[]
  }

  /**
   * Contains additional information about the context in which a completion request is triggered.
   */
  export interface CompletionContext {
    /**
     * How the completion was triggered.
     */
    triggerKind: 1 | 2 | 3,
    /**
     * The trigger character (a single character) that has trigger code complete.
     * Is undefined if `triggerKind !== CompletionTriggerKind.TriggerCharacter`
     */
    triggerCharacter?: string
  }

  /**
   * Represents a reference to a command. Provides a title which
   * will be used to represent a command in the UI and, optionally,
   * an array of arguments which will be passed to the command handler
   * function when invoked.
   */
  export interface Command {
    /**
     * Title of the command, like `save`.
     */
    title: string
    /**
     * The identifier of the actual command handler.
     */
    command: string
    /**
     * Arguments that the command handler should be
     * invoked with.
     */
    arguments?: any[]
  }

  export interface TextDocumentEdit {
    /**
     * The text document to change.
     */
    textDocument: {
      uri: string
      version: number | null
    }
    /**
     * The edits to be applied.
     */
    edits: TextEdit[]
  }

  /**
   * A workspace edit represents changes to many resources managed in the workspace. The edit
   * should either provide `changes` or `documentChanges`. If documentChanges are present
   * they are preferred over `changes` if the client can handle versioned document edits.
   */
  export interface WorkspaceEdit {
    /**
     * Holds changes to existing resources.
     */
    changes?: {
      [uri: string]: TextEdit[]
    }
    /**
     * Depending on the client capability `workspace.workspaceEdit.resourceOperations` document changes
     * are either an array of `TextDocumentEdit`s to express changes to n different text documents
     * where each text document edit addresses a specific version of a text document. Or it can contain
     * above `TextDocumentEdit`s mixed with create, rename and delete file / folder operations.
     *
     * Whether a client supports versioned document edits is expressed via
     * `workspace.workspaceEdit.documentChanges` client capability.
     *
     * If a client neither supports `documentChanges` nor `workspace.workspaceEdit.resourceOperations` then
     * only plain `TextEdit`s using the `changes` property are supported.
     */
    documentChanges?: (TextDocumentEdit | CreateFile | RenameFile | DeleteFile)[]
  }

  interface ResourceOperation {
    kind: string
  }

  /**
   * Delete file options
   */
  export interface DeleteFileOptions {
    /**
     * Delete the content recursively if a folder is denoted.
     */
    recursive?: boolean
    /**
     * Ignore the operation if the file doesn't exist.
     */
    ignoreIfNotExists?: boolean
  }
  /**
   * Delete file operation
   */
  export interface DeleteFile extends ResourceOperation {
    /**
     * A delete
     */
    kind: 'delete'
    /**
     * The file to delete.
     */
    uri: string
    /**
     * Delete options.
     */
    options?: DeleteFileOptions
  }

  /**
   * Options to create a file.
   */
  export interface CreateFileOptions {
    /**
     * Overwrite existing file. Overwrite wins over `ignoreIfExists`
     */
    overwrite?: boolean
    /**
     * Ignore if exists.
     */
    ignoreIfExists?: boolean
  }
  /**
   * Create file operation.
   */
  export interface CreateFile extends ResourceOperation {
    /**
     * A create
     */
    kind: 'create'
    /**
     * The resource to create.
     */
    uri: string
    /**
     * Additional options
     */
    options?: CreateFileOptions
  }

  /**
   * Rename file options
   */
  export interface RenameFileOptions {
    /**
     * Overwrite target if existing. Overwrite wins over `ignoreIfExists`
     */
    overwrite?: boolean
    /**
     * Ignores if target exists.
     */
    ignoreIfExists?: boolean
  }
  /**
   * Rename file operation
   */
  export interface RenameFile extends ResourceOperation {
    /**
     * A rename
     */
    kind: 'rename'
    /**
     * The old (existing) location.
     */
    oldUri: string
    /**
     * The new location.
     */
    newUri: string
    /**
     * Rename options.
     */
    options?: RenameFileOptions
  }
  /**
   * Represents a related message and source code location for a diagnostic. This should be
   * used to point to code locations that cause or related to a diagnostics, e.g when duplicating
   * a symbol in a scope.
   */
  export interface DiagnosticRelatedInformation {
    /**
     * The location of this related diagnostic information.
     */
    location: Location
    /**
     * The message of this related diagnostic information.
     */
    message: string
  }

  /**
   * The diagnostic's severity.
   */
  export namespace DiagnosticSeverity {
    /**
     * Reports an error.
     */
    const Error: 1
    /**
     * Reports a warning.
     */
    const Warning: 2
    /**
     * Reports an information.
     */
    const Information: 3
    /**
     * Reports a hint.
     */
    const Hint: 4
  }
  export type DiagnosticSeverity = 1 | 2 | 3 | 4

  /**
   * The diagnostic tags.
   *
   * @since 3.15.0
   */
  export namespace DiagnosticTag {
    /**
     * Unused or unnecessary code.
     *
     * Clients are allowed to render diagnostics with this tag faded out instead of having
     * an error squiggle.
     */
    const Unnecessary: 1
    /**
     * Deprecated or obsolete code.
     *
     * Clients are allowed to rendered diagnostics with this tag strike through.
     */
    const Deprecated: 2
  }

  export type DiagnosticTag = 1 | 2

  /**
   * Represents a diagnostic, such as a compiler error or warning. Diagnostic objects
   * are only valid in the scope of a resource.
   */
  export interface Diagnostic {
    /**
     * The range at which the message applies
     */
    range: Range
    /**
     * The diagnostic's severity. Can be omitted. If omitted it is up to the
     * client to interpret diagnostics as error, warning, info or hint.
     */
    severity?: DiagnosticSeverity
    /**
     * The diagnostic's code, which usually appear in the user interface.
     */
    code?: number | string
    /**
     * A human-readable string describing the source of this
     * diagnostic, e.g. 'typescript' or 'super lint'. It usually
     * appears in the user interface.
     */
    source?: string
    /**
     * The diagnostic's message. It usually appears in the user interface
     */
    message: string
    /**
     * Additional metadata about the diagnostic.
     */
    tags?: DiagnosticTag[]
    /**
     * An array of related diagnostic information, e.g. when symbol-names within
     * a scope collide all definitions can be marked via this property.
     */
    relatedInformation?: DiagnosticRelatedInformation[]
  }

  /**
   * The Diagnostic namespace provides helper functions to work with
   * [Diagnostic](#Diagnostic) literals.
   */
  export namespace Diagnostic {
    /**
     * Creates a new Diagnostic literal.
     */
    function create(range: Range, message: string, severity?: DiagnosticSeverity, code?: number | string, source?: string, relatedInformation?: DiagnosticRelatedInformation[]): Diagnostic
    /**
     * Checks whether the given literal conforms to the [Diagnostic](#Diagnostic) interface.
     */
    function is(value: any): value is Diagnostic
  }

  /**
   * A code action represents a change that can be performed in code, e.g. to fix a problem or
   * to refactor code.
   *
   * A CodeAction must set either `edit` and/or a `command`. If both are supplied, the `edit` is applied first, then the `command` is executed.
   */
  export interface CodeAction {
    /**
     * A short, human-readable, title for this code action.
     */
    title: string
    /**
     * The kind of the code action.
     *
     * Used to filter code actions.
     */
    kind?: string
    /**
     * The diagnostics that this code action resolves.
     */
    diagnostics?: Diagnostic[]
    /**
     * Marks this as a preferred action. Preferred actions are used by the `auto fix` command and can be targeted
     * by keybindings.
     *
     * A quick fix should be marked preferred if it properly addresses the underlying error.
     * A refactoring should be marked preferred if it is the most reasonable choice of actions to take.
     *
     * @since 3.15.0
     */
    isPreferred?: boolean
    /**
     * The workspace edit this code action performs.
     */
    edit?: WorkspaceEdit
    /**
     * A command this code action executes. If a code action
     * provides a edit and a command, first the edit is
     * executed and then the command.
     */
    command?: Command
    /**
     * Id of client that provide codeAction.
     */
    clientId?: string
  }

  /**
   * Position in a text document expressed as zero-based line and character offset.
   * The offsets are based on a UTF-16 string representation. So a string of the form
   * `a𐐀b` the character offset of the character `a` is 0, the character offset of `𐐀`
   * is 1 and the character offset of b is 3 since `𐐀` is represented using two code
   * units in UTF-16.
   *
   * Positions are line end character agnostic. So you can not specify a position that
   * denotes `\r|\n` or `\n|` where `|` represents the character offset.
   */
  export interface Position {
    /**
     * Line position in a document (zero-based).
     * If a line number is greater than the number of lines in a document, it defaults back to the number of lines in the document.
     * If a line number is negative, it defaults to 0.
     */
    line: number
    /**
     * Character offset on a line in a document (zero-based). Assuming that the line is
     * represented as a string, the `character` value represents the gap between the
     * `character` and `character + 1`.
     *
     * If the character value is greater than the line length it defaults back to the
     * line length.
     * If a line number is negative, it defaults to 0.
     */
    character: number
  }

  /**
 * The Position namespace provides helper functions to work with
 * [Position](#Position) literals.
 */
  export namespace Position {
    /**
     * Creates a new Position literal from the given line and character.
     * @param line The position's line.
     * @param character The position's character.
     */
    function create(line: number, character: number): Position
    /**
     * Checks whether the given liternal conforms to the [Position](#Position) interface.
     */
    function is(value: any): value is Position
  }

  /**
   * Represents a typed event.
   *
   * A function that represents an event to which you subscribe by calling it with
   * a listener function as argument.
   *
   * @example
   * item.onDidChange(function(event) { console.log("Event happened: " + event); });
   */
  export interface Event<T> {

    /**
     * A function that represents an event to which you subscribe by calling it with
     * a listener function as argument.
     *
     * @param listener The listener function will be called when the event happens.
     * @param thisArgs The `this`-argument which will be used when calling the event listener.
     * @param disposables An array to which a [disposable](#Disposable) will be added.
     * @return A disposable which unsubscribes the event listener.
     */
    (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable
  }

  export namespace Event {
    const None: Event<any>
  }

  export interface EmitterOptions {
    onFirstListenerAdd?: Function
    onLastListenerRemove?: Function
  }

  export class Emitter<T> {
    constructor(_options?: EmitterOptions | undefined)
    /**
     * For the public to allow to subscribe
     * to events from this Emitter
     */
    get event(): Event<T>
    /**
     * To be kept private to fire an event to
     * subscribers
     */
    fire(event: T): any
    dispose(): void
  }

  /**
   * Represents a location inside a resource, such as a line
   * inside a text file.
   */
  export interface Location {
    uri: string
    range: Range
  }

  /**
   * The Location namespace provides helper functions to work with
   * [Location](#Location) literals.
   */
  export namespace Location {
    /**
     * Creates a Location literal.
     * @param uri The location's uri.
     * @param range The location's range.
     */
    function create(uri: string, range: Range): Location
    /**
     * Checks whether the given literal conforms to the [Location](#Location) interface.
     */
    function is(value: any): value is Location
  }

  /**
   * A range in a text document expressed as (zero-based) start and end positions.
   *
   * If you want to specify a range that contains a line including the line ending
   * character(s) then use an end position denoting the start of the next line.
   * For example:
   * ```ts
   * {
   *     start: { line: 5, character: 23 }
   *     end : { line 6, character : 0 }
   * }
   * ```
   */
  export interface Range {
    /**
     * The range's start position
     */
    start: Position
    /**
     * The range's end position.
     */
    end: Position
  }

  /**
   * The Range namespace provides helper functions to work with
   * [Range](#Range) literals.
   */
  export namespace Range {
    /**
     * Create a new Range liternal.
     * @param start The range's start position.
     * @param end The range's end position.
     */
    function create(start: Position, end: Position): Range
    /**
     * Create a new Range liternal.
     * @param startLine The start line number.
     * @param startCharacter The start character.
     * @param endLine The end line number.
     * @param endCharacter The end character.
     */
    function create(startLine: number, startCharacter: number, endLine: number, endCharacter: number): Range
    /**
     * Checks whether the given literal conforms to the [Range](#Range) interface.
     */
    function is(value: any): value is Range
  }

  /**
   * A text edit applicable to a text document.
   */
  export interface TextEdit {
    /**
     * The range of the text document to be manipulated. To insert
     * text into a document create a range where start === end.
     */
    range: Range
    /**
     * The string to be inserted. For delete operations use an
     * empty string.
     */
    newText: string
  }

  /**
   * The TextEdit namespace provides helper function to create replace,
   * insert and delete edits more easily.
   */
  export namespace TextEdit {
    /**
     * Creates a replace text edit.
     * @param range The range of text to be replaced.
     * @param newText The new text.
     */
    function replace(range: Range, newText: string): TextEdit
    /**
     * Creates a insert text edit.
     * @param position The position to insert the text at.
     * @param newText The text to be inserted.
     */
    function insert(position: Position, newText: string): TextEdit
    /**
     * Creates a delete text edit.
     * @param range The range of text to be deleted.
     */
    function del(range: Range): TextEdit
    function is(value: any): value is TextEdit
  }

  /**
   * Defines a CancellationToken. This interface is not
   * intended to be implemented. A CancellationToken must
   * be created via a CancellationTokenSource.
   */
  export interface CancellationToken {
    /**
     * Is `true` when the token has been cancelled, `false` otherwise.
     */
    readonly isCancellationRequested: boolean
    /**
     * An [event](#Event) which fires upon cancellation.
     */
    readonly onCancellationRequested: Event<any>
  }

  export namespace CancellationToken {
    const None: CancellationToken
    const Cancelled: CancellationToken
    function is(value: any): value is CancellationToken
  }

  export class CancellationTokenSource {
    get token(): CancellationToken
    cancel(): void
    dispose(): void
  }

  /**
   * A simple text document. Not to be implemented. The document keeps the content
   * as string.
   */
  export interface TextDocument {
    /**
     * The associated URI for this document. Most documents have the __file__-scheme, indicating that they
     * represent files on disk. However, some documents may have other schemes indicating that they are not
     * available on disk.
     *
     * @readonly
     */
    readonly uri: string
    /**
     * The identifier of the language associated with this document.
     *
     * @readonly
     */
    readonly languageId: string
    /**
     * The version number of this document (it will increase after each
     * change, including undo/redo).
     *
     * @readonly
     */
    readonly version: number
    /**
     * Get the text of this document. A substring can be retrieved by
     * providing a range.
     *
     * @param range (optional) An range within the document to return.
     * If no range is passed, the full content is returned.
     * Invalid range positions are adjusted as described in [Position.line](#Position.line)
     * and [Position.character](#Position.character).
     * If the start range position is greater than the end range position,
     * then the effect of getText is as if the two positions were swapped.

     * @return The text of this document or a substring of the text if a
     *         range is provided.
     */
    getText(range?: Range): string
    /**
     * Converts a zero-based offset to a position.
     *
     * @param offset A zero-based offset.
     * @return A valid [position](#Position).
     */
    positionAt(offset: number): Position
    /**
     * Converts the position to a zero-based offset.
     * Invalid positions are adjusted as described in [Position.line](#Position.line)
     * and [Position.character](#Position.character).
     *
     * @param position A position.
     * @return A valid zero-based offset.
     */
    offsetAt(position: Position): number
    /**
     * The number of lines in this document.
     *
     * @readonly
     */
    readonly lineCount: number
  }
  // }}

  // nvim interfaces {{
  type VimValue =
    | number
    | boolean
    | string
    | number[]
    | { [key: string]: any }

  // see `:h nvim_set_client_info()` for details.
  export interface VimClientInfo {
    name: string
    version: {
      major?: number
      minor?: number
      patch?: number
      prerelease?: string
      commit?: string
    }
    type: 'remote' | 'embedder' | 'host'
    methods?: {
      [index: string]: any
    }
    attributes?: {
      [index: string]: any
    }
  }

  export interface UiAttachOptions {
    rgb?: boolean
    ext_popupmenu?: boolean
    ext_tabline?: boolean
    ext_wildmenu?: boolean
    ext_cmdline?: boolean
    ext_linegrid?: boolean
    ext_hlstate?: boolean
  }

  export interface ChanInfo {
    id: number
    stream: 'stdio' | 'stderr' | 'socket' | 'job'
    mode: 'bytes' | 'terminal' | 'rpc'
    pty?: number
    buffer?: number
    client?: VimClientInfo
  }

  /**
   * Returned by nvim_get_commands api.
   */
  export interface VimCommandDescription {
    name: string
    bang: boolean
    bar: boolean
    register: boolean
    definition: string
    count?: number | null
    script_id: number
    complete?: string
    nargs?: string
    range?: string
    complete_arg?: string
  }

  export interface NvimFloatOptions {
    standalone?: boolean
    focusable?: boolean
    relative?: 'editor' | 'cursor' | 'win'
    anchor?: 'NW' | 'NE' | 'SW' | 'SE'
    height: number
    width: number
    row: number
    col: number
  }

  export interface NvimProc {
    ppid: number
    name: string
    pid: number
  }

  export interface BufferHighlight {
    /**
     * Name of the highlight group to use 
     */
    hlGroup?: string
    /**
     * Namespace to use or -1 for ungrouped highlight
     */
    srcId?: number
    /**
     * Line to highlight (zero-indexed)
     */
    line?: number
    /**
     * Start of (byte-indexed) column range to highlight
     */
    colStart?: number
    /**
     * End of (byte-indexed) column range to highlight, or -1 to highlight to end of line
     */
    colEnd?: number
  }

  export interface BufferClearHighlight {
    srcId?: number
    lineStart?: number
    lineEnd?: number
  }

  interface BaseApi<T> {
    /**
     * unique identify number
     */
    id: number

    /**
     * Check if same by compare id.
     */
    equals(other: T): boolean

    /**
     * Request to vim, name need to be nvim_ prefixed and supported by vim.
     *
     * @param {string} name - nvim function name
     * @param {VimValue[]} args
     * @returns {Promise<VimValue>}
     */
    request(name: string, args?: VimValue[]): Promise<any>

    /**
     * Send notification to vim, name need to be nvim_ prefixed and supported
     * by vim
     */
    notify(name: string, args?: VimValue[]): void

    /**
     * Retrieves scoped variable, returns null when value not exists.
     */
    getVar(name: string): Promise<VimValue | null>

    /**
     * Set scoped variable by request.
     *
     * @param {string} name
     * @param {VimValue} value
     * @returns {Promise<void>}
     */
    setVar(name: string, value: VimValue): Promise<void>

    /**
     * Set scoped variable by notification.
     */
    setVar(name: string, value: VimValue, isNotify: true): void

    /**
     * Delete scoped variable by notification.
     */
    deleteVar(name: string): void

    /**
     * Retrieves a scoped option, not exists for tabpage.
     */
    getOption(name: string): Promise<VimValue>

    /**
     * Set scoped option by request, not exists for tabpage.
     */
    setOption(name: string, value: VimValue): Promise<void>

    /**
     * Set scoped  variable by notification, not exists for tabpage.
     */
    setOption(name: string, value: VimValue, isNotify: true): void
  }

  export interface Neovim extends BaseApi<Neovim> {

    /**
     * Check if `nvim_` function exists.
     */
    hasFunction(name: string): boolean

    /**
     * Get channelid used by coc.nvim.
     */
    channelId: Promise<number>

    /**
     * Create buffer instance by id.
     */
    createBuffer(id: number): Buffer

    /**
     * Create window instance by id.
     */
    createWindow(id: number): Window

    /**
     * Create tabpage instance by id.
     */
    createTabpage(id: number): Tabpage

    /**
     * Stop send subsquent notifications.
     */
    pauseNotification(): void

    /**
     * Send paused notifications by nvim_call_atomic request
     *
     * **Note**: avoid call async function between pauseNotification and
     * resumeNotification.
     */
    resumeNotification(): Promise<[any[], [string, number, string] | null]>

    /**
     * Send paused notifications by nvim_call_atomic notification
     */
    resumeNotification(cancel: boolean, notify: true): void

    /**
     * Get list of current buffers.
     */
    buffers: Promise<Buffer[]>

    /**
     * Get current buffer.
     */
    buffer: Promise<Buffer>

    /**
     * Set current buffer
     */
    setBuffer(buffer: Buffer): Promise<void>

    /**
     * Get list of current tabpages.
     */
    tabpages: Promise<Tabpage[]>

    /**
     * Get current tabpage.
     */
    tabpage: Promise<Tabpage>

    /**
     * Set current tabpage
     */
    setTabpage(tabpage: Tabpage): Promise<void>

    /**
     * Get list of current windows.
     */
    windows: Promise<Window[]>

    /**
     * Get current window.
     */
    window: Promise<Window>

    /**
     * Set current window.
     */
    setWindow(window: Window): Promise<void>

    /**
     * Get information of all channels,
     * **Note:** works on neovim only.
     */
    chans: Promise<ChanInfo[]>

    /**
     * Get information of channel by id,
     * **Note:** works on neovim only.
     */
    getChanInfo(id: number): Promise<ChanInfo>

    /**
     * Creates a new namespace, or gets an existing one.
     * `:h nvim_create_namespace()`
     */
    createNamespace(name?: string): Promise<number>

    /**
     * Gets existing, non-anonymous namespaces.
     *
     * @return dict that maps from names to namespace ids.
     */
    namespaces: Promise<{ [name: string]: number }>

    /**
     * Gets a map of global (non-buffer-local) Ex commands.
     *
     * @return Map of maps describing commands.
     */
    getCommands(opt?: { builtin: boolean }): Promise<{ [name: string]: VimCommandDescription }>

    /**
     * Get list of all runtime paths
     */
    runtimePaths: Promise<string[]>

    /**
     * Set global working directory.
     * **Note:** works on neovim only.
     */
    setDirectory(dir: string): Promise<void>

    /**
     * Get current line.
     */
    line: Promise<string>

    /**
     * Creates a new, empty, unnamed buffer.
     *
     * **Note:** works on neovim only.
     */
    createNewBuffer(listed?: boolean, scratch?: boolean): Promise<Buffer>

    /**
     * Create float window of neovim.
     *
     * **Note:** works on neovim only, use high level api provided by window
     * module is recommended.
     */
    openFloatWindow(buffer: Buffer, enter: boolean, options: NvimFloatOptions): Promise<Window>

    /**
     * Set current line.
     */
    setLine(line: string): Promise<void>

    /**
     * Gets a list of global (non-buffer-local) |mapping| definitions.
     * `:h nvim_get_keymap`
     *
     * **Note:** works on neovim only.
     */
    getKeymap(mode: string): Promise<object[]>

    /**
     * Gets the current mode. |mode()| "blocking" is true if Nvim is waiting for input.
     *
     * **Note:** blocking would always be false when used with vim.
     */
    mode: Promise<{ mode: string; blocking: boolean }>

    /**
     * Returns a map of color names and RGB values.
     *
     * **Note:** works on neovim only.
     */
    colorMap(): Promise<{ [name: string]: number }>

    /**
     * Returns the 24-bit RGB value of a |nvim_get_color_map()| color name or
     * "#rrggbb" hexadecimal string.
     *
     * **Note:** works on neovim only.
     */
    getColorByName(name: string): Promise<number>

    /**
     * Gets a highlight definition by id. |hlID()|
     *
     * **Note:** works on neovim only.
     */
    getHighlight(nameOrId: string | number, isRgb?: boolean): Promise<object>

    /**
     * Get a highlight by name, return rgb by default.
     *
     * **Note:** works on neovim only.
     */
    getHighlightByName(name: string, isRgb?: boolean): Promise<object>

    /**
     * Get a highlight by id, return rgb by default.
     *
     * **Note:** works on neovim only.
     */
    getHighlightById(id: number, isRgb?: boolean): Promise<object>

    /**
     * Delete current line in buffer.
     */
    deleteCurrentLine(): Promise<void>

    /**
     * Evaluates a VimL expression (:help expression). Dictionaries
     * and Lists are recursively expanded. On VimL error: Returns a
     * generic error; v:errmsg is not updated.
     *
     */
    eval(expr: string): Promise<VimValue>

    /**
     * Executes lua, it's possible neovim client does not support this
     *
     * **Note:** works on neovim only.
     */
    executeLua(code: string, args?: VimValue[]): Promise<object>

    /**
     * Calls a VimL |Dictionary-function| with the given arguments.
     */
    callDictFunction(dict: object | string, fname: string, args: VimValue | VimValue[]): Promise<object>

    /**
     * Call a vim function.
     *
     * @param {string} fname - function name
     * @param {VimValue | VimValue[]} args
     * @returns {Promise<any>}
     */
    call(fname: string, args?: VimValue | VimValue[]): Promise<any>

    /**
     * Call a vim function by notification.
     */
    call(fname: string, args: VimValue | VimValue[], isNotify: true): void

    /**
     * Call a vim function with timer of timeout 0.
     *
     * @param {string} fname - function name
     * @param {VimValue | VimValue[]} args
     * @returns {Promise<any>}
     */
    callTimer(fname: string, args?: VimValue | VimValue[]): Promise<void>

    /**
     * Call a vim function with timer of timeout 0 by notification.
     */
    callTimer(fname: string, args: VimValue | VimValue[], isNotify: true): void

    /**
     * Call async vim function that accept callback as argument
     * by using notifications.
     */
    callAsync(fname: string, args?: VimValue | VimValue[]): Promise<unknown>

    /**
     * Calls many API methods atomically.
     */
    callAtomic(calls: [string, VimValue[]][]): Promise<[any[], any[] | null]>

    /**
     * Executes an ex-command by request.
     */
    command(arg: string): Promise<void>

    /**
     * Executes an ex-command by notification.
     */
    command(arg: string, isNotify: true): Promise<void>

    /**
     * Runs a command and returns output.
     *
     * **Note:** works on neovim only.
     */
    commandOutput(arg: string): Promise<string>

    /**
     * Gets a v: variable.
     */
    getVvar(name: string): Promise<VimValue>

    /**
     * `:h nvim_feedkeys`
     */
    feedKeys(keys: string, mode: string, escapeCsi: boolean): Promise<void>

    /**
     * Queues raw user-input. Unlike |nvim_feedkeys()|, this uses a
     * low-level input buffer and the call is non-blocking (input is
     * processed asynchronously by the eventloop).
     *
     * On execution error: does not fail, but updates v:errmsg.
     *
     * **Note:** works on neovim only.
     */
    input(keys: string): Promise<number>

    /**
     * Parse a VimL Expression.
     */
    parseExpression(expr: string, flags: string, highlight: boolean): Promise<object>

    /**
     * Get process info, neovim only.
     *
     * **Note:** works on neovim only.
     */
    getProc(pid: number): Promise<NvimProc>

    /**
     * Gets the immediate children of process `pid`.
     *
     * **Note:** works on neovim only.
     */
    getProcChildren(pid: number): Promise<NvimProc[]>

    /**
     * Replaces terminal codes and |keycodes| (<CR>, <Esc>, ...)
     * in a string with the internal representation.
     *
     * **Note:** works on neovim only.
     */
    replaceTermcodes(str: string, fromPart: boolean, doIt: boolean, special: boolean): Promise<string>

    /**
     * Gets width(display cells) of string.
     */
    strWidth(str: string): Promise<number>

    /**
     * Gets a list of dictionaries representing attached UIs.
     *
     * **Note:** works on neovim only.
     */
    uis: Promise<any[]>

    /**
     * Subscribe to nvim event broadcasts.
     *
     * **Note:** works on neovim only.
     */
    subscribe(event: string): Promise<void>

    /**
     * Unsubscribe to nvim event broadcasts
     *
     * **Note:** works on neovim only.
     */
    unsubscribe(event: string): Promise<void>

    /**
     * Activates UI events on the channel.
     *
     * **Note:** works on neovim only.
     */
    uiAttach(width: number, height: number, options: UiAttachOptions): Promise<void>

    /**
     * `:h nvim_ui_try_resize`
     *
     * **Note:** works on neovim only.
     */
    uiTryResize(width: number, height: number): Promise<void>

    /**
     * Deactivates UI events on the channel.
     *
     * **Note:** works on neovim only.
     */
    uiDetach(): Promise<void>

    /**
     * Quit vim.
     */
    quit(): Promise<void>
  }

  export interface Buffer extends BaseApi<Buffer> {
    id: number

    /** Total number of lines in buffer */
    length: Promise<number>

    /**
     * Get lines of buffer.
     */
    lines: Promise<string[]>

    /**
     * Get changedtick of buffer.
     */
    changedtick: Promise<number>

    /**
     * Gets a map of buffer-local |user-commands|.
     *
     * **Note:** works on neovim only.
     */
    getCommands(options?: {}): Promise<Object>

    /**
     * Get lines of buffer, get all lines by default.
     */
    getLines(opts?: { start: number, end: number, strictIndexing?: boolean }): Promise<string[]>

    /**
     * Set lines of buffer given indeces use request.
     */
    setLines(lines: string[], opts?: { start: number, end: number, strictIndexing?: boolean }): Promise<void>

    /**
     * Set lines of buffer given indeces use notification.
     */
    setLines(lines: string[], opts: { start: number, end: number, strictIndexing?: boolean }, isNotify: true): void

    /**
     * Set virtual text for a line
     *
     * @public
     * @param {number} src_id - Source group to use or 0 to use a new group, or -1
     * @param {number} line - Line to annotate with virtual text (zero-indexed)
     * @param {Chunk[]} chunks - List with [text, hl_group]
     * @param {[index} opts
     * @returns {Promise<number>}
     */
    setVirtualText(src_id: number, line: number, chunks: [string, string][], opts?: { [index: string]: any }): Promise<number>

    /**
     * Append a string or list of lines to end of buffer
     */
    append(lines: string[] | string): Promise<void>

    /**
     * Get buffer name.
     */
    name: Promise<string>

    /**
     * Set buffer name.
     */
    setName(name: string): Promise<void>

    /**
     * Check if buffer valid.
     */
    valid: Promise<boolean>

    /**
     * Get mark position given mark name
     *
     * **Note:** works on neovim only.
     */
    mark(name: string): Promise<[number, number]>

    /**
     * Gets a list of buffer-local |mapping| definitions.
     *
     * @return Array of maparg()-like dictionaries describing mappings. 
     * The "buffer" key holds the associated buffer handle.
     */
    getKeymap(mode: string): Promise<object[]>

    /**
     * Check if buffer loaded.
     */
    loaded: Promise<boolean>

    /**
     * Returns the byte offset for a line.
     *
     * Line 1 (index=0) has offset 0. UTF-8 bytes are counted. EOL is
     * one byte. 'fileformat' and 'fileencoding' are ignored. The
     * line index just after the last line gives the total byte-count
     * of the buffer. A final EOL byte is counted if it would be
     * written, see 'eol'.
     *
     * Unlike |line2byte()|, throws error for out-of-bounds indexing.
     * Returns -1 for unloaded buffer.
     *
     * @return {Number} Integer byte offset, or -1 for unloaded buffer.
     */
    getOffset(index: number): Promise<number>

    /**
     * Adds a highlight to buffer, checkout |nvim_buf_add_highlight|.
     *
     * Note: when `srcId = 0`, request is made for new `srcId`, otherwire, use notification.
     * Note: `hlGroup` as empty string is not supported.
     *
     * @deprecated use `highlightRanges()` instead.
     */
    addHighlight(opts: BufferHighlight): Promise<number | null>

    /**
     * Clear highlights of specified lins.
     *
     * @deprecated use clearNamespace instead.
     */
    clearHighlight(args?: BufferClearHighlight)

    /**
     * Add highlight to ranges by notification, works on both vim & neovim.
     *
     * Works on neovim and `workspace.isVim && workspace.env.textprop` is true
     *
     * @param {string | number} srcId Unique key or namespace number.
     * @param {string} hlGroup Highlight group.
     * @param {Range[]} ranges List of highlight ranges
     */
    highlightRanges(srcId: string | number, hlGroup: string, ranges: Range[]): void

    /**
     * Clear namespace by id or name by notification, works on both vim & neovim.
     *
     * Works on neovim and `workspace.isVim && workspace.env.textprop` is true
     *
     * @param key Unique key or namespace number, use -1 for all namespaces
     * @param lineStart Start of line, 0 based, default to 0.
     * @param lineEnd End of line, 0 based, default to -1.
     */
    clearNamespace(key: number | string, lineStart?: number, lineEnd?: number)
  }

  export interface Window extends BaseApi<Window> {
    /**
     * The windowid that not change within a Vim session
     */
    id: number

    /**
     * Buffer in window.
     */
    buffer: Promise<Buffer>

    /**
     * Tabpage contains window.
     */
    tabpage: Promise<Tabpage>

    /**
     * Cursor position as [line, col], 1 based.
     */
    cursor: Promise<[number, number]>

    /**
     * Window height.
     */
    height: Promise<number>

    /**
     * Window width.
     */
    width: Promise<number>

    /**
     * Set cursor position by request.
     */
    setCursor(pos: [number, number]): Promise<void>

    /**
     * Set cursor position by notification.
     */
    setCursor(pos: [number, number], isNotify: true): void

    /**
     * Set height
     */
    setHeight(height: number): Promise<void>

    /**
     * Set height by notification.
     */
    setHeight(height: number, isNotify: true): void

    /**
     * Set width.
     */
    setWidth(width: number): Promise<void>

    /**
     * Set width by notification.
     */
    setWidth(width: number, isNotify: true): void

    /**
     * Get window position, not work with vim8's popup.
     */
    position: Promise<[number, number]>

    /** 0-indexed, on-screen window position(row) in display cells. */
    row: Promise<number>

    /** 0-indexed, on-screen window position(col) in display cells. */
    col: Promise<number>

    /**
     * Check if window valid.
     */
    valid: Promise<boolean>

    /**
     * Get window number, throws for invalid window.
     */
    number: Promise<number>

    /**
     * Config float window with options.
     *
     * **Note:** works on neovim only.
     */
    setConfig(options: NvimFloatOptions): Promise<void>

    /**
     * Config float window with options by send notification.
     *
     * **Note:** works on neovim only.
     */
    setConfig(options: NvimFloatOptions, isNotify: true): void

    /**
     * Gets window configuration.
     *
     * **Note:** works on neovim only.
     *
     * @returns Map defining the window configuration, see |nvim_open_win()|
     */
    getConfig(): Promise<NvimFloatOptions>

    /**
     * Close window by send request.
     */
    close(force: boolean): Promise<void>

    /**
     * Close window by send notification.
     */
    close(force: boolean, isNotify: true): void

    /**
     * Add highlight to ranges by request (matchaddpos is used)
     *
     * @return {Promise<number[]>} match ids.
     */
    highlightRanges(hlGroup: string, ranges: Range[], priority?: number): Promise<number[]>

    /**
     * Add highlight to ranges by notification (matchaddpos is used)
     */
    highlightRanges(hlGroup: string, ranges: Range[], priority: number, isNotify: true): void

    /**
     * Clear match of highlight group by send notification.
     */
    clearMatchGroup(hlGroup: string): void

    /**
     * Clear match of match ids by send notification.
     */
    clearMatches(ids: number[]): void
  }

  export interface Tabpage extends BaseApi<Tabpage> {
    /**
     * tabpage number.
     */
    number: Promise<number>

    /**
     * Is current tabpage valid.
     */
    valid: Promise<boolean>

    /**
     * Returns all windows of tabpage.
     */
    windows: Promise<Window[]>

    /**
     * Current window of tabpage.
     */
    window: Promise<Window>
  }
  // }}

  // vscode-uri {{
  export interface UriComponents {
    scheme: string
    authority: string
    path: string
    query: string
    fragment: string
  }
  /**
   * Uniform Resource Identifier (URI) http://tools.ietf.org/html/rfc3986.
   * This class is a simple parser which creates the basic component parts
   * (http://tools.ietf.org/html/rfc3986#section-3) with minimal validation
   * and encoding.
   *
   * ```txt
   *       foo://example.com:8042/over/there?name=ferret#nose
   *       \_/   \______________/\_________/ \_________/ \__/
   *        |           |            |            |        |
   *     scheme     authority       path        query   fragment
   *        |   _____________________|__
   *       / \ /                        \
   *       urn:example:animal:ferret:nose
   * ```
   */
  export class Uri implements UriComponents {
    static isUri(thing: any): thing is Uri
    /**
     * scheme is the 'http' part of 'http://www.msft.com/some/path?query#fragment'.
     * The part before the first colon.
     */
    readonly scheme: string
    /**
     * authority is the 'www.msft.com' part of 'http://www.msft.com/some/path?query#fragment'.
     * The part between the first double slashes and the next slash.
     */
    readonly authority: string
    /**
     * path is the '/some/path' part of 'http://www.msft.com/some/path?query#fragment'.
     */
    readonly path: string
    /**
     * query is the 'query' part of 'http://www.msft.com/some/path?query#fragment'.
     */
    readonly query: string
    /**
     * fragment is the 'fragment' part of 'http://www.msft.com/some/path?query#fragment'.
     */
    readonly fragment: string
    /**
     * @internal
     */
    protected constructor(scheme: string, authority?: string, path?: string, query?: string, fragment?: string, _strict?: boolean)
    /**
     * @internal
     */
    protected constructor(components: UriComponents)
    /**
     * Returns a string representing the corresponding file system path of this URI.
     * Will handle UNC paths, normalizes windows drive letters to lower-case, and uses the
     * platform specific path separator.
     *
     * * Will *not* validate the path for invalid characters and semantics.
     * * Will *not* look at the scheme of this URI.
     * * The result shall *not* be used for display purposes but for accessing a file on disk.
     *
     *
     * The *difference* to `URI#path` is the use of the platform specific separator and the handling
     * of UNC paths. See the below sample of a file-uri with an authority (UNC path).
     *
     * ```ts
          const u = URI.parse('file://server/c$/folder/file.txt')
          u.authority === 'server'
          u.path === '/shares/c$/file.txt'
          u.fsPath === '\\server\c$\folder\file.txt'
      ```
     *
     * Using `URI#path` to read a file (using fs-apis) would not be enough because parts of the path,
     * namely the server name, would be missing. Therefore `URI#fsPath` exists - it's sugar to ease working
     * with URIs that represent files on disk (`file` scheme).
     */
    readonly fsPath: string
    with(change: {
      scheme?: string
      authority?: string | null
      path?: string | null
      query?: string | null
      fragment?: string | null
    }): Uri
    /**
     * Creates a new URI from a string, e.g. `http://www.msft.com/some/path`,
     * `file:///usr/home`, or `scheme:with/path`.
     *
     * @param value A string which represents an URI (see `URI#toString`).
     */
    static parse(value: string, _strict?: boolean): Uri
    /**
     * Creates a new URI from a file system path, e.g. `c:\my\files`,
     * `/usr/home`, or `\\server\share\some\path`.
     *
     * The *difference* between `URI#parse` and `URI#file` is that the latter treats the argument
     * as path, not as stringified-uri. E.g. `URI.file(path)` is **not the same as**
     * `URI.parse('file://' + path)` because the path might contain characters that are
     * interpreted (# and ?). See the following sample:
     * ```ts
      const good = URI.file('/coding/c#/project1');
      good.scheme === 'file';
      good.path === '/coding/c#/project1';
      good.fragment === '';
      const bad = URI.parse('file://' + '/coding/c#/project1');
      bad.scheme === 'file';
      bad.path === '/coding/c'; // path is now broken
      bad.fragment === '/project1';
      ```
     *
     * @param path A file system path (see `URI#fsPath`)
     */
    static file(path: string): Uri
    static from(components: {
      scheme: string
      authority?: string
      path?: string
      query?: string
      fragment?: string
    }): Uri
    /**
     * Creates a string representation for this URI. It's guaranteed that calling
     * `URI.parse` with the result of this function creates an URI which is equal
     * to this URI.
     *
     * * The result shall *not* be used for display purposes but for externalization or transport.
     * * The result will be encoded using the percentage encoding and encoding happens mostly
     * ignore the scheme-specific encoding rules.
     *
     * @param skipEncoding Do not encode the result, default is `false`
     */
    toString(skipEncoding?: boolean): string
    toJSON(): UriComponents
  }
  // }}

  // vim interfaces {{
  /**
   * See `:h complete-items`
   */
  export interface VimCompleteItem {
    word: string
    abbr?: string
    menu?: string
    info?: string
    kind?: string
    icase?: number
    equal?: number
    dup?: number
    empty?: number
    user_data?: string
  }

  export interface LocationListItem {
    bufnr: number
    lnum: number
    col: number
    text: string
    type: string
  }

  export interface QuickfixItem {
    uri?: string
    bufnr?: number
    module?: string
    range?: Range
    text?: string
    type?: string
    filename?: string
    lnum?: number
    col?: number
    valid?: boolean
    nr?: number
  }
  // }}

  // provider interfaces {{
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

  export type ProviderName = 'rename' | 'onTypeEdit' | 'documentLink' | 'documentColor'
    | 'foldingRange' | 'format' | 'codeAction' | 'workspaceSymbols' | 'formatRange'
    | 'hover' | 'signature' | 'documentSymbol' | 'documentHighlight' | 'definition'
    | 'declaration' | 'typeDefinition' | 'reference' | 'implementation'
    | 'codeLens' | 'selectionRange'

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
    ): ProviderResult<Definition>
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
    ): ProviderResult<Definition>
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
  export interface FoldingContext {}

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
    ): ProviderResult<Definition>
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
    readonly providedCodeActionKinds?: ReadonlyArray<string>
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
    onDidChange?: Event<Uri>

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
    provideTextDocumentContent(uri: Uri, token: CancellationToken): ProviderResult<string>
  }

  export interface SelectionRangeProvider {
    /**
     * Provide selection ranges starting at a given position. The first range must [contain](#Range.contains)
     * position and subsequent ranges must contain the previous range.
     */
    provideSelectionRanges(document: TextDocument, positions: Position[], token: CancellationToken): ProviderResult<SelectionRange[]>
  }
  // }}

  // Classes {{

  export interface FloatWinConfig {
    maxHeight?: number
    maxWidth?: number
    preferTop?: boolean
    autoHide?: boolean
    offsetX?: number
    title?: string
    border?: number[]
    cursorline?: boolean
    close?: boolean
    highlight?: string
    borderhighlight?: string
    modes?: string[]
  }

  export interface Documentation {
    /**
     * Filetype used for highlight, markdown is supported.
     */
    filetype: string
    /**
     * Content of document.
     */
    content: string
    /**
     * Byte offset (0 based) that should be undelined.
     */
    active?: [number, number]
  }

  /**
   * Float window factory for create float around current cursor, works on vim and neovim.
   * Use `workspace.floatSupported` to check if float could work.
   *
   * Float windows are automatic reused and hidden on specific events including:
   *  - BufEnter
   *  - InsertEnter
   *  - InsertLeave
   *  - MenuPopupChanged
   *  - CursorMoved
   *  - CursorMovedI
   */
  export class FloatFactory implements Disposable {
    get bufnr(): number | undefined
    get buffer(): Buffer | null
    get window(): Window | null
    activated(): Promise<boolean>

    constructor(nvim: Neovim)

    /**
     * Show documentations in float window/popup around cursor.
     * Window and buffer are reused when possible.
     * Window is closed automatically on change buffer, InsertEnter, CursorMoved and CursorMovedI.
     *
     * @param docs List of documentations.
     * @param config Configuration for floating window/popup.
     */
    show(docs: Documentation[], config?: FloatWinConfig): Promise<void>

    /**
     * Close float window.
     */
    close(): void
    dispose(): void
  }

  /**
   * Build buffer with lines and highlights
   */
  export class Highlighter {
    constructor(srcId?: number)
    /**
     * Add a line with highlight group.
     */
    addLine(line: string, hlGroup?: string): void
    /**
     * Add lines without highlights.
     */
    addLines(lines: string[]): void
    /**
     * Add text with highlight.
     */
    addText(text: string, hlGroup?: string): void
    /**
     * Get line count
     */
    get length(): number
    /**
     * Render lines to buffer at specified range.
     * Since notifications is used, use `nvim.pauseNotification` & `nvim.resumeNotification`
     * when you need to wait for the request finish.
     *
     * @param {Buffer} buffer
     * @param {number} start
     * @param {number} end
     * @returns {void}
     */
    render(buffer: Buffer, start?: number, end?: number): void
  }

  export interface ListConfiguration {
    get<T>(key: string, defaultValue?: T): T
    previousKey(): string
    nextKey(): string
    dispose(): void
  }

  export interface ListActionOptions {
    persist?: boolean
    reload?: boolean
    parallel?: boolean
  }

  export interface CommandTaskOption {
    /**
     * Command to run.
     */
    cmd: string
    /**
     * Arguments of command.
     */
    args: string[]
    cwd: string
    /**
     * Runs for each line, return undefined for invalid item.
     */
    onLine: (line: string) => ListItem | undefined
  }

  export interface CommandTask extends ListTask {
  }

  export abstract class BasicList implements IList {
    /**
     * Unique name, must be provided by implementation class.
     */
    name: string
    /**
     * Default action name invoked by <cr> by default, must be provided by implementation class.
     */
    defaultAction: string
    /**
     * Registed actions.
     */
    readonly actions: ListAction[]
    /**
     * Arguments configuration of list.
     */
    options: ListArgument[]
    protected nvim: Neovim
    protected disposables: Disposable[]
    protected config: ListConfiguration
    constructor(nvim: Neovim)
    /**
     * Should align columns when true.
     */
    get alignColumns(): boolean
    get hlGroup(): string
    get previewHeight(): string
    get splitRight(): boolean
    /**
     * Parse argument string array for argument object from `this.options`.
     * Could be used inside `this.loadItems()`
     */
    protected parseArguments(args: string[]): { [key: string]: string | boolean }
    /**
     * Get configurations of current list
     */
    protected getConfig(): WorkspaceConfiguration
    /**
     * Add an action
     */
    protected addAction(name: string, fn: (item: ListItem, context: ListContext) => ProviderResult<void>, options?: ListActionOptions): void
    /**
     * Add action that support multiple selection.
     */
    protected addMultipleAction(name: string, fn: (item: ListItem[], context: ListContext) => ProviderResult<void>, options?: ListActionOptions): void
    /**
     * Create task from command task option.
     */
    protected createCommandTask(opt: CommandTaskOption): ListTask
    /**
     * Add location related actions, should be called in constructor.
     */
    protected addLocationActions(): void
    protected convertLocation(location: Location | LocationWithLine | string): Promise<Location>
    /**
     * Jump to location
     *
     * @method
     */
    protected jumpTo(location: Location | LocationWithLine | string, command?: string): Promise<void>
    /**
     * Preview location.
     *
     * @method
     */
    protected previewLocation(location: Location, context: ListContext): Promise<void>
    /**
     * Preview lines.
     *
     * @method
     */
    protected preview(options: PreviewOptions, context: ListContext): Promise<void>
    /**
     * Use for syntax highlights, invoked after buffer loaded.
     */
    doHighlight(): void
    /**
     * Invoked for listItems or listTask, could throw error when failed to load.
     */
    abstract loadItems(context: ListContext, token?: CancellationToken): Promise<ListItem[] | ListTask | null | undefined>
  }

  export class Mutex {
    /**
     * Returns true when task is running.
     */
    get busy(): boolean
    /**
     * Resolved release function that must be called after task finish.
     */
    acquire(): Promise<() => void>
    /**
     * Captrue the async task function that ensures to be executed one by one.
     */
    use<T>(f: () => Promise<T>): Promise<T>
  }
  // }}

  // functions {{

  export interface AnsiItem {
    foreground?: string
    background?: string
    bold?: boolean
    italic?: boolean
    underline?: boolean
    text: string
  }

  export interface ParsedUrlQueryInput {
    [key: string]: unknown
  }

  export interface FetchOptions {
    /**
     * Default to 'GET'
     */
    method?: string
    /**
     * Default no timeout
     */
    timeout?: number
    /**
     * - 'string' for text response content
     * - 'object' for json response content
     * - 'buffer' for response not text or json
     */
    data?: string | { [key: string]: any } | Buffer
    /**
     * Plain object added as query of url
     */
    query?: ParsedUrlQueryInput
    headers?: any
    /**
     * User for http basic auth, should use with password
     */
    user?: string
    /**
     * Password for http basic auth, should use with user
     */
    password?: string
  }

  export interface DownloadOptions extends FetchOptions {
    /**
     * Folder that contains downloaded file or extracted files by untar or unzip
     */
    dest: string
    /**
     * Remove the specified number of leading path elements for *untar* only, default to `1`.
     */
    strip?: number
    /**
     * If true, use untar for `.tar.gz` filename
     */
    extract?: boolean | 'untar' | 'unzip'
    onProgress?: (percent: string) => void
  }

  export type ResponseResult = string | Buffer | {
    [name: string]: any
  }

  /**
   * Parse ansi result from string contains ansi characters.
   */
  export function ansiparse(str: string): AnsiItem[]

  /**
   * Send request to server for response, supports:
   *
   * - Send json data and parse json response.
   * - Throw error for failed response statusCode.
   * - Timeout support (no timeout by default).
   * - Send buffer (as data) and receive data (as response).
   * - Proxy support from user configuration & environment.
   * - Redirect support, limited to 3.
   * - Support of gzip & deflate response content.
   *
   * @return Parsed object if response content type is application/json, text if content type starts with `text/`
   */
  export function fetch(url: string, options?: FetchOptions, token?: CancellationToken): Promise<ResponseResult>

  /**
   * Download file from url, with optional untar/unzip support.
   *
   * Note: you may need to set `strip` to 0 when using untar as extract method.
   *
   * @param {string} url
   * @param {DownloadOptions} options contains dest folder and optional onProgress callback
   */
  export function download(url: string, options: DownloadOptions, token?: CancellationToken): Promise<string>

  interface ExecOptions {
    cwd?: string
    env?: NodeJS.ProcessEnv
    shell?: string
    timeout?: number
    maxBuffer?: number
    killSignal?: string
    uid?: number
    gid?: number
    windowsHide?: boolean
  }

  /**
   * Dispose all disposables.
   */
  export function disposeAll(disposables: Disposable[]): void

  /**
   * Concurrent run async functions with limit support.
   */
  export function concurrent<T>(arr: T[], fn: (val: T) => Promise<void>, limit?: number): Promise<void>

  /**
   * Create promise resolved after ms miliseconds.
   */
  export function wait(ms: number): Promise<any>

  /**
   * Run command with `child_process.exec`
   */
  export function runCommand(cmd: string, opts?: ExecOptions, timeout?: number): Promise<string>

  /**
   * Check if process with pid is running
   */
  export function isRunning(pid: number): boolean

  /**
   * Check if command is executable.
   */
  export function executable(command: string): boolean

  /**
   * Watch single file for change, the filepath needs to be exists file.
   *
   * @param filepath Full path of file.
   * @param onChange Handler on file change detected.
   */
  export function watchFile(filepath: string, onChange: () => void): Disposable
  // }}

  // commands module {{
  export interface CommandItem {
    id: string
    internal?: boolean
    execute(...args: any[]): any
  }
  /**
   * Namespace for dealing with commands of coc.nvim
   */
  export namespace commands {
    /**
     * Registered commands.
     */
    export const commandList: CommandItem[]

    /**
     * Execute specified command.
     *
     * @deprecated use `executeCommand()` instead.
     */
    export function execute(command: { name: string, arguments?: any[] }): void

    /**
     * Check if command is registered.
     *
     * @param id Unique id of command.
     */
    export function has(id: string): boolean

    /**
     * Registers a command that can be invoked via a keyboard shortcut,
     * a menu item, an action, or directly.
     *
     * Registering a command with an existing command identifier twice
     * will cause an error.
     *
     * @param command A unique identifier for the command.
     * @param impl A command handler function.
     * @param thisArg The `this` context used when invoking the handler function.
     * @return Disposable which unregisters this command on disposal.
     */
    export function registerCommand(id: string, impl: (...args: any[]) => void, thisArg?: any, internal?: boolean): Disposable

    /**
     * Executes the command denoted by the given command identifier.
     *
     * * *Note 1:* When executing an editor command not all types are allowed to
     * be passed as arguments. Allowed are the primitive types `string`, `boolean`,
     * `number`, `undefined`, and `null`, as well as [`Position`](#Position), [`Range`](#Range), [`URI`](#URI) and [`Location`](#Location).
     * * *Note 2:* There are no restrictions when executing commands that have been contributed
     * by extensions.
     *
     * @param command Identifier of the command to execute.
     * @param rest Parameters passed to the command function.
     * @return A promise that resolves to the returned value of the given command. `undefined` when
     * the command handler function doesn't return anything.
     */
    export function executeCommand(command: string, ...rest: any[]): Promise<any>

    /**
     * Open uri with external tool, use `open` on mac, use `xdg-open` on linux.
     */
    export function executeCommand(command: 'vscode.open', uri: string | Uri): Promise<void>

    /**
     * Reload current buffer by `:edit` command.
     */
    export function executeCommand(command: 'workbench.action.reloadWindow'): Promise<void>

    /**
     * Insert snippet at range of current buffer.
     *
     * @param edit Contains snippet text and range to replace.
     */
    export function executeCommand(command: 'editor.action.insertSnippet', edit: TextEdit): Promise<boolean>

    /**
     * Invoke specified code action.
     */
    export function executeCommand(command: 'editor.action.doCodeAction', action: CodeAction): Promise<void>

    /**
     * Trigger coc.nvim's completion at current cursor position.
     */
    export function executeCommand(command: 'editor.action.triggerSuggest'): Promise<void>

    /**
     * Trigger signature help at current cursor position.
     */
    export function executeCommand(command: 'editor.action.triggerParameterHints'): Promise<void>

    /**
     * Add ranges to cursors session for multiple cursors.
     */
    export function executeCommand(command: 'editor.action.addRanges', ranges: Range[]): Promise<void>

    /**
     * Restart coc.nvim service by `:CocRestart` command.
     */
    export function executeCommand(command: 'editor.action.restart'): Promise<void>

    /**
     * Show locations by location list or vim's quickfix list.
     */
    export function executeCommand(command: 'editor.action.showReferences', filepath: string | undefined, position: Position | undefined, locations: Location[]): Promise<void>

    /**
     * Invoke rename action at position of specified uri.
     */
    export function executeCommand(command: 'editor.action.rename', uri: string, position: Position): Promise<void>

    /**
     * Run format action for current buffer.
     */
    export function executeCommand(command: 'editor.action.format'): Promise<void>
  }
  // }}

  // events module {{
  type MoveEvents = 'CursorMoved' | 'CursorMovedI'
  type EventResult = void | Promise<void>
  type BufEvents = 'BufHidden' | 'BufEnter' | 'BufWritePost'
    | 'CursorHold' | 'InsertLeave' | 'TermOpen' | 'TermClose' | 'InsertEnter'
    | 'BufCreate' | 'BufUnload' | 'BufWritePre' | 'CursorHoldI' | 'Enter'
  type EmptyEvents = 'FocusGained' | 'InsertSnippet'
  type InsertChangeEvents = 'TextChangedP' | 'TextChangedI'
  type TaskEvents = 'TaskExit' | 'TaskStderr' | 'TaskStdout'
  type WindowEvents = 'WinLeave' | 'WinEnter'
  type AllEvents = BufEvents | EmptyEvents | MoveEvents | TaskEvents | WindowEvents | InsertChangeEvents | 'CompleteDone' | 'TextChanged' | 'MenuPopupChanged' | 'InsertCharPre' | 'FileType' | 'BufWinEnter' | 'BufWinLeave' | 'VimResized' | 'DirChanged' | 'OptionSet' | 'Command' | 'BufReadCmd' | 'GlobalChange' | 'InputChar' | 'WinLeave' | 'MenuInput' | 'PromptInsert' | 'FloatBtnClick' | 'InsertSnippet'
  type OptionValue = string | number | boolean

  export interface CursorPosition {
    bufnr: number
    lnum: number
    col: number
    insert: boolean
  }

  export interface InsertChange {
    lnum: number
    col: number
    pre: string
    changedtick: number
  }

  export interface PopupChangeEvent {
    completed_item: VimCompleteItem
    height: number
    width: number
    row: number
    col: number
    size: number
    scrollbar: boolean
  }

  /**
   * Used for listen to events send from vim.
   */
  export namespace events {
    export const cursor: CursorPosition
    export function on(event: EmptyEvents | AllEvents[], handler: () => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    /**
     * Attach handler to buffer events.
     */
    export function on(event: BufEvents, handler: (bufnr: number) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    /**
     * Attach handler to mouse move events.
     */
    export function on(event: MoveEvents, handler: (bufnr: number, cursor: [number, number]) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    /**
     * Attach handler to TextChangedI or TextChangedP.
     */
    export function on(event: InsertChangeEvents, handler: (bufnr: number, info: InsertChange) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    /**
     * Attach handler to window event.
     */
    export function on(event: WindowEvents, handler: (winid: number) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    /**
     * Attach handler to float button click.
     */
    export function on(event: 'FloatBtnClick', handler: (bufnr: number, index: number) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    export function on(event: 'TextChanged', handler: (bufnr: number, changedtick: number) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    export function on(event: 'TaskExit', handler: (id: string, code: number) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    export function on(event: 'TaskStderr' | 'TaskStdout', handler: (id: string, lines: string[]) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    export function on(event: 'BufReadCmd', handler: (scheme: string, fullpath: string) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    export function on(event: 'VimResized', handler: (columns: number, lines: number) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    export function on(event: 'Command', handler: (name: string) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    export function on(event: 'MenuPopupChanged', handler: (event: PopupChangeEvent, cursorline: number) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    export function on(event: 'CompleteDone', handler: (item: VimCompleteItem) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    export function on(event: 'InsertCharPre', handler: (character: string) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    export function on(event: 'FileType', handler: (filetype: string, bufnr: number) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    export function on(event: 'BufWinEnter' | 'BufWinLeave', handler: (bufnr: number, winid: number) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    export function on(event: 'DirChanged', handler: (cwd: string) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    export function on(event: 'OptionSet' | 'GlobalChange', handler: (option: string, oldVal: OptionValue, newVal: OptionValue) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    export function on(event: 'InputChar', handler: (session: string, character: string, mode: number) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
    export function on(event: 'PromptInsert', handler: (value: string, bufnr: number) => EventResult, thisArg?: any, disposables?: Disposable[]): Disposable
  }
  // }}

  // languages module {{
  export namespace languages {
    /**
     * Create a diagnostics collection.
     *
     * @param name The [name](#DiagnosticCollection.name) of the collection.
     * @return A new diagnostic collection.
     */
    export function createDiagnosticCollection(name?: string): DiagnosticCollection

    /**
     * Register a formatting provider that works on type. The provider is active when the user enables the setting `coc.preferences.formatOnType`.
     *
     * Multiple providers can be registered for a language. In that case providers are sorted
     * by their [score](#languages.match) and the best-matching provider is used. Failure
     * of the selected provider will cause a failure of the whole operation.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider An on type formatting edit provider.
     * @param triggerCharacters Trigger character that should trigger format on type.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerOnTypeFormattingEditProvider(selector: DocumentSelector, provider: OnTypeFormattingEditProvider, triggerCharacters: string[]): Disposable

    /**
     * Register a completion provider.
     *
     * Multiple providers can be registered for a language. In that case providers are sorted
     * by their [score](#languages.match) and groups of equal score are sequentially asked for
     * completion items. The process stops when one or many providers of a group return a
     * result. A failing provider (rejected promise or exception) will not fail the whole
     * operation.
     *
     * A completion item provider can be associated with a set of `triggerCharacters`. When trigger
     * characters are being typed, completions are requested but only from providers that registered
     * the typed character. Because of that trigger characters should be different than [word characters](#LanguageConfiguration.wordPattern),
     * a common trigger character is `.` to trigger member completions.
     *
     * @param name Name of completion source.
     * @param shortcut Shortcut used in completion menu.
     * @param languageIds Language ids of created completion source.
     * @param provider A completion provider.
     * @param triggerCharacters Trigger completion when the user types one of the characters.
     * @param priority Higher priority would shown first.
     * @param allCommitCharacters Commit characters of completion source.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerCompletionItemProvider(name: string, shortcut: string, languageIds: string | string[] | null, provider: CompletionItemProvider, triggerCharacters?: string[], priority?: number, allCommitCharacters?: string[]): Disposable

    /**
     * Register a code action provider.
     *
     * Multiple providers can be registered for a language. In that case providers are asked in
     * parallel and the results are merged. A failing provider (rejected promise or exception) will
     * not cause a failure of the whole operation.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A code action provider.
     * @param clientId Optional id of language client.
     * @param codeActionKinds Optional supported code action kinds.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerCodeActionProvider(selector: DocumentSelector, provider: CodeActionProvider, clientId: string | undefined, codeActionKinds?: string[]): Disposable

    /**
     * Register a hover provider.
     *
     * Multiple providers can be registered for a language. In that case providers are asked in
     * parallel and the results are merged. A failing provider (rejected promise or exception) will
     * not cause a failure of the whole operation.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A hover provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerHoverProvider(selector: DocumentSelector, provider: HoverProvider): Disposable

    /**
     * Register a selection range provider.
     *
     * Multiple providers can be registered for a language. In that case providers are asked in
     * parallel and the results are merged. A failing provider (rejected promise or exception) will
     * not cause a failure of the whole operation.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A selection range provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerSelectionRangeProvider(selector: DocumentSelector, provider: SelectionRangeProvider): Disposable

    /**
     * Register a signature help provider.
     *
     * Multiple providers can be registered for a language. In that case providers are sorted
     * by their [score](#languages.match) and called sequentially until a provider returns a
     * valid result.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A signature help provider.
     * @param triggerCharacters Trigger signature help when the user types one of the characters, like `,` or `(`.
     * @param metadata Information about the provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerSignatureHelpProvider(selector: DocumentSelector, provider: SignatureHelpProvider, triggerCharacters?: string[]): Disposable

    /**
     * Register a document symbol provider.
     *
     * Multiple providers can be registered for a language. In that case providers only first provider
     * are asked for result.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A document symbol provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerDocumentSymbolProvider(selector: DocumentSelector, provider: DocumentSymbolProvider): Disposable

    /**
     * Register a folding range provider.
     *
     * Multiple providers can be registered for a language. In that case providers only first provider
     * are asked for result.
     *
     * A failing provider (rejected promise or exception) will
     * not cause a failure of the whole operation.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A folding range provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerFoldingRangeProvider(selector: DocumentSelector, provider: FoldingRangeProvider): Disposable

    /**
     * Register a document highlight provider.
     *
     * Multiple providers can be registered for a language. In that case providers are sorted
     * by their [score](#languages.match) and groups sequentially asked for document highlights.
     * The process stops when a provider returns a `non-falsy` or `non-failure` result.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A document highlight provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerDocumentHighlightProvider(selector: DocumentSelector, provider: any): Disposable

    /**
     * Register a code lens provider.
     *
     * Multiple providers can be registered for a language. In that case providers are asked in
     * parallel and the results are merged. A failing provider (rejected promise or exception) will
     * not cause a failure of the whole operation.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A code lens provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerCodeLensProvider(selector: DocumentSelector, provider: CodeLensProvider): Disposable

    /**
     * Register a document link provider.
     *
     * Multiple providers can be registered for a language. In that case providers are asked in
     * parallel and the results are merged. A failing provider (rejected promise or exception) will
     * not cause a failure of the whole operation.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A document link provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerDocumentLinkProvider(selector: DocumentSelector, provider: DocumentLinkProvider): Disposable

    /**
     * Register a color provider.
     *
     * Multiple providers can be registered for a language. In that case providers are asked in
     * parallel and the results are merged. A failing provider (rejected promise or exception) will
     * not cause a failure of the whole operation.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A color provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerDocumentColorProvider(selector: DocumentSelector, provider: DocumentColorProvider): Disposable

    /**
     * Register a definition provider.
     *
     * Multiple providers can be registered for a language. In that case providers are asked in
     * parallel and the results are merged. A failing provider (rejected promise or exception) will
     * not cause a failure of the whole operation.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A definition provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerDefinitionProvider(selector: DocumentSelector, provider: DefinitionProvider): Disposable

    /**
     * Register a declaration provider.
     *
     * Multiple providers can be registered for a language. In that case providers are asked in
     * parallel and the results are merged. A failing provider (rejected promise or exception) will
     * not cause a failure of the whole operation.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A declaration provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerDeclarationProvider(selector: DocumentSelector, provider: DeclarationProvider): Disposable


    /**
     * Register a type definition provider.
     *
     * Multiple providers can be registered for a language. In that case providers are asked in
     * parallel and the results are merged. A failing provider (rejected promise or exception) will
     * not cause a failure of the whole operation.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A type definition provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerTypeDefinitionProvider(selector: DocumentSelector, provider: TypeDefinitionProvider): Disposable

    /**
     * Register an implementation provider.
     *
     * Multiple providers can be registered for a language. In that case providers are asked in
     * parallel and the results are merged. A failing provider (rejected promise or exception) will
     * not cause a failure of the whole operation.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider An implementation provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerImplementationProvider(selector: DocumentSelector, provider: ImplementationProvider): Disposable

    /**
     * Register a reference provider.
     *
     * Multiple providers can be registered for a language. In that case providers are asked in
     * parallel and the results are merged. A failing provider (rejected promise or exception) will
     * not cause a failure of the whole operation.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A reference provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerReferencesProvider(selector: DocumentSelector, provider: ReferenceProvider): Disposable

    /**
     * Register a rename provider.
     *
     * Multiple providers can be registered for a language. In that case providers are sorted
     * by their [score](#languages.match) and asked in sequence. The first provider producing a result
     * defines the result of the whole operation.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A rename provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerRenameProvider(selector: DocumentSelector, provider: RenameProvider): Disposable

    /**
     * Register a workspace symbol provider.
     *
     * Multiple providers can be registered. In that case providers are asked in parallel and
     * the results are merged. A failing provider (rejected promise or exception) will not cause
     * a failure of the whole operation.
     *
     * @param provider A workspace symbol provider.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerWorkspaceSymbolProvider(provider: WorkspaceSymbolProvider): Disposable

    /**
     * Register a formatting provider for a document.
     *
     * Multiple providers can be registered for a language. In that case providers are sorted
     * by their priority. Failure of the selected provider will cause a failure of the whole operation.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A document formatting edit provider.
     * @param priority default to 0.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerDocumentFormatProvider(selector: DocumentSelector, provider: DocumentFormattingEditProvider, priority?: number): Disposable

    /**
     * Register a formatting provider for a document range.
     *
     * *Note:* A document range provider is also a [document formatter](#DocumentFormattingEditProvider)
     * which means there is no need to [register](#languages.registerDocumentFormattingEditProvider) a document
     * formatter when also registering a range provider.
     *
     * Multiple providers can be registered for a language. In that case provider with highest priority is used.
     * Failure of the selected provider will cause a failure of the whole operation.
     *
     * @param selector A selector that defines the documents this provider is applicable to.
     * @param provider A document range formatting edit provider.
     * @param priority default to 0.
     * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
     */
    export function registerDocumentRangeFormatProvider(selector: DocumentSelector, provider: DocumentRangeFormattingEditProvider, priority?: number): Disposable
  }
  // }}

  // services module {{
  export enum ServiceStat {
    Initial,
    Starting,
    StartFailed,
    Running,
    Stopping,
    Stopped,
  }

  export interface IServiceProvider {
    // unique service id
    id: string
    name: string
    client?: LanguageClient
    selector: DocumentSelector
    // current state
    state: ServiceStat
    start(): Promise<void>
    dispose(): void
    stop(): Promise<void> | void
    restart(): Promise<void> | void
    onServiceReady: Event<void>
  }

  export namespace services {
    /**
     * Register languageClient as service provider.
     */
    export function registLanguageClient(client: LanguageClient): Disposable
    /**
     * Register service, nothing happens when `service.id` already exists.
     */
    export function regist(service: IServiceProvider): Disposable
    /**
     * Get service by id.
     */
    export function getService(id: string): IServiceProvider
    /**
     * Stop service by id.
     */
    export function stop(id: string): Promise<void>
    /**
     * Stop running service or start stopped service.
     */
    export function toggle(id: string): Promise<void>
  }
  // }}

  // sources module {{
  /**
   * Source options to create source that could respect configuration from `coc.source.{name}`
   */
  export type SourceConfig = Omit<ISource, 'shortcut' | 'priority' | 'triggerOnly' | 'triggerCharacters' | 'triggerPatterns' | 'enable' | 'filetypes' | 'disableSyntaxes'>

  export interface SourceStat {
    name: string
    priority: number
    triggerCharacters: string[]
    type: 'native' | 'remote' | 'service'
    shortcut: string
    filepath: string
    disabled: boolean
    filetypes: string[]
  }

  export enum SourceType {
    Native,
    Remote,
    Service,
  }

  export interface CompleteResult {
    items: VimCompleteItem[]
    isIncomplete?: boolean
    startcol?: number
    source?: string
    priority?: number
  }

  // option on complete & should_complete
  export interface CompleteOption {
    /**
     * Current buffer number.
     */
    readonly bufnr: number
    /**
     * Current line.
     */
    readonly line: string
    /**
     * Column to start completion, determined by iskeyword options of buffer.
     */
    readonly col: number
    /**
     * Input text.
     */
    readonly input: string
    readonly filetype: string
    readonly filepath: string
    /**
     * Word under cursor.
     */
    readonly word: string
    /**
     * Trigger character, could be empty string.
     */
    readonly triggerCharacter: string
    /**
     * Col of cursor, 1 based.
     */
    readonly colnr: number
    readonly linenr: number
    readonly synname: string
    /**
     * Black list words specified by user.
     */
    readonly blacklist: string[]
    /**
     * Buffer changetick
     */
    readonly changedtick: number
    /**
     * Is trigger for in complete completion.
     */
    readonly triggerForInComplete?: boolean
  }

  export interface ISource {
    /**
     * Identifier name
     */
    name: string
    filetypes?: string[]
    enable?: boolean
    shortcut?: string
    priority?: number
    sourceType?: SourceType
    /**
     * Should only be used when completion is triggered, requirs `triggerPatterns` or `triggerCharacters` defined.
     */
    triggerOnly?: boolean
    triggerCharacters?: string[]
    // regex to detect trigger completetion, ignored when triggerCharacters exists.
    triggerPatterns?: RegExp[]
    disableSyntaxes?: string[]
    filepath?: string
    // should the first character always match
    firstMatch?: boolean
    refresh?(): Promise<void>
    /**
     * For disable/enable
     */
    toggle?(): void

    /**
     * Triggered on BufEnter, used for cache normally
     */
    onEnter?(bufnr: number): void

    /**
     * Check if this source should doComplete
     *
     * @public
     * @param {CompleteOption} opt
     * @returns {Promise<boolean> }
     */
    shouldComplete?(opt: CompleteOption): Promise<boolean>

    /**
     * Run completetion
     *
     * @public
     * @param {CompleteOption} opt
     * @param {CancellationToken} token
     * @returns {Promise<CompleteResult | null>}
     */
    doComplete(opt: CompleteOption, token: CancellationToken): ProviderResult<CompleteResult>

    /**
     * Action for complete item on complete item selected
     *
     * @public
     * @param {VimCompleteItem} item
     * @param {CancellationToken} token
     * @returns {Promise<void>}
     */
    onCompleteResolve?(item: VimCompleteItem, token: CancellationToken): ProviderResult<void>

    /**
     * Action for complete item on complete done
     *
     * @public
     * @param {VimCompleteItem} item
     * @returns {Promise<void>}
     */
    onCompleteDone?(item: VimCompleteItem, opt: CompleteOption): ProviderResult<void>

    shouldCommit?(item: VimCompleteItem, character: string): boolean
  }

  export namespace sources {
    /**
     * Names of registed sources.
     */
    export const names: ReadonlyArray<string>
    export const sources: ReadonlyArray<ISource>
    /**
     * Check if source exists by name.
     */
    export function has(name: string): boolean
    /**
     * Get source by name.
     */
    export function getSource(name: string): ISource | null

    /**
     * Add source to sources list.
     *
     * Note: Use `sources.createSource()` for regist new source is recommended for
     * user configuration support.
     */
    export function addSource(source: ISource): Disposable

    /**
     * Create source by source config, configurations starts with `coc.source.{name}`
     * are automatically supported.
     *
     * `name` and `doComplete()` must be provided in config.
     */
    export function createSource(config: SourceConfig): Disposable

    /**
     * Get list of all source stats.
     */
    export function sourceStats(): SourceStat[]

    /**
     * Call refresh for _name_ source or all sources.
     */
    export function refresh(name?: string): Promise<void>

    /**
     * Toggle state of _name_ source.
     */
    export function toggleSource(name: string): void

    /**
     * Remove source by name.
     */
    export function removeSource(name: string): void
  }
  // }}

  // workspace module {{
  /**
   * An event describing the change in Configuration
   */
  export interface ConfigurationChangeEvent {

    /**
     * Returns `true` if the given section for the given resource (if provided) is affected.
     *
     * @param section Configuration name, supports _dotted_ names.
     * @param resource A resource URI.
     * @return `true` if the given section for the given resource (if provided) is affected.
     */
    affectsConfiguration(section: string, resource?: string): boolean
  }

  export interface WillSaveEvent extends TextDocumentWillSaveEvent {
    /**
     * Allows to pause the event loop and to apply [pre-save-edits](#TextEdit).
     * Edits of subsequent calls to this function will be applied in order. The
     * edits will be *ignored* if concurrent modifications of the document happened.
     *
     * *Note:* This function can only be called during event dispatch and not
     * in an asynchronous manner:
     *
     * ```ts
     * workspace.onWillSaveTextDocument(event => {
     * 	// async, will *throw* an error
     * 	setTimeout(() => event.waitUntil(promise));
     *
     * 	// sync, OK
     * 	event.waitUntil(promise);
     * })
     * ```
     *
     * @param thenable A thenable that resolves to [pre-save-edits](#TextEdit).
     */
    waitUntil(thenable: Thenable<TextEdit[] | any>): void
  }

  export interface KeymapOption {
    /**
     * Use request instead of notify, default true
     */
    sync: boolean
    /**
     * Cancel completion before invoke callback, default true
     */
    cancel: boolean
    /**
     * Use <silent> for keymap, default false
     */
    silent: boolean
    /**
     * Enable repeat support for repeat.vim, default false
     */
    repeat: boolean
  }

  export interface DidChangeTextDocumentParams {
    /**
     * The document that did change. The version number points
     * to the version after all provided content changes have
     * been applied.
     */
    textDocument: {
      version: number
      uri: string
    }
    /**
     * The actual content changes. The content changes describe single state changes
     * to the document. So if there are two content changes c1 (at array index 0) and
     * c2 (at array index 1) for a document in state S then c1 moves the document from
     * S to S' and c2 from S' to S''. So c1 is computed on the state S and c2 is computed
     * on the state S'.
     */
    contentChanges: TextDocumentContentChange[]
    /**
     * Buffer number of document.
     */
    bufnr: number
    /**
     * Original content before change
     */
    original: string
  }

  export interface EditerState {
    document: TextDocument
    position: Position
  }

  export type MapMode = 'n' | 'i' | 'v' | 'x' | 's' | 'o'

  export interface Autocmd {
    /**
     * Vim event or event set.
     */
    event: string | string[]
    /**
     * Callback functions that called with evaled arguments.
     */
    callback: Function
    /**
     * Match pattern, default to `*`.
     */
    pattern?: string
    /**
     * Vim expression that eval to arguments of callback, default to `[]`
     */
    arglist?: string[]
    /**
     * Use request when `true`, use notification by default.
     */
    request?: boolean
    /**
     * `this` of callback.
     */
    thisArg?: any
  }

  export interface Env {
    /**
     * |completeopt| option of (neo)vim.
     */
    readonly completeOpt: string
    /**
     * |runtimepath| option of (neo)vim.
     */
    readonly runtimepath: string
    /**
     * |guicursor| option of (neo)vim
     */
    readonly guicursor: string
    /**
     * Could use float window on neovim, always false on vim.
     */
    readonly floating: boolean
    /**
     * |sign_place()| and |sign_unplace()| can be used when true.
     */
    readonly sign: boolean
    /**
     * Root directory of extensions.
     */
    readonly extensionRoot: string
    /**
     * Process id of (neo)vim.
     */
    readonly pid: number
    /**
     * Total columns of screen.
     */
    readonly columns: number
    /**
     * Total lines of screen.
     */
    readonly lines: number
    /**
     * Is true when |CompleteChanged| event is supported.
     */
    readonly pumevent: boolean
    /**
     * |cmdheight| option of (neo)vim.
     */
    readonly cmdheight: number
    /**
     * Value of |g:coc_filetype_map|
     */
    readonly filetypeMap: { [index: string]: string }
    /**
     * Is true when not using neovim.
     */
    readonly isVim: boolean
    /**
     * Is cygvim when true.
     */
    readonly isCygwin: boolean
    /**
     * Is macvim when true.
     */
    readonly isMacvim: boolean
    /**
     * Is true when iTerm.app is used on mac.
     */
    readonly isiTerm: boolean
    /**
     * version of (neo)vim, on vim it's like: 8020750, on neoivm it's like: 0.5.0
     */
    readonly version: string
    /**
     * |v:progpath| value, could be empty.
     */
    readonly progpath: string
    /**
     * Is true when dialog feature is supported, which need vim >= 8.2.750 or neovim >= 0.4.0
     */
    readonly dialog: boolean
    /**
     * Is true when vim's textprop is supported.
     */
    readonly textprop: boolean
  }

  export interface TerminalOptions {
    /**
     * A human-readable string which will be used to represent the terminal in the UI.
     */
    name?: string

    /**
     * A path to a custom shell executable to be used in the terminal.
     */
    shellPath?: string

    /**
     * Args for the custom shell executable, this does not work on Windows (see #8429)
     */
    shellArgs?: string[]

    /**
     * A path or URI for the current working directory to be used for the terminal.
     */
    cwd?: string

    /**
     * Object with environment variables that will be added to the VS Code process.
     */
    env?: { [key: string]: string | null }

    /**
     * Whether the terminal process environment should be exactly as provided in
     * `TerminalOptions.env`. When this is false (default), the environment will be based on the
     * window's environment and also apply configured platform settings like
     * `terminal.integrated.windows.env` on top. When this is true, the complete environment
     * must be provided as nothing will be inherited from the process or any configuration.
     */
    strictEnv?: boolean
  }

  /**
   * An individual terminal instance within the integrated terminal.
   */
  export interface Terminal {

    /**
     * The bufnr of terminal buffer.
     */
    readonly bufnr: number

    /**
     * The name of the terminal.
     */
    readonly name: string

    /**
     * The process ID of the shell process.
     */
    readonly processId: Promise<number>

    /**
     * Send text to the terminal. The text is written to the stdin of the underlying pty process
     * (shell) of the terminal.
     *
     * @param text The text to send.
     * @param addNewLine Whether to add a new line to the text being sent, this is normally
     * required to run a command in the terminal. The character(s) added are \n or \r\n
     * depending on the platform. This defaults to `true`.
     */
    sendText(text: string, addNewLine?: boolean): void

    /**
     * Show the terminal panel and reveal this terminal in the UI, return false when failed.
     *
     * @param preserveFocus When `true` the terminal will not take focus.
     */
    show(preserveFocus?: boolean): Promise<boolean>

    /**
     * Hide the terminal panel if this terminal is currently showing.
     */
    hide(): void

    /**
     * Dispose and free associated resources.
     */
    dispose(): void
  }

  export interface Document {
    readonly buffer: Buffer
    /**
     * Document is attached to vim.
     */
    readonly attached: boolean
    /**
     * Is command line document.
     */
    readonly isCommandLine: boolean
    /**
     * `buftype` option of buffer.
     */
    readonly buftype: string
    /**
     * Text document that synchronized.
     */
    readonly textDocument: TextDocument
    /**
     * Fired when document change.
     */
    readonly onDocumentChange: Event<DidChangeTextDocumentParams>
    /**
     * Fired on document detach.
     */
    readonly onDocumentDetach: Event<number>
    /**
     * Get current buffer changedtick.
     */
    readonly changedtick: number
    /**
     * Scheme of document.
     */
    readonly schema: string
    /**
     * Line count of current buffer.
     */
    readonly lineCount: number
    /**
     * Window ID when buffer create, could be -1 when no window associated.
     */
    readonly winid: number
    /**
     * Returns if current document is opended with previewwindow
     */
    readonly previewwindow: boolean
    /**
     * Check if document changed after last synchronize
     */
    readonly dirty: boolean
    /**
     * Buffer number
     */
    readonly bufnr: number
    /**
     * Content of textDocument.
     */
    readonly content: string
    /**
     * Coverted filetype.
     */
    readonly filetype: string
    readonly uri: string
    readonly version: number
    /**
     * Apply textEdits to current buffer lines, fire content change event.
     */
    applyEdits(edits: TextEdit[]): Promise<void>

    /**
     * Change individual lines.
     *
     * @param {[number, string][]} lines
     * @returns {void}
     */
    changeLines(lines: [number, string][]): Promise<void>

    /**
     * Force document synchronize and emit change event when necessary.
     */
    forceSync(): void

    /**
     * Get offset from lnum & col
     */
    getOffset(lnum: number, col: number): number

    /**
     * Check string is word.
     */
    isWord(word: string): boolean

    /**
     * Word range at position.
     *
     * @param {Position} position
     * @param {string} extraChars Extra characters that should be keyword.
     * @param {boolean} current Use current lines instead of textDocument, default to true.
     * @returns {Range | null}
     */
    getWordRangeAtPosition(position: Position, extraChars?: string, current?: boolean): Range | null

    /**
     * Get ranges of word in textDocument.
     */
    getSymbolRanges(word: string): Range[]

    /**
     * Get line for buffer
     *
     * @param {number} line 0 based line index.
     * @param {boolean} current Use textDocument lines when false, default to true.
     * @returns {string}
     */
    getline(line: number, current?: boolean): string

    /**
     * Get range of current lines, zero indexed, end exclude.
     */
    getLines(start?: number, end?: number): string[]

    /**
     * Get variable value by key, defined by `b:coc_{key}`
     */
    getVar<T>(key: string, defaultValue?: T): T

    /**
     * Get position from lnum & col
     */
    getPosition(lnum: number, col: number): Position

    /**
     * Adjust col with new valid character before position.
     */
    fixStartcol(position: Position, valids: string[]): number

    /**
     * Get current content text.
     */
    getDocumentContent(): string
  }

  /**
   * Store & retrive most recent used items.
   */
  export interface Mru {
    /**
     * Load iems from mru file
     */

    load(): Promise<string[]>
    /**
     * Add item to mru file.
     */
    add(item: string): Promise<void>

    /**
     * Remove item from mru file.
     */

    remove(item: string): Promise<void>

    /**
     * Remove the data file.
     */
    clean(): Promise<void>
  }

  /**
   * Option to create task that runs in (neo)vim.
   */
  export interface TaskOptions {
    /**
     *  The command to run, without arguments
     */
    cmd: string
    /**
     * Arguments of command.
     */
    args?: string[]
    /**
     * Current working directory of the task, Default to current vim's cwd.
     */
    cwd?: string
    /**
     * Additional environment key-value pairs.
     */
    env?: { [key: string]: string }
    /**
     * Use pty when true.
     */
    pty?: boolean
    /**
     * Detach child process when true.
     */
    detach?: boolean
  }

  /**
   * Controls long running task started by (neo)vim.
   * Useful to keep the task running after CocRestart.
   */
  export interface Task extends Disposable {
    /**
     * Fired on task exit with exit code.
     */
    onExit: Event<number>
    /**
     * Fired with lines on stdout received.
     */
    onStdout: Event<string[]>
    /**
     * Fired with lines on stderr received.
     */
    onStderr: Event<string[]>
    /**
     * Start task, task will be restarted when already running.
     *
     * @param {TaskOptions} opts
     * @returns {Promise<boolean>}
     */
    start(opts: TaskOptions): Promise<boolean>
    /**
     * Stop task by SIGTERM or SIGKILL
     */
    stop(): Promise<void>
    /**
     * Check if the task is running.
     */
    running: Promise<boolean>
  }

  /**
   * A simple json database.
   */
  export interface JsonDB {
    filepath: string
    /**
     * Get data by key.
     *
     * @param {string} key unique key allows dot notation.
     * @returns {any}
     */
    fetch(key: string): any
    /**
     * Check if key exists
     *
     * @param {string} key unique key allows dot notation.
     */
    exists(key: string): boolean
    /**
     * Delete data by key
     *
     * @param {string} key unique key allows dot notation.
     */
    delete(key: string): void
    /**
     * Save data with key
     */
    push(key: string, data: number | null | boolean | string | { [index: string]: any }): void
    /**
     * Empty db file.
     */
    clear(): void
    /**
     * Remove db file.
     */
    destroy(): void
  }

  export interface RenameEvent {
    oldUri: Uri
    newUri: Uri
  }

  export interface FileSystemWatcher {
    readonly ignoreCreateEvents: boolean
    readonly ignoreChangeEvents: boolean
    readonly ignoreDeleteEvents: boolean
    readonly onDidCreate: Event<Uri>
    readonly onDidChange: Event<Uri>
    readonly onDidDelete: Event<Uri>
    readonly onDidRename: Event<RenameEvent>
    dispose(): void
  }

  export interface ConfigurationInspect<T> {
    key: string
    defaultValue?: T
    globalValue?: T
    workspaceValue?: T
  }

  export interface WorkspaceConfiguration {
    /**
     * Return a value from this configuration.
     *
     * @param section Configuration name, supports _dotted_ names.
     * @return The value `section` denotes or `undefined`.
     */
    get<T>(section: string): T | undefined

    /**
     * Return a value from this configuration.
     *
     * @param section Configuration name, supports _dotted_ names.
     * @param defaultValue A value should be returned when no value could be found, is `undefined`.
     * @return The value `section` denotes or the default.
     */
    get<T>(section: string, defaultValue: T): T

    /**
     * Check if this configuration has a certain value.
     *
     * @param section Configuration name, supports _dotted_ names.
     * @return `true` if the section doesn't resolve to `undefined`.
     */
    has(section: string): boolean

    /**
     * Retrieve all information about a configuration setting. A configuration value
     * often consists of a *default* value, a global or installation-wide value,
     * a workspace-specific value
     *
     * *Note:* The configuration name must denote a leaf in the configuration tree
     * (`editor.fontSize` vs `editor`) otherwise no result is returned.
     *
     * @param section Configuration name, supports _dotted_ names.
     * @return Information about a configuration setting or `undefined`.
     */
    inspect<T>(section: string): ConfigurationInspect<T> | undefined
    /**
     * Update a configuration value. The updated configuration values are persisted.
     *
     *
     * @param section Configuration name, supports _dotted_ names.
     * @param value The new value.
     * @param isUser if true, always update user configuration
     */
    update(section: string, value: any, isUser?: boolean): void

    /**
     * Readable dictionary that backs this configuration.
     */
    readonly [key: string]: any
  }

  export interface BufferSyncItem {
    /**
     * Called on buffer unload.
     */
    dispose: () => void
    /**
     * Called on buffer change.
     */
    onChange?(e: DidChangeTextDocumentParams): void
  }

  export namespace workspace {
    export const nvim: Neovim
    /**
     * Current buffer number, could be wrong since vim could not send autocmd as expected.
     *
     * @deprecated will be removed in the feature.
     */
    export const bufnr: number
    /**
     * Current document.
     */
    export const document: Promise<Document>
    /**
     * Environments or current (neo)vim.
     */
    export const env: Env
    /**
     * Float window or popup can work.
     */
    export const floatSupported: boolean
    /**
     * Current working directory of vim.
     */
    export const cwd: string
    /**
     * Current workspace root.
     */
    export const root: string
    /**
     * @deprecated aliased to root.
     */
    export const rootPath: string
    /**
     * Not neovim when true.
     */
    export const isVim: boolean
    /**
     * Is neovim when true.
     */
    export const isNvim: boolean
    /**
     * Is true when current mode is insert, could be wrong when user cancel insert by <C-c>
     *
     * @deprecated
     */
    export const insertMode: boolean
    /**
     * All filetypes of loaded documents.
     */
    export const filetypes: ReadonlySet<string>
    /**
     * Root directory of coc.nvim
     */
    export const pluginRoot: string
    /**
     * Current `&completeopt` of vim, may not correct.
     */
    export const completeOpt: string
    /**
     * Exists channel names.
     */
    export const channelNames: ReadonlyArray<string>
    /**
     * Current document array.
     */
    export const documents: ReadonlyArray<Document>
    /**
     * Current document array.
     */
    export const textDocuments: ReadonlyArray<TextDocument>
    /**
     * Current workspace folders.
     */
    export const workspaceFolders: ReadonlyArray<WorkspaceFolder>
    /**
     * Directory paths of workspaceFolders.
     */
    export const folderPaths: ReadonlyArray<string>
    /**
     * Current workspace folder, could be null when vim started from user's home.
     */
    export const workspaceFolder: WorkspaceFolder | null
    /**
     * Event fired after terminal created, only fired with Terminal that created
     * by `workspace.createTerminal`
     */
    export const onDidOpenTerminal: Event<Terminal>
    /**
     * Event fired on terminal close, only fired with Terminal that created by
     * `workspace.createTerminal`
     */
    export const onDidCloseTerminal: Event<Terminal>
    /**
     * Event fired on workspace folder change.
     */
    export const onDidChangeWorkspaceFolders: Event<WorkspaceFoldersChangeEvent>
    /**
     * Event fired after document create.
     */
    export const onDidOpenTextDocument: Event<TextDocument & { bufnr: number }>
    /**
     * Event fired after document unload.
     */
    export const onDidCloseTextDocument: Event<TextDocument & { bufnr: number }>
    /**
     * Event fired on document change.
     */
    export const onDidChangeTextDocument: Event<DidChangeTextDocumentParams>
    /**
     * Event fired before document save.
     */
    export const onWillSaveTextDocument: Event<WillSaveEvent>
    /**
     * Event fired after document save.
     */
    export const onDidSaveTextDocument: Event<TextDocument>

    /**
     * Event fired on configuration change. Configuration change could by many
     * reasons, including:
     *
     * - Changes detected from `coc-settings.json`.
     * - Change to document that using another configuration file.
     * - Configuration change by call update API of WorkspaceConfiguration.
     */
    export const onDidChangeConfiguration: Event<ConfigurationChangeEvent>

    /**
     * Fired when vim's runtimepath change detected.
     */
    export const onDidRuntimePathChange: Event<ReadonlyArray<string>>

    /**
     * Create new namespace id by name.
     */
    export function createNameSpace(name: string): number

    /**
     * Register autocmd on vim.
     *
     * Note: avoid request autocmd when possible since vim could be blocked
     * forever when request triggered during request.
     */
    export function registerAutocmd(autocmd: Autocmd): Disposable

    /**
     * Watch for vim's global option change.
     */
    export function watchOption(key: string, callback: (oldValue: any, newValue: any) => Thenable<void> | void, disposables?: Disposable[]): void

    /**
     * Watch for vim's global variable change, works on neovim only.
     */
    export function watchGlobal(key: string, callback?: (oldValue: any, newValue: any) => Thenable<void> | void, disposables?: Disposable[]): void

    /**
     * Check if selector match document.
     */
    export function match(selector: DocumentSelector, document: TextDocument): number

    /**
     * Findup from filename or filenames from current filepath or root.
     *
     * @return fullpath of file or null when not found.
     */
    export function findUp(filename: string | string[]): Promise<string | null>

    /**
     * Resolve root folder of uri with match patterns.
     * Cwd is returned when uri is not file scheme.
     * Parent folder of uri is returned when failed to resolve.
     *
     * @deprecated avoid use it when possible.
     */
    export function resolveRootFolder(uri: Uri, patterns: string[]): Promise<string>

    /**
     * Get possible watchman binary path.
     */
    export function getWatchmanPath(): string | null

    /**
     * Get configuration by section and optional resource uri.
     */
    export function getConfiguration(section?: string, resource?: string): WorkspaceConfiguration

    /**
     * Get created document by uri or bufnr.
     */
    export function getDocument(uri: number | string): Document

    /**
     * Apply WorkspaceEdit.
     */
    export function applyEdit(edit: WorkspaceEdit): Promise<boolean>

    /**
     * Convert location to quickfix item.
     */
    export function getQuickfixItem(loc: Location | LocationLink, text?: string, type?: string, module?: string): Promise<QuickfixItem>

    /**
     * Get selected range for current document
     */
    export function getSelectedRange(visualmode: string, document: Document): Promise<Range | null>

    /**
     * Visual select range of current document
     */
    export function selectRange(range: Range): Promise<void>

    /**
     * Populate locations to UI.
     */
    export function showLocations(locations: Location[]): Promise<void>

    /**
     * Get content of line by uri and line.
     */
    export function getLine(uri: string, line: number): Promise<string>

    /**
     * Get WorkspaceFolder of uri
     */
    export function getWorkspaceFolder(uri: string): WorkspaceFolder | null

    /**
     * Get content from buffer of file by uri.
     */
    export function readFile(uri: string): Promise<string>

    /**
     * Get current document and position.
     */
    export function getCurrentState(): Promise<EditerState>

    /**
     * Get format options of uri or current buffer.
     */
    export function getFormatOptions(uri?: string): Promise<FormattingOptions>

    /**
     * Jump to location.
     */
    export function jumpTo(uri: string, position?: Position | null, openCommand?: string): Promise<void>

    /**
     * Create a file in vim and disk
     */
    export function createFile(filepath: string, opts?: CreateFileOptions): Promise<void>

    /**
     * Load uri as document, buffer would be invisible if not loaded.
     */
    export function loadFile(uri: string): Promise<Document>

    /**
     * Load the files that not loaded
     */
    export function loadFiles(uris: string[]): Promise<void>

    /**
     * Rename file in vim and disk
     */
    export function renameFile(oldPath: string, newPath: string, opts?: RenameFileOptions): Promise<void>

    /**
     * Delete file from vim and disk.
     */
    export function deleteFile(filepath: string, opts?: DeleteFileOptions): Promise<void>

    /**
     * Open resource by uri
     */
    export function openResource(uri: string): Promise<void>

    /**
     * Resovle full path of module from yarn or npm global directory.
     */
    export function resolveModule(name: string): Promise<string>

    /**
     * Run nodejs command
     */
    export function runCommand(cmd: string, cwd?: string, timeout?: number): Promise<string>

    /**
     * Expand filepath with `~` and/or environment placeholders
     */
    export function expand(filepath: string): string

    /**
     * Call a function by use notifications, useful for functions like |input| that could block vim.
     */
    export function callAsync<T>(method: string, args: any[]): Promise<T>

    /**
     * registerTextDocumentContentProvider
     */
    export function registerTextDocumentContentProvider(scheme: string, provider: TextDocumentContentProvider): Disposable

    /**
     * Register unique keymap uses `<Plug>(coc-{key})` as lhs
     * Throw error when {key} already exists.
     *
     * @param {MapMode[]} modes - array of 'n' | 'i' | 'v' | 'x' | 's' | 'o'
     * @param {string} key - unique name
     * @param {Function} fn - callback function
     * @param {Partial} opts
     * @returns {Disposable}
     */
    export function registerKeymap(modes: MapMode[], key: string, fn: () => ProviderResult<any>, opts?: Partial<KeymapOption>): Disposable

    /**
     * Register expr key-mapping.
     */
    export function registerExprKeymap(mode: 'i' | 'n' | 'v' | 's' | 'x', key: string, fn: () => ProviderResult<string>, buffer?: boolean): Disposable

    /**
     * Register local key-mapping.
     */
    export function registerLocalKeymap(mode: 'n' | 'v' | 's' | 'x', key: string, fn: () => ProviderResult<any>, notify?: boolean): Disposable

    /**
     * Register for buffer sync objects, created item should be disposable
     * and provide optional `onChange` which called when document change.
     *
     * The document is always attached and not command line buffer.
     * 
     * @param create Called for each attached document and on document create.
     * @returns Disposable
     */
    export function registerBufferSync<T extends BufferSyncItem>(create: (doc: Document) => T): Disposable

    /**
     * Create a FileSystemWatcher instance, when watchman not exists, the
     * returned FileSystemWatcher can stil be used, but not work at all.
     */
    export function createFileSystemWatcher(globPattern: string, ignoreCreate?: boolean, ignoreChange?: boolean, ignoreDelete?: boolean): FileSystemWatcher
    /**
     * Create persistence Mru instance.
     */
    export function createMru(name: string): Mru

    /**
     * Create Task instance that runs in (neo)vim, no shell.
     *
     * @param id Unique id string, like `TSC`
     */
    export function createTask(id: string): Task

    /**
     * Create terminal in (neo)vim.
     */
    export function createTerminal(opts: TerminalOptions): Promise<Terminal>

    /**
     * Create DB instance at extension root.
     */
    export function createDatabase(name: string): JsonDB
  }
  // }}

  // window module {{
  /**
   * Option for create status item.
   */
  export interface StatusItemOption {
    progress?: boolean
  }

  /**
   * Status item that included in `g:coc_status`
   */
  export interface StatusBarItem {
    /**
     * The priority of this item. Higher value means the item should
     * be shown more to the left.
     */
    readonly priority: number

    isProgress: boolean

    /**
     * The text to show for the entry. You can embed icons in the text by leveraging the syntax:
     *
     * `My text $(icon-name) contains icons like $(icon-name) this one.`
     *
     * Where the icon-name is taken from the [octicon](https://octicons.github.com) icon set, e.g.
     * `light-bulb`, `thumbsup`, `zap` etc.
     */
    text: string

    /**
     * Shows the entry in the status bar.
     */
    show(): void

    /**
     * Hide the entry in the status bar.
     */
    hide(): void

    /**
     * Dispose and free associated resources. Call
     * [hide](#StatusBarItem.hide).
     */
    dispose(): void
  }

  /**
   * Value-object describing where and how progress should show.
   */
  export interface ProgressOptions {

    /**
     * A human-readable string which will be used to describe the
     * operation.
     */
    title?: string

    /**
     * Controls if a cancel button should show to allow the user to
     * cancel the long running operation.
     */
    cancellable?: boolean
  }

  /**
   * Defines a generalized way of reporting progress updates.
   */
  export interface Progress<T> {

    /**
     * Report a progress update.
     *
     * @param value A progress item, like a message and/or an
     * report on how much work finished
     */
    report(value: T): void
  }

  /**
   * Represents an action that is shown with an information, warning, or
   * error message.
   *
   * @see [showInformationMessage](#window.showInformationMessage)
   * @see [showWarningMessage](#window.showWarningMessage)
   * @see [showErrorMessage](#window.showErrorMessage)
   */
  export interface MessageItem {

    /**
     * A short title like 'Retry', 'Open Log' etc.
     */
    title: string

    /**
     * A hint for modal dialogs that the item should be triggered
     * when the user cancels the dialog (e.g. by pressing the ESC
     * key).
     *
     * Note: this option is ignored for non-modal messages.
     * Note: not used by coc.nvim for now.
     */
    isCloseAffordance?: boolean
  }

  export interface DialogButton {
    /**
     * Use by callback, should >= 0
     */
    index: number
    text: string
    /**
     * Not shown when true
     */
    disabled?: boolean
  }

  export interface DialogConfig {
    /**
     * Content shown in window.
     */
    content: string
    /**
     * Optional title text.
     */
    title?: string
    /**
     * show close button, default to true when not specified.
     */
    close?: boolean
    /**
     * highlight group for dialog window, default to `"dialog.floatHighlight"` or 'CocFlating'
     */
    highlight?: string
    /**
     * highlight groups for border, default to `"dialog.borderhighlight"` or 'CocFlating'
     */
    borderhighlight?: string
    /**
     * Buttons as bottom of dialog.
     */
    buttons?: DialogButton[]
    /**
     * index is -1 for window close without button click
     */
    callback?: (index: number) => void
  }

  export interface NotificationConfig extends DialogConfig {
    /**
     * Timeout in miliseconds to dismiss notification, default no timeout.
     */
    timeout?: number
  }

  /**
   * Represents an item that can be selected from
   * a list of items.
   */
  export interface QuickPickItem {
    /**
     * A human-readable string which is rendered prominent
     */
    label: string
    /**
     * A human-readable string which is rendered less prominent in the same line
     */
    description?: string
    /**
     * Optional flag indicating if this item is picked initially.
     */
    picked?: boolean
  }

  export interface ScreenPosition {
    row: number
    col: number
  }

  export type MsgTypes = 'error' | 'warning' | 'more'

  export interface OpenTerminalOption {
    /**
     * Cwd of terminal, default to result of |getcwd()|
     */
    cwd?: string
    /**
     * Close terminal on job finish, default to true.
     */
    autoclose?: boolean
    /**
     * Keep foucus current window, default to false,
     */
    keepfocus?: boolean
  }

  /**
   * An output channel is a container for readonly textual information.
   *
   * To get an instance of an `OutputChannel` use
   * [createOutputChannel](#window.createOutputChannel).
   */
  export interface OutputChannel {

    /**
     * The human-readable name of this output channel.
     */
    readonly name: string

    readonly content: string
    /**
     * Append the given value to the channel.
     *
     * @param value A string, falsy values will not be printed.
     */
    append(value: string): void

    /**
     * Append the given value and a line feed character
     * to the channel.
     *
     * @param value A string, falsy values will be printed.
     */
    appendLine(value: string): void

    /**
     * Removes output from the channel. Latest `keep` lines will be remained.
     */
    clear(keep?: number): void

    /**
     * Reveal this channel in the UI.
     *
     * @param preserveFocus When `true` the channel will not take focus.
     */
    show(preserveFocus?: boolean): void

    /**
     * Hide this channel from the UI.
     */
    hide(): void

    /**
     * Dispose and free associated resources.
     */
    dispose(): void
  }

  export interface TerminalResult {
    bufnr: number
    success: boolean
    content?: string
  }

  export interface Dialog {
    /**
     * Buffer number of dialog.
     */
    bufnr: number
    /**
     * Window id of dialog.
     */
    winid: Promise<number | null>
    dispose: () => void
  }

  export namespace window {
    /**
     * Reveal message with message type.
     *
     * @param msg Message text to show.
     * @param messageType Type of message, could be `error` `warning` and `more`, default to `more`
     */
    export function showMessage(msg: string, messageType?: MsgTypes): void

    /**
     * Run command in vim terminal for result
     *
     * @param cmd Command to run.
     * @param cwd Cwd of terminal, default to result of |getcwd()|.
     */
    export function runTerminalCommand(cmd: string, cwd?: string, keepfocus?: boolean): Promise<TerminalResult>

    /**
     * Open terminal window.
     *
     * @param cmd Command to run.
     * @param opts Terminal option.
     * @returns buffer number of terminal.
     */
    export function openTerminal(cmd: string, opts?: OpenTerminalOption): Promise<number>

    /**
     * Show quickpick for single item, use `window.menuPick` for menu at current current position.
     *
     * @param items Label list.
     * @param placeholder Prompt text, default to 'choose by number'.
     * @returns Index of selected item, or -1 when canceled.
     */
    export function showQuickpick(items: string[], placeholder?: string): Promise<number>

    /**
     * Show menu picker at current cursor position, |inputlist()| is used as fallback.
     * Use `workspace.env.dialog` to check if the picker window/popup could work.
     *
     * @param items Array of texts.
     * @param title Optional title of float/popup window.
     * @param token A token that can be used to signal cancellation.
     * @returns Selected index (0 based), -1 when canceled.
     */
    export function showMenuPicker(items: string[], title?: string, token?: CancellationToken): Promise<number>

    /**
     * Open local config file
     */
    export function openLocalConfig(): Promise<void>

    /**
     * Prompt user for confirm, a float/popup window would be used when possible,
     * use vim's |confirm()| function as callback.
     *
     * @param title The prompt text.
     * @returns Result of confirm.
     */
    export function showPrompt(title: string): Promise<boolean>

    /**
     * Show dialog window at the center of screen.
     * Note that the dialog would always be closed after button click.
     * Use `workspace.env.dialog` to check if dialog could work.
     *
     * @param config Dialog configuration.
     * @returns Dialog or null when dialog can't work.
     */
    export function showDialog(config: DialogConfig): Promise<Dialog | null>

    /**
     * Request input from user
     *
     * @param title Title text of prompt window.
     * @param defaultValue Default value of input, empty text by default.
     */
    export function requestInput(title: string, defaultValue?: string): Promise<string>

    /**
     * Create statusbar item that would be included in `g:coc_status`.
     *
     * @param priority Higher priority item would be shown right.
     * @param option
     * @return A new status bar item.
     */
    export function createStatusBarItem(priority?: number, option?: StatusItemOption): StatusBarItem

    /**
     * Create a new output channel
     *
     * @param name Unique name of output channel.
     * @returns A new output channel.
     */
    export function createOutputChannel(name: string): OutputChannel

    /**
     * Reveal buffer of output channel.
     *
     * @param name Name of output channel.
     * @param preserveFocus Preserve window focus when true.
     */
    export function showOutputChannel(name: string, preserveFocus: boolean): void

    /**
     * Echo lines at the bottom of vim.
     *
     * @param lines Line list.
     * @param truncate Truncate the lines to avoid 'press enter to continue' when true
     */
    export function echoLines(lines: string[], truncate?: boolean): Promise<void>

    /**
     * Get current cursor position (line, character both 0 based).
     *
     * @returns Cursor position.
     */
    export function getCursorPosition(): Promise<Position>

    /**
     * Move cursor to position (line, character both 0 based).
     *
     * @param position LSP position.
     */
    export function moveTo(position: Position): Promise<void>

    /**
     * Get current cursor character offset in document,
     * length of line break would always be 1.
     *
     * @returns Charactor offset.
     */
    export function getOffset(): Promise<number>

    /**
     * Get screen position of current cursor(relative to editor),
     * both `row` and `col` are 0 based.
     *
     * @returns Cursor screen position.
     */
    export function getCursorScreenPosition(): Promise<ScreenPosition>

    /**
     * Show multiple picker at center of screen.
     * Use `workspace.env.dialog` to check if dialog could work.
     *
     * @param items A set of items that will be rendered as actions in the message.
     * @param title Title of picker dialog.
     * @param token A token that can be used to signal cancellation.
     * @return A promise that resolves to the selected items or `undefined`.
     */
    export function showPickerDialog(items: string[], title: string, token?: CancellationToken): Promise<string[] | undefined>

    /**
     * Show multiple picker at center of screen.
     * Use `workspace.env.dialog` to check if dialog could work.
     *
     * @param items A set of items that will be rendered as actions in the message.
     * @param title Title of picker dialog.
     * @param token A token that can be used to signal cancellation.
     * @return A promise that resolves to the selected items or `undefined`.
     */
    export function showPickerDialog<T extends QuickPickItem>(items: T[], title: string, token?: CancellationToken): Promise<T[] | undefined>

    /**
     * Show an information message to users. Optionally provide an array of items which will be presented as
     * clickable buttons.
     *
     * @param message The message to show.
     * @param items A set of items that will be rendered as actions in the message.
     * @return Promise that resolves to the selected item or `undefined` when being dismissed.
     */
    export function showInformationMessage(message: string, ...items: string[]): Promise<string | undefined>
    /**
     * Show an information message to users. Optionally provide an array of items which will be presented as
     * clickable buttons.
     *
     * @param message The message to show.
     * @param items A set of items that will be rendered as actions in the message.
     * @return Promise that resolves to the selected item or `undefined` when being dismissed.
     */
    export function showInformationMessage<T extends MessageItem>(message: string, ...items: T[]): Promise<T | undefined>

    /**
     * Show an warning message to users. Optionally provide an array of items which will be presented as
     * clickable buttons.
     *
     * @param message The message to show.
     * @param items A set of items that will be rendered as actions in the message.
     * @return Promise that resolves to the selected item or `undefined` when being dismissed.
     */
    export function showWarningMessage(message: string, ...items: string[]): Promise<string | undefined>
    /**
     * Show an warning message to users. Optionally provide an array of items which will be presented as
     * clickable buttons.
     *
     * @param message The message to show.
     * @param items A set of items that will be rendered as actions in the message.
     * @return Promise that resolves to the selected item or `undefined` when being dismissed.
     */
    export function showWarningMessage<T extends MessageItem>(message: string, ...items: T[]): Promise<T | undefined>

    /**
     * Show an error message to users. Optionally provide an array of items which will be presented as
     * clickable buttons.
     *
     * @param message The message to show.
     * @param items A set of items that will be rendered as actions in the message.
     * @return Promise that resolves to the selected item or `undefined` when being dismissed.
     */
    export function showErrorMessage(message: string, ...items: string[]): Promise<string | undefined>
    /**
     * Show an error message to users. Optionally provide an array of items which will be presented as
     * clickable buttons.
     *
     * @param message The message to show.
     * @param items A set of items that will be rendered as actions in the message.
     * @return Promise that resolves to the selected item or `undefined` when being dismissed.
     */
    export function showErrorMessage<T extends MessageItem>(message: string, ...items: T[]): Promise<T | undefined>

    /**
     * Show notification window at right of screen.
     */
    export function showNotification(config: NotificationConfig): Promise<boolean>

    /**
     * Show progress in the editor. Progress is shown while running the given callback
     * and while the promise it returned isn't resolved nor rejected.
     *
     * @param task A callback returning a promise. Progress state can be reported with
     * the provided [progress](#Progress)-object.
     *
     * To report discrete progress, use `increment` to indicate how much work has been completed. Each call with
     * a `increment` value will be summed up and reflected as overall progress until 100% is reached (a value of
     * e.g. `10` accounts for `10%` of work done).
     *
     * To monitor if the operation has been cancelled by the user, use the provided [`CancellationToken`](#CancellationToken).
     *
     * @return The thenable the task-callback returned.
     */
    export function withProgress<R>(options: ProgressOptions, task: (progress: Progress<{
      message?: string
      increment?: number
    }>, token: CancellationToken) => Thenable<R>): Promise<R>
  }
  // }}

  // extensions module {{
  export interface Logger {
    readonly category: string
    readonly level: string
    log(...args: any[]): void
    trace(message: any, ...args: any[]): void
    debug(message: any, ...args: any[]): void
    info(message: any, ...args: any[]): void
    warn(message: any, ...args: any[]): void
    error(message: any, ...args: any[]): void
    fatal(message: any, ...args: any[]): void
    mark(message: any, ...args: any[]): void
  }

  /**
   * A memento represents a storage utility. It can store and retrieve
   * values.
   */
  export interface Memento {

    /**
     * Return a value.
     *
     * @param key A string.
     * @return The stored value or `undefined`.
     */
    get<T>(key: string): T | undefined

    /**
     * Return a value.
     *
     * @param key A string.
     * @param defaultValue A value that should be returned when there is no
     * value (`undefined`) with the given key.
     * @return The stored value or the defaultValue.
     */
    get<T>(key: string, defaultValue: T): T

    /**
     * Store a value. The value must be JSON-stringifyable.
     *
     * @param key A string.
     * @param value A value. MUST not contain cyclic references.
     */
    update(key: string, value: any): Promise<void>
  }

  export type ExtensionState = 'disabled' | 'loaded' | 'activated' | 'unknown'

  export enum ExtensionType {
    Global,
    Local,
    SingleFile,
    Internal
  }

  export interface ExtensionJson {
    name: string
    main?: string
    engines: {
      [key: string]: string
    }
    version?: string
    [key: string]: any
  }

  export interface ExtensionInfo {
    id: string
    version: string
    description: string
    root: string
    exotic: boolean
    uri?: string
    state: ExtensionState
    isLocal: boolean
    packageJSON: Readonly<ExtensionJson>
  }

  /**
   * Represents an extension.
   *
   * To get an instance of an `Extension` use [getExtension](#extensions.getExtension).
   */
  export interface Extension<T> {

    /**
     * The canonical extension identifier in the form of: `publisher.name`.
     */
    readonly id: string

    /**
     * The absolute file path of the directory containing this extension.
     */
    readonly extensionPath: string

    /**
     * `true` if the extension has been activated.
     */
    readonly isActive: boolean

    /**
     * The parsed contents of the extension's package.json.
     */
    readonly packageJSON: any

    /**
     * The public API exported by this extension. It is an invalid action
     * to access this field before this extension has been activated.
     */
    readonly exports: T

    /**
     * Activates this extension and returns its public API.
     *
     * @return A promise that will resolve when this extension has been activated.
     */
    activate(): Promise<T>
  }

  /**
   * An extension context is a collection of utilities private to an
   * extension.
   *
   * An instance of an `ExtensionContext` is provided as the first
   * parameter to the `activate`-call of an extension.
   */
  export interface ExtensionContext {

    /**
     * An array to which disposables can be added. When this
     * extension is deactivated the disposables will be disposed.
     */
    subscriptions: Disposable[]

    /**
     * The absolute file path of the directory containing the extension.
     */
    extensionPath: string

    /**
     * Get the absolute path of a resource contained in the extension.
     *
     * @param relativePath A relative path to a resource contained in the extension.
     * @return The absolute path of the resource.
     */
    asAbsolutePath(relativePath: string): string

    /**
     * The absolute directory path for extension to download persist data.
     * The directory could be not exists.
     */
    storagePath: string

    /**
     * A memento object that stores state in the context
     * of the currently opened [workspace](#workspace.workspaceFolders).
     */
    workspaceState: Memento

    /**
     * A memento object that stores state independent
     * of the current opened [workspace](#workspace.workspaceFolders).
     */
    globalState: Memento

    logger: Logger
  }

  export type ExtensionApi = {
    [index: string]: any
  } | void | null | undefined

  export interface PropertyScheme {
    type: string
    default: any
    description: string
    enum?: string[]
    items?: any
    [key: string]: any
  }

  export namespace extensions {
    /**
     * Fired on extension loaded, extension not activated yet.
     */
    export const onDidLoadExtension: Event<Extension<ExtensionApi>>

    /**
     * Fired on extension activated.
     */
    export const onDidActiveExtension: Event<Extension<ExtensionApi>>

    /**
     * Fired with extension id on extension unload.
     */
    export const onDidUnloadExtension: Event<string>

    /**
     * Get all loaded extensions, without disabled extensions, extension may not activated.
     */
    export const all: ReadonlyArray<Extension<ExtensionApi>>

    /**
     * Get state of specific extension.
     */
    export function getExtensionState(id: string): ExtensionState

    /**
     * Get state of all extensions, including disabled extensions.
     */
    export function getExtensionStates(): Promise<ExtensionInfo[]>

    /**
     * Check if extension is activated.
     */
    export function isActivated(id: string): boolean

    /**
     * Dynamic add custom json schemes without using package.json.
     */
    export function addSchemeProperty(key: string, def: PropertyScheme): void
  }
  // }}

  // listManager module {{
  export interface LocationWithLine {
    uri: string
    /**
     * Match text of line.
     */
    line: string
    /**
     * Highlight text in line.
     */
    text?: string
  }

  export interface AnsiHighlight {
    /**
     * Byte indexes, 0 based.
     */
    span: [number, number]
    hlGroup: string
  }

  export interface ListItem {
    label: string
    filterText?: string
    /**
     * A string that should be used when comparing this item
     * with other items, only used for fuzzy filter.
     */
    sortText?: string
    location?: Location | LocationWithLine | string
    data?: any
    ansiHighlights?: AnsiHighlight[]
    resolved?: boolean
  }

  export interface ListHighlights {
    /**
     * Byte indexes list, 0 based.
     */
    spans: [number, number][]
    /**
     * `list.matchHighlightGroup` is used when not exists.
     */
    hlGroup?: string
  }

  export type ListMode = 'normal' | 'insert'

  export type ListMatcher = 'strict' | 'fuzzy' | 'regex'

  export interface ListOptions {
    position: string
    input: string
    ignorecase: boolean
    interactive: boolean
    sort: boolean
    mode: ListMode
    matcher: ListMatcher
    autoPreview: boolean
    numberSelect: boolean
    noQuit: boolean
    first: boolean
  }

  export interface ListContext {
    /**
     * Input on list activated.
     */
    input: string
    /**
     * Current work directory on activated.
     */
    cwd: string
    /**
     * Options of list.
     */
    options: ListOptions
    /**
     * Arguments passed to list.
     */
    args: string[]
    /**
     * Original window on list invoke.
     */
    window: Window
    /**
     * Original buffer on list invoke.
     */
    buffer: Buffer
    listWindow: Window | null
  }

  export interface ListAction {
    /**
     * Action name
     */
    name: string
    /**
     * Should persist list window on invoke.
     */
    persist?: boolean
    /**
     * Should reload list after invoke.
     */
    reload?: boolean
    /**
     * Inovke all selected items in parallel.
     */
    parallel?: boolean
    /**
     * Support handle multiple items at once.
     */
    multiple?: boolean
    /**
     * Item is array of selected items when multiple is true.
     */
    execute: (item: ListItem | ListItem[], context: ListContext) => ProviderResult<void>
  }

  export interface MutipleListAction extends ListAction {
    multiple: true
    execute: (item: ListItem[], context: ListContext) => ProviderResult<void>
  }

  export interface ListTask {
    on(event: 'data', callback: (item: ListItem) => void): void
    on(event: 'end', callback: () => void): void
    on(event: 'error', callback: (msg: string | Error) => void): void
    dispose(): void
  }

  export interface ListArgument {
    key?: string
    hasValue?: boolean
    name: string
    description: string
  }

  export interface IList {
    /**
     * Unique name of list.
     */
    name: string
    /**
     * Default action name.
     */
    defaultAction: string
    /**
     * Action list.
     */
    actions: ListAction[]
    /**
     * Load list items.
     */
    loadItems(context: ListContext, token: CancellationToken): Promise<ListItem[] | ListTask | null | undefined>
    /**
     * Should be true when interactive is supported.
     */
    interactive?: boolean
    /**
     * Description of list.
     */
    description?: string
    /**
     * Detail description, shown in help.
     */
    detail?: string
    /**
     * Options supported by list.
     */
    options?: ListArgument[]
    /**
     * Resolve list item.
     */
    resolveItem?(item: ListItem): Promise<ListItem | null>
    /**
     * Highlight buffer by vim's syntax commands.
     */
    doHighlight?(): void
    /**
     * Called on list unregisted.
     */
    dispose?(): void
  }

  export interface PreviewOptions {
    bufname?: string
    lines: string[]
    filetype: string
    lnum?: number
    range?: Range
    /**
     * @deprecated not used
     */
    sketch?: boolean
  }

  export namespace listManager {
    /**
     * Registed list names set.
     */
    export const names: ReadonlyArray<string>
    /**
     * Register list, list session can be created by `CocList [name]` after registered.
     */
    export function registerList(list: IList): Disposable
  }
  // }}

  // snippetManager module {{
  export interface SnippetSession {
    isActive: boolean
  }
  export interface TextmateSnippet {
    toString(): string
  }
  /**
   * Manage snippet sessions.
   */
  export namespace snippetManager {
    /**
     * Get snippet session by bufnr.
     */
    export function getSession(bufnr: number): SnippetSession | undefined
    /**
     * Parse snippet string to TextmateSnippet.
     */
    export function resolveSnippet(body: string): Promise<TextmateSnippet>
    /**
     * Insert snippet at current buffer.
     *
     * @param {string} snippet Textmate snippet string.
     * @param {boolean} select Not select first placeholder when false, default `true`.
     * @param {Range} range Repalce range, insert to current cursor position when undefined.
     * @returns {Promise<boolean>} true when insert success.
     */
    export function insertSnippet(snippet: string, select?: boolean, range?: Range): Promise<boolean>

    /**
     * Jump to next placeholder, only works when snippet session activated.
     */
    export function nextPlaceholder(): Promise<void>
    /**
     * Jump to previous placeholder, only works when snippet session activated.
     */
    export function previousPlaceholder(): Promise<void>
    /**
     * Cancel snippet session of current buffer, does nothing when no session activated.
     */
    export function cancel(): void
    /**
     * Check if snippet activated for bufnr.
     */
    export function isActived(bufnr: number): boolean
  }
  // }}

  // diagnosticManager module {{
  export interface DiagnosticItem {
    file: string
    lnum: number
    col: number
    source: string
    code: string | number
    message: string
    severity: string
    level: number
    location: Location
  }

  export enum DiagnosticKind {
    Syntax,
    Semantic,
    Suggestion,
  }

  /**
   * A diagnostics collection is a container that manages a set of
   * [diagnostics](#Diagnostic). Diagnostics are always scopes to a
   * diagnostics collection and a resource.
   *
   * To get an instance of a `DiagnosticCollection` use
   * [createDiagnosticCollection](#languages.createDiagnosticCollection).
   */
  export interface DiagnosticCollection {

    /**
     * The name of this diagnostic collection, for instance `typescript`. Every diagnostic
     * from this collection will be associated with this name. Also, the task framework uses this
     * name when defining [problem matchers](https://code.visualstudio.com/docs/editor/tasks#_defining-a-problem-matcher).
     */
    readonly name: string

    /**
     * Assign diagnostics for given resource. Will replace
     * existing diagnostics for that resource.
     *
     * @param uri A resource identifier.
     * @param diagnostics Array of diagnostics or `undefined`
     */
    set(uri: string, diagnostics: Diagnostic[] | null): void
    /**
     * Replace all entries in this collection.
     *
     * Diagnostics of multiple tuples of the same uri will be merged, e.g
     * `[[file1, [d1]], [file1, [d2]]]` is equivalent to `[[file1, [d1, d2]]]`.
     * If a diagnostics item is `undefined` as in `[file1, undefined]`
     * all previous but not subsequent diagnostics are removed.
     *
     * @param entries An array of tuples, like `[[file1, [d1, d2]], [file2, [d3, d4, d5]]]`, or `undefined`.
     */
    set(entries: [string, Diagnostic[] | null][] | string, diagnostics?: Diagnostic[]): void

    /**
     * Remove all diagnostics from this collection that belong
     * to the provided `uri`. The same as `#set(uri, undefined)`.
     *
     * @param uri A resource identifier.
     */
    delete(uri: string): void

    /**
     * Remove all diagnostics from this collection. The same
     * as calling `#set(undefined)`
     */
    clear(): void

    /**
     * Iterate over each entry in this collection.
     *
     * @param callback Function to execute for each entry.
     * @param thisArg The `this` context used when invoking the handler function.
     */
    forEach(callback: (uri: string, diagnostics: Diagnostic[], collection: DiagnosticCollection) => any, thisArg?: any): void

    /**
     * Get the diagnostics for a given resource. *Note* that you cannot
     * modify the diagnostics-array returned from this call.
     *
     * @param uri A resource identifier.
     * @returns An immutable array of [diagnostics](#Diagnostic) or `undefined`.
     */
    get(uri: string): Diagnostic[] | undefined

    /**
     * Check if this collection contains diagnostics for a
     * given resource.
     *
     * @param uri A resource identifier.
     * @returns `true` if this collection has diagnostic for the given resource.
     */
    has(uri: string): boolean

    /**
     * Dispose and free associated resources. Calls
     * [clear](#DiagnosticCollection.clear).
     */
    dispose(): void
  }

  export interface DiagnosticEventParams {
    bufnr: number
    uri: string
    diagnostics: ReadonlyArray<Diagnostic>
  }

  export namespace diagnosticManager {

    export const onDidRefresh: Event<DiagnosticEventParams>
    /**
     * Create collection by name
     */
    export function create(name: string): DiagnosticCollection

    /**
     * Get readonly diagnostics for uri
     */
    export function getDiagnostics(uri: string): ReadonlyArray<(Diagnostic & { collection: string })>

    /**
     * Get readonly diagnostics by document and range.
     */
    export function getDiagnosticsInRange(doc: TextDocumentIdentifier, range: Range): ReadonlyArray<Diagnostic>
    /**
     * All diagnostics of current workspace
     */
    export function getDiagnosticList(): ReadonlyArray<DiagnosticItem>

    /**
     * All diagnostics at current cursor position.
     */
    export function getCurrentDiagnostics(): Promise<ReadonlyArray<Diagnostic>>

    /**
     * Get diagnostic collection.
     */
    export function getCollectionByName(name: string): DiagnosticCollection
  }
  // }}

  // language client {{
  /**
   * An action to be performed when the connection is producing errors.
   */
  export enum ErrorAction {
    /**
     * Continue running the server.
     */
    Continue = 1,
    /**
     * Shutdown the server.
     */
    Shutdown = 2
  }
  /**
   * An action to be performed when the connection to a server got closed.
   */
  export enum CloseAction {
    /**
     * Don't restart the server. The connection stays closed.
     */
    DoNotRestart = 1,
    /**
     * Restart the server.
     */
    Restart = 2
  }
  /**
   * A pluggable error handler that is invoked when the connection is either
   * producing errors or got closed.
   */
  export interface ErrorHandler {
    /**
     * An error has occurred while writing or reading from the connection.
     *
     * @param error - the error received
     * @param message - the message to be delivered to the server if know.
     * @param count - a count indicating how often an error is received. Will
     *  be reset if a message got successfully send or received.
     */
    error(error: Error, message: { jsonrpc: string }, count: number): ErrorAction
    /**
     * The connection to the server got closed.
     */
    closed(): CloseAction
  }
  export interface InitializationFailedHandler {
    (error: Error | any): boolean
  }

  export interface SynchronizeOptions {
    configurationSection?: string | string[]
    fileEvents?: FileSystemWatcher | FileSystemWatcher[]
  }

  export enum RevealOutputChannelOn {
    Info = 1,
    Warn = 2,
    Error = 3,
    Never = 4
  }
  export interface ConfigurationItem {
    /**
     * The scope to get the configuration section for.
     */
    scopeUri?: string
    /**
     * The configuration section asked for.
     */
    section?: string
  }
  export interface ResponseError<D> {
    code: number
    data: D | undefined
  }

  export type HandlerResult<R, E> = R | ResponseError<E> | Thenable<R> | Thenable<ResponseError<E>> | Thenable<R | ResponseError<E>>

  export interface RequestHandler<P, R, E> {
    (params: P, token: CancellationToken): HandlerResult<R, E>
  }

  export interface RequestHandler0<R, E> {
    (token: CancellationToken): HandlerResult<R, E>
  }
  /**
   * The parameters of a configuration request.
   */
  export interface ConfigurationParams {
    items: ConfigurationItem[]
  }

  export interface ConfigurationWorkspaceMiddleware {
    configuration?: (params: ConfigurationParams, token: CancellationToken, next: RequestHandler<ConfigurationParams, any[], void>) => HandlerResult<any[], void>
  }

  export interface WorkspaceFolderWorkspaceMiddleware {
    workspaceFolders?: (token: CancellationToken, next: RequestHandler0<WorkspaceFolder[] | null, void>) => HandlerResult<WorkspaceFolder[] | null, void>
    didChangeWorkspaceFolders?: NextSignature<WorkspaceFoldersChangeEvent, void>
  }

  export interface ProvideTypeDefinitionSignature {
    (
      this: void,
      document: TextDocument,
      position: Position,
      token: CancellationToken
    ): ProviderResult<Definition | DefinitionLink[]>
  }

  export interface TypeDefinitionMiddleware {
    provideTypeDefinition?: (
      this: void,
      document: TextDocument,
      position: Position,
      token: CancellationToken,
      next: ProvideTypeDefinitionSignature
    ) => ProviderResult<Definition | DefinitionLink[]>
  }

  export interface ProvideImplementationSignature {
    (this: void, document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Definition | DefinitionLink[]>
  }

  export interface ImplementationMiddleware {
    provideImplementation?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideImplementationSignature) => ProviderResult<Definition | DefinitionLink[]>
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

  export interface ProvideDeclarationSignature {
    (this: void, document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Declaration | DeclarationLink[]>
  }

  export interface DeclarationMiddleware {
    provideDeclaration?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideDeclarationSignature) => ProviderResult<Declaration | DeclarationLink[]>
  }

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

  export interface ProvideSelectionRangeSignature {
    (this: void, document: TextDocument, positions: Position[], token: CancellationToken): ProviderResult<SelectionRange[]>
  }

  export interface SelectionRangeProviderMiddleware {
    provideSelectionRanges?: (this: void, document: TextDocument, positions: Position[], token: CancellationToken, next: ProvideSelectionRangeSignature) => ProviderResult<SelectionRange[]>
  }

  export interface HandleWorkDoneProgressSignature {
    (this: void, token: ProgressToken, params: WorkDoneProgressBegin | WorkDoneProgressReport | WorkDoneProgressEnd): void
  }

  export interface HandleDiagnosticsSignature {
    (this: void, uri: string, diagnostics: Diagnostic[]): void
  }

  export interface ProvideCompletionItemsSignature {
    (this: void, document: TextDocument, position: Position, context: CompletionContext, token: CancellationToken): ProviderResult<CompletionItem[] | CompletionList>
  }

  export interface ResolveCompletionItemSignature {
    (this: void, item: CompletionItem, token: CancellationToken): ProviderResult<CompletionItem>
  }

  export interface ProvideHoverSignature {
    (this: void, document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Hover>
  }

  export interface ProvideSignatureHelpSignature {
    (this: void, document: TextDocument, position: Position, context: SignatureHelpContext, token: CancellationToken): ProviderResult<SignatureHelp>
  }

  export interface ProvideDefinitionSignature {
    (this: void, document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Definition | DefinitionLink[]>
  }

  export interface ProvideReferencesSignature {
    (this: void, document: TextDocument, position: Position, options: {
      includeDeclaration: boolean
    }, token: CancellationToken): ProviderResult<Location[]>
  }

  export interface ProvideDocumentHighlightsSignature {
    (this: void, document: TextDocument, position: Position, token: CancellationToken): ProviderResult<DocumentHighlight[]>
  }

  export interface ProvideDocumentSymbolsSignature {
    (this: void, document: TextDocument, token: CancellationToken): ProviderResult<SymbolInformation[] | DocumentSymbol[]>
  }

  export interface ProvideWorkspaceSymbolsSignature {
    (this: void, query: string, token: CancellationToken): ProviderResult<SymbolInformation[]>
  }

  export interface ProvideCodeActionsSignature {
    (this: void, document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): ProviderResult<(Command | CodeAction)[]>
  }

  export interface ResolveCodeActionSignature {
    (this: void, item: CodeAction, token: CancellationToken): ProviderResult<CodeAction>
  }

  export interface ProvideCodeLensesSignature {
    (this: void, document: TextDocument, token: CancellationToken): ProviderResult<CodeLens[]>
  }

  export interface ResolveCodeLensSignature {
    (this: void, codeLens: CodeLens, token: CancellationToken): ProviderResult<CodeLens>
  }

  export interface ProvideDocumentFormattingEditsSignature {
    (this: void, document: TextDocument, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>
  }

  export interface ProvideDocumentRangeFormattingEditsSignature {
    (this: void, document: TextDocument, range: Range, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>
  }

  export interface ProvideOnTypeFormattingEditsSignature {
    (this: void, document: TextDocument, position: Position, ch: string, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>
  }

  export interface PrepareRenameSignature {
    (this: void, document: TextDocument, position: Position, token: CancellationToken): ProviderResult<Range | {
      range: Range
      placeholder: string
    }>
  }

  export interface ProvideRenameEditsSignature {
    (this: void, document: TextDocument, position: Position, newName: string, token: CancellationToken): ProviderResult<WorkspaceEdit>
  }

  export interface ProvideDocumentLinksSignature {
    (this: void, document: TextDocument, token: CancellationToken): ProviderResult<DocumentLink[]>
  }

  export interface ResolveDocumentLinkSignature {
    (this: void, link: DocumentLink, token: CancellationToken): ProviderResult<DocumentLink>
  }

  export interface ExecuteCommandSignature {
    (this: void, command: string, args: any[]): ProviderResult<any>
  }

  export interface NextSignature<P, R> {
    (this: void, data: P, next: (data: P) => R): R
  }

  export interface DidChangeConfigurationSignature {
    (this: void, sections: string[] | undefined): void
  }

  export interface DidChangeWatchedFileSignature {
    (this: void, event: FileEvent): void
  }

  export interface _WorkspaceMiddleware {
    didChangeConfiguration?: (this: void, sections: string[] | undefined, next: DidChangeConfigurationSignature) => void
    didChangeWatchedFile?: (this: void, event: FileEvent, next: DidChangeWatchedFileSignature) => void
  }

  export type WorkspaceMiddleware = _WorkspaceMiddleware & ConfigurationWorkspaceMiddleware & WorkspaceFolderWorkspaceMiddleware
  /**
   * The Middleware lets extensions intercept the request and notications send and received
   * from the server
   */
  interface _Middleware {
    didOpen?: NextSignature<TextDocument, void>
    didChange?: NextSignature<DidChangeTextDocumentParams, void>
    willSave?: NextSignature<TextDocumentWillSaveEvent, void>
    willSaveWaitUntil?: NextSignature<TextDocumentWillSaveEvent, Thenable<TextEdit[]>>
    didSave?: NextSignature<TextDocument, void>
    didClose?: NextSignature<TextDocument, void>
    handleDiagnostics?: (this: void, uri: string, diagnostics: Diagnostic[], next: HandleDiagnosticsSignature) => void
    provideCompletionItem?: (this: void, document: TextDocument, position: Position, context: CompletionContext, token: CancellationToken, next: ProvideCompletionItemsSignature) => ProviderResult<CompletionItem[] | CompletionList>
    resolveCompletionItem?: (this: void, item: CompletionItem, token: CancellationToken, next: ResolveCompletionItemSignature) => ProviderResult<CompletionItem>
    provideHover?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideHoverSignature) => ProviderResult<Hover>
    provideSignatureHelp?: (this: void, document: TextDocument, position: Position, context: SignatureHelpContext, token: CancellationToken, next: ProvideSignatureHelpSignature) => ProviderResult<SignatureHelp>
    provideDefinition?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideDefinitionSignature) => ProviderResult<Definition | DefinitionLink[]>
    provideReferences?: (this: void, document: TextDocument, position: Position, options: {
      includeDeclaration: boolean
    }, token: CancellationToken, next: ProvideReferencesSignature) => ProviderResult<Location[]>
    provideDocumentHighlights?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: ProvideDocumentHighlightsSignature) => ProviderResult<DocumentHighlight[]>
    provideDocumentSymbols?: (this: void, document: TextDocument, token: CancellationToken, next: ProvideDocumentSymbolsSignature) => ProviderResult<SymbolInformation[] | DocumentSymbol[]>
    provideWorkspaceSymbols?: (this: void, query: string, token: CancellationToken, next: ProvideWorkspaceSymbolsSignature) => ProviderResult<SymbolInformation[]>
    provideCodeActions?: (this: void, document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken, next: ProvideCodeActionsSignature) => ProviderResult<(Command | CodeAction)[]>
    handleWorkDoneProgress?: (this: void, token: ProgressToken, params: WorkDoneProgressBegin | WorkDoneProgressReport | WorkDoneProgressEnd, next: HandleWorkDoneProgressSignature) => void
    resolveCodeAction?: (this: void, item: CodeAction, token: CancellationToken, next: ResolveCodeActionSignature) => ProviderResult<CodeAction>
    provideCodeLenses?: (this: void, document: TextDocument, token: CancellationToken, next: ProvideCodeLensesSignature) => ProviderResult<CodeLens[]>
    resolveCodeLens?: (this: void, codeLens: CodeLens, token: CancellationToken, next: ResolveCodeLensSignature) => ProviderResult<CodeLens>
    provideDocumentFormattingEdits?: (this: void, document: TextDocument, options: FormattingOptions, token: CancellationToken, next: ProvideDocumentFormattingEditsSignature) => ProviderResult<TextEdit[]>
    provideDocumentRangeFormattingEdits?: (this: void, document: TextDocument, range: Range, options: FormattingOptions, token: CancellationToken, next: ProvideDocumentRangeFormattingEditsSignature) => ProviderResult<TextEdit[]>
    provideOnTypeFormattingEdits?: (this: void, document: TextDocument, position: Position, ch: string, options: FormattingOptions, token: CancellationToken, next: ProvideOnTypeFormattingEditsSignature) => ProviderResult<TextEdit[]>
    prepareRename?: (this: void, document: TextDocument, position: Position, token: CancellationToken, next: PrepareRenameSignature) => ProviderResult<Range | {
      range: Range
      placeholder: string
    }>
    provideRenameEdits?: (this: void, document: TextDocument, position: Position, newName: string, token: CancellationToken, next: ProvideRenameEditsSignature) => ProviderResult<WorkspaceEdit>
    provideDocumentLinks?: (this: void, document: TextDocument, token: CancellationToken, next: ProvideDocumentLinksSignature) => ProviderResult<DocumentLink[]>
    resolveDocumentLink?: (this: void, link: DocumentLink, token: CancellationToken, next: ResolveDocumentLinkSignature) => ProviderResult<DocumentLink>
    executeCommand?: (this: void, command: string, args: any[], next: ExecuteCommandSignature) => ProviderResult<any>
    workspace?: WorkspaceMiddleware
  }
  export type Middleware = _Middleware & TypeDefinitionMiddleware & ImplementationMiddleware & ColorProviderMiddleware & DeclarationMiddleware & FoldingRangeProviderMiddleware & SelectionRangeProviderMiddleware

  export interface LanguageClientOptions {
    ignoredRootPaths?: string[]
    documentSelector?: DocumentSelector | string[]
    synchronize?: SynchronizeOptions
    diagnosticCollectionName?: string
    disableDynamicRegister?: boolean
    disableWorkspaceFolders?: boolean
    disableSnippetCompletion?: boolean
    disableDiagnostics?: boolean
    disableCompletion?: boolean
    formatterPriority?: number
    outputChannelName?: string
    outputChannel?: OutputChannel
    revealOutputChannelOn?: RevealOutputChannelOn
    /**
     * The encoding use to read stdout and stderr. Defaults
     * to 'utf8' if ommitted.
     */
    stdioEncoding?: string
    initializationOptions?: any | (() => any)
    initializationFailedHandler?: InitializationFailedHandler
    progressOnInitialization?: boolean
    errorHandler?: ErrorHandler
    middleware?: Middleware
    workspaceFolder?: WorkspaceFolder
  }
  export enum State {
    Stopped = 1,
    Running = 2,
    Starting = 3
  }
  export interface StateChangeEvent {
    oldState: State
    newState: State
  }
  export enum ClientState {
    Initial = 0,
    Starting = 1,
    StartFailed = 2,
    Running = 3,
    Stopping = 4,
    Stopped = 5
  }
  export interface RegistrationData<T> {
    id: string
    registerOptions: T
  }
  /**
   * A static feature. A static feature can't be dynamically activate via the
   * server. It is wired during the initialize sequence.
   */
  export interface StaticFeature {
    /**
     * Called to fill the initialize params.
     *
     * @params the initialize params.
     */
    fillInitializeParams?: (params: any) => void
    /**
     * Called to fill in the client capabilities this feature implements.
     *
     * @param capabilities The client capabilities to fill.
     */
    fillClientCapabilities(capabilities: any): void
    /**
     * Initialize the feature. This method is called on a feature instance
     * when the client has successfully received the initalize request from
     * the server and before the client sends the initialized notification
     * to the server.
     *
     * @param capabilities the server capabilities
     * @param documentSelector the document selector pass to the client's constuctor.
     *  May be `undefined` if the client was created without a selector.
     */
    initialize(capabilities: any, documentSelector: DocumentSelector | undefined): void
    /**
     * Called when the client is stopped to dispose this feature. Usually a feature
     * unregisters listeners registerd hooked up with the VS Code extension host.
     */
    dispose(): void
  }
  /**
   * An interface to type messages.
   */
  export interface RPCMessageType {
    readonly method: string
    readonly numberOfParams: number
  }

  /**
   *
   * An abstract implementation of a MessageType.
   */
  abstract class AbstractMessageType implements RPCMessageType {
    get method(): string
    get numberOfParams(): number
    constructor(_method: string, _numberOfParams: number)
  }

  /**
   * Classes to type request response pairs
   *
   * The type parameter RO will be removed in the next major version
   * of the JSON RPC library since it is a LSP concept and doesn't
   * belong here. For now it is tagged as default never.
   */
  export class RequestType0<R, E, RO = never> extends AbstractMessageType {
    /**
     * Clients must not use this property. It is here to ensure correct typing.
     */
    readonly _?: [R, E, RO, _EM]
    constructor(method: string)
  }

  export class RequestType<P, R, E, RO = never> extends AbstractMessageType {
    /**
     * Clients must not use this property. It is here to ensure correct typing.
     */
    readonly _?: [P, R, E, RO, _EM]
    constructor(method: string)
  }

  /**
   * The type parameter RO will be removed in the next major version
   * of the JSON RPC library since it is a LSP concept and doesn't
   * belong here. For now it is tagged as default never.
   */
  export class NotificationType<P, RO = never> extends AbstractMessageType {
    /**
     * Clients must not use this property. It is here to ensure correct typing.
     */
    readonly _?: [P, RO, _EM]
    constructor(method: string)
  }

  export class NotificationType0<RO = never> extends AbstractMessageType {
    /**
     * Clients must not use this property. It is here to ensure correct typing.
     */
    readonly _?: [RO, _EM]
    constructor(method: string)
  }

  export interface InitializeParams {
    /**
    * The process Id of the parent process that started
    * the server.
    */
    processId: number | null
    /**
     * Information about the client
     *
     * @since 3.15.0
     */
    clientInfo?: {
      /**
       * The name of the client as defined by the client.
       */
      name: string
      /**
       * The client's version as defined by the client.
       */
      version?: string
    }
    /**
     * The rootPath of the workspace. Is null
     * if no folder is open.
     *
     * @deprecated in favour of rootUri.
     */
    rootPath?: string | null
    /**
     * The rootUri of the workspace. Is null if no
     * folder is open. If both `rootPath` and `rootUri` are set
     * `rootUri` wins.
     *
     * @deprecated in favour of workspaceFolders.
     */
    rootUri: string | null
    /**
     * The capabilities provided by the client (editor or tool)
     */
    capabilities: any
    /**
     * User provided initialization options.
     */
    initializationOptions?: any
    /**
     * The initial trace setting. If omitted trace is disabled ('off').
     */
    trace?: 'off' | 'messages' | 'verbose'
    /**
     * An optional token that a server can use to report work done progress.
     */
    workDoneToken?: ProgressToken
  }
  /**
   * The result returned from an initialize request.
   */
  export interface InitializeResult {
    /**
     * The capabilities the language server provides.
     */
    capabilities: any
    /**
     * Information about the server.
     *
     * @since 3.15.0
     */
    serverInfo?: {
      /**
       * The name of the server as defined by the server.
       */
      name: string
      /**
       * The servers's version as defined by the server.
       */
      version?: string
    }
    /**
     * Custom initialization results.
     */
    [custom: string]: any
  }

  export interface DynamicFeature<T> {
    /**
     * The message for which this features support dynamic activation / registration.
     */
    messages: RPCMessageType | RPCMessageType[]
    /**
     * Called to fill the initialize params.
     *
     * @params the initialize params.
     */
    fillInitializeParams?: (params: InitializeParams) => void
    /**
     * Called to fill in the client capabilities this feature implements.
     *
     * @param capabilities The client capabilities to fill.
     */
    fillClientCapabilities(capabilities: any): void
    /**
     * Initialize the feature. This method is called on a feature instance
     * when the client has successfully received the initalize request from
     * the server and before the client sends the initialized notification
     * to the server.
     *
     * @param capabilities the server capabilities.
     * @param documentSelector the document selector pass to the client's constuctor.
     *  May be `undefined` if the client was created without a selector.
     */
    initialize(capabilities: any, documentSelector: DocumentSelector | undefined): void
    /**
     * Is called when the server send a register request for the given message.
     *
     * @param message the message to register for.
     * @param data additional registration data as defined in the protocol.
     */
    register(message: RPCMessageType, data: RegistrationData<T>): void
    /**
     * Is called when the server wants to unregister a feature.
     *
     * @param id the id used when registering the feature.
     */
    unregister(id: string): void
    /**
     * Called when the client is stopped to dispose this feature. Usually a feature
     * unregisters listeners registerd hooked up with the VS Code extension host.
     */
    dispose(): void
  }

  export interface NotificationFeature<T extends Function> {
    /**
     * Triggers the corresponding RPC method.
     */
    getProvider(document: TextDocument): {
      send: T
    }
  }

  export interface ExecutableOptions {
    cwd?: string
    env?: any
    detached?: boolean
    shell?: boolean
  }

  export interface Executable {
    command: string
    args?: string[]
    options?: ExecutableOptions
  }

  export interface ForkOptions {
    cwd?: string
    env?: any
    execPath?: string
    encoding?: string
    execArgv?: string[]
  }

  export interface StreamInfo {
    writer: NodeJS.WritableStream
    reader: NodeJS.ReadableStream
    detached?: boolean
  }

  export enum TransportKind {
    stdio = 0,
    ipc = 1,
    pipe = 2,
    socket = 3
  }

  export interface SocketTransport {
    kind: TransportKind.socket
    port: number
  }

  export interface NodeModule {
    module: string
    transport?: TransportKind | SocketTransport
    args?: string[]
    runtime?: string
    options?: ForkOptions
  }

  export interface ChildProcessInfo {
    process: cp.ChildProcess
    detached: boolean
  }

  export interface PartialMessageInfo {
    readonly messageToken: number
    readonly waitingTime: number
  }

  export interface MessageReader {
    readonly onError: Event<Error>
    readonly onClose: Event<void>
    readonly onPartialMessage: Event<PartialMessageInfo>
    listen(callback: (data: { jsonrpc: string }) => void): void
    dispose(): void
  }

  export interface MessageWriter {
    readonly onError: Event<[Error, { jsonrpc: string } | undefined, number | undefined]>
    readonly onClose: Event<void>
    write(msg: { jsonrpc: string }): void
    dispose(): void
  }

  export interface MessageTransports {
    reader: MessageReader
    writer: MessageWriter
    detached?: boolean
  }

  export type ServerOptions = Executable | NodeModule | {
    run: Executable
    debug: Executable
  } | {
    run: NodeModule
    debug: NodeModule
  } | (() => Promise<cp.ChildProcess | StreamInfo | MessageTransports | ChildProcessInfo>)

  export interface _EM {
    _$endMarker$_: number
  }

  export class ProgressType<P> {
    /**
     * Clients must not use this property. It is here to ensure correct typing.
     */
    readonly __?: [P, _EM]
    constructor()
  }

  export enum Trace {
    Off = 0,
    Messages = 1,
    Verbose = 2
  }

  /**
   * A language server for manage a language server.
   * It's recommended to use `services.registLanguageClient` for regist language client to serviers,
   * you can have language client listed in `CocList services` and services could start the language client
   * by `documentselector` of `clientOptions`.
   */
  export class LanguageClient {
    readonly id: string
    readonly name: string
    constructor(id: string, name: string, serverOptions: ServerOptions, clientOptions: LanguageClientOptions, forceDebug?: boolean)
    /**
     * Create language client by name and options, don't forget regist language client
     * to services by `services.registLanguageClient`
     */
    constructor(name: string, serverOptions: ServerOptions, clientOptions: LanguageClientOptions, forceDebug?: boolean)
    /**
     * R => result
     * E => Error result
     */
    sendRequest<R, E, RO>(type: RequestType0<R, E, RO>, token?: CancellationToken): Promise<R>
    /**
     * P => params
     * R => result
     * E => Error result
     */
    sendRequest<P, R, E, RO>(type: RequestType<P, R, E, RO>, params: P, token?: CancellationToken): Promise<R>
    sendRequest<R>(method: string, token?: CancellationToken): Promise<R>
    sendRequest<R>(method: string, param: any, token?: CancellationToken): Promise<R>
    onRequest<R, E, RO>(type: RequestType0<R, E, RO>, handler: RequestHandler0<R, E>): void
    onRequest<P, R, E, RO>(type: RequestType<P, R, E, RO>, handler: RequestHandler<P, R, E>): void
    onRequest<R, E>(method: string, handler: (...params: any[]) => HandlerResult<R, E>): void
    sendNotification<RO>(type: NotificationType0<RO>): void
    sendNotification<P, RO>(type: NotificationType<P, RO>, params?: P): void
    sendNotification(method: string): void
    sendNotification(method: string, params: any): void
    onNotification<RO>(type: NotificationType0<RO>, handler: () => void): void
    onNotification<P, RO>(type: NotificationType<P, RO>, handler: (params: P) => void): void
    onNotification(method: string, handler: (...params: any[]) => void): void
    onProgress<P>(type: ProgressType<any>, token: string | number, handler: (params: P) => void): Disposable
    sendProgress<P>(type: ProgressType<P>, token: string | number, value: P): void

    /**
     * Append info to outputChannel
     */
    info(message: string, data?: any): void
    /**
     * Append warning to outputChannel
     */
    warn(message: string, data?: any): void
    /**
     * append error to outputChannel
     */
    error(message: string, data?: any): void
    getPublicState(): State
    get initializeResult(): InitializeResult | undefined

    get clientOptions(): LanguageClientOptions
    /**
     * Fired on language server state change.
     */
    get onDidChangeState(): Event<StateChangeEvent>
    get outputChannel(): OutputChannel
    get diagnostics(): DiagnosticCollection | undefined

    /**
     * Current running state.
     */
    get serviceState(): ServiceStat
    /**
     * Check if server could start.
     */
    needsStart(): boolean
    /**
     * Check if server could stop.
     */
    needsStop(): boolean
    onReady(): Promise<void>
    get started(): boolean
    set trace(value: Trace)

    /**
     * Stop language server.
     */
    stop(): Promise<void>

    /**
     * Start language server, not needed when registed to services by `services.registLanguageClient`
     */
    start(): Disposable
    /**
     * Restart language client.
     */
    restart(): void

    /**
     * Regist custom feature.
     */
    registerFeature(feature: StaticFeature | DynamicFeature<any>): void

    /**
     * Log failed request to outputChannel.
     */
    logFailedRequest(type: RPCMessageType, error: any): void
  }

  /**
   * Monitor for setting change, restart language server when specified setting changed.
   */
  export class SettingMonitor {
    constructor(client: LanguageClient, setting: string)
    start(): Disposable
  }
  // }}
}
