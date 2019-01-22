import { Neovim, Window } from '@chemzqm/neovim'
import log4js from 'log4js'
import { CompletionTriggerKind, CreateFileOptions, DeleteFileOptions, Diagnostic, DidChangeTextDocumentParams, Disposable, DocumentSelector, Event, FormattingOptions, Location, Position, RenameFileOptions, TextDocument, TextDocumentSaveReason, TextEdit, WorkspaceEdit, WorkspaceFolder, Range } from 'vscode-languageserver-protocol'
import Uri from 'vscode-uri'
import Configurations from './configuration'
import { LanguageClient } from './language-client'
import Document from './model/document'
import FileSystemWatcher from './model/fileSystemWatcher'
import { TextDocumentContentProvider, ProviderResult } from './provider'

export type MsgTypes = 'error' | 'warning' | 'more'
export type ExtensionState = 'disabled' | 'loaded' | 'activited' | 'unknown'

export interface ExtensionInfo {
  id: string
  root: string
  state: ExtensionState
}

export interface ErrorItem {
  location: Location
  message: string
}

export interface DiagnosticItems {
  [owner: string]: Diagnostic[]
}

export interface StatusItemOption {
  progress?: boolean
}

export interface StatusBarItem {
  /**
   * The priority of this item. Higher value means the item should
   * be shown more to the left.
   */
  readonly priority: number

  readonly isProgress: boolean

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

export interface Env {
  completeOpt: string
  readonly filetypeMap: { [index: string]: string }
  readonly isVim: boolean
  readonly isMacvim: boolean
  readonly version: string
}

export interface EditerState {
  document: TextDocument
  position: Position
}

export interface Snippet {
  prefix: string
  body: string
  description: string
}

export interface SnippetProvider {
  getSnippets(language: string): Promise<Snippet[]> | Snippet[]
}

export interface SnippetManager {
  insertSnippet(snippet: string): Promise<boolean>
  cancel(): void
  nextPlaceholder(): Promise<void>
  previousPlaceholder(): Promise<void>
}

export type ModuleResolve = () => Promise<string>

export type MapMode = 'n' | 'i' | 'v' | 'x' | 's'

export enum SourceType {
  Native,
  Remote,
  Service,
}

export enum MessageLevel {
  More,
  Warning,
  Error
}

export interface ChangeInfo {
  lnum: number
  line: string
  changedtick: number
}

/**
 * An event describing the change in Configuration
 */
export interface ConfigurationChangeEvent {

  /**
   * Returns `true` if the given section for the given resource (if provided) is affected.
   *
   * @param section Configuration name, supports _dotted_ names.
   * @param resource A resource Uri.
   * @return `true` if the given section for the given resource (if provided) is affected.
   */
  affectsConfiguration(section: string, resource?: string): boolean
}

export interface LanguageServerConfig {
  module?: string | ModuleResolve
  command?: string
  transport?: string
  transportPort?: number
  filetypes: string[]
  enable: boolean
  args?: string[]
  cwd?: string
  env?: string[]
  // socket port
  port?: number
  host?: string
  detached?: boolean
  shell?: boolean
  execArgv?: string[]
  ignoredRootPaths?: string[]
  initializationOptions?: any
  revealOutputChannelOn?: string
  configSection?: string
  stdioEncoding?: string
  runtime?: string
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
  filename?: string
  bufnr?: number
  lnum: number
  col: number
  text: string
  type?: string,
  valid?: boolean
  nr?: number
}

export interface ChangedLines {
  start: number
  end: number
  replacement: string[]
}

export interface ChangeItem {
  offset: number
  added: string
  removed: string
}

export interface BufferOption {
  eol: number
  bufname: string
  fullpath: string
  buftype: string
  filetype: string
  iskeyword: string
  changedtick: number
}

export interface DiagnosticInfo {
  error: number
  warning: number
  information: number
  hint: number
}

export interface DiagnosticItem {
  file: string
  lnum: number
  col: number
  message: string
  severity: string
  level: number
  location: Location
}

// Config property of source
export interface SourceConfig {
  name: string
  sourceType?: SourceType
  triggerCharacters?: string[]
  optionalFns?: string[]
  shortcut?: string
  filepath?: string
  isSnippet?: boolean
}

export interface RecentScore {
  [index: string]: number
}

/**
 * Contains additional information about the context in which a completion request is triggered.
 */
export interface CompletionContext {
  /**
   * How the completion was triggered.
   */
  triggerKind: CompletionTriggerKind
  /**
   * The trigger character (a single character) that has trigger code complete.
   * Is undefined if `triggerKind !== CompletionTriggerKind.TriggerCharacter`
   */
  triggerCharacter?: string

  option?: CompleteOption
}

// option on complete & should_complete
export interface CompleteOption {
  readonly bufnr: number
  readonly line: string
  readonly rightleft: number
  col: number
  input: string
  filetype: string
  readonly filepath: string
  readonly word: string
  triggerCharacter: string
  // cursor position
  colnr: number
  readonly linenr: number
  readonly synname: string
  triggerForInComplete?: boolean
}

export interface VimCompleteItem {
  word: string
  abbr?: string
  menu?: string
  info?: string
  kind?: string
  icase?: number
  dup?: number
  empty?: number
  user_data?: string
  // it's not saved by vim, for temporarily usage
  score?: number
  sortText?: string
  filterText?: string
  isSnippet?: boolean
  source?: string
  matchScore?: number
  strictMatch?: number
  priority?: number
  preselect?: boolean
  recentScore?: number
  signature?: string
  localBonus?: number
  index?: number
}

export interface CompleteResult {
  items: VimCompleteItem[]
  completeInComplete?: boolean
  duplicate?: boolean
  isIncomplete?: boolean
  engross?: boolean
  startcol?: number
  source?: string
  priority?: number
}

export interface SourceStat {
  name: string
  type: string
  filepath: string
  disabled: boolean
}

export interface CompleteConfig {
  autoTrigger: string
  minTriggerInputLength: number
  triggerAfterInsertEnter: boolean
  acceptSuggestionOnCommitCharacter: boolean
  noselect: boolean
  numberSelect: boolean
  invalidInsertCharacters: string[]
  maxItemCount: number
  timeout: number
  snippetIndicator: string
  fixInsertedWord: boolean
  localityBonus: boolean
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

export interface ConfigurationInspect<T> {
  key: string
  defaultValue?: T
  globalValue?: T
  workspaceValue?: T
}

export interface RenameEvent {
  oldUri: Uri
  newUri: Uri
}

export interface TerminalResult {
  bufnr: number
  success: boolean
  content?: string
}

export interface ConfigurationShape {
  $updateConfigurationOption(target: ConfigurationTarget, key: string, value: any): void
  $removeConfigurationOption(target: ConfigurationTarget, key: string): void
}

export interface IConfigurationModel {
  contents: any
}

export interface IOverrides {
  contents: any
  identifiers: string[]
}

export interface IConfigurationData {
  defaults: IConfigurationModel
  user: IConfigurationModel
  workspace: IConfigurationModel
}

export enum ConfigurationTarget {
  Global,
  User,
  Workspace
}

export enum DiagnosticKind {
  Syntax,
  Semantic,
  Suggestion,
}

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

export interface ListItem {
  label: string
  filterText?: string
  location?: Location
  data?: any
  recentScore?: number
}

export type ListMode = 'normal' | 'insert'

export type Matcher = 'strict' | 'fuzzy' | 'regex'

export interface ListOptions {
  position: string
  input: string
  ignorecase: boolean
  interactive: boolean
  sort: boolean
  mode: ListMode
  matcher: Matcher
  autoPreview: boolean
  numberSelect: boolean
}

export interface ListContext {
  args: string[]
  input: string
  cwd: string
  options: ListOptions
  window: Window
  listWindow: Window
}

export interface ListAction {
  name: string
  persist?: boolean
  reload?: boolean
  parallel?: boolean
  execute: (item: ListItem, context: ListContext) => ProviderResult<void>
}

export interface ListTask {
  on(event: 'data', callback: (item: ListItem) => void)
  on(event: 'end', callback: () => void)
  dispose()
}

export interface IList {
  name: string
  // parse ansi codes form label
  ansi?: boolean
  // support interactive mode
  interactive?: boolean
  description?: string
  defaultAction: string
  actions: ListAction[]
  loadItems(context: ListContext): Promise<ListItem[] | ListTask | null | undefined>
  doHighlight(): void
  dispose(): void
}

export interface ISource {
  // identifier
  name: string
  enable: boolean
  priority: number
  sourceType: SourceType
  triggerCharacters?: string[]
  duplicate?: boolean
  isSnippet?: boolean
  filetypes?: string[]
  filepath?: string
  // should the first character always match
  firstMatch?: boolean
  /**
   * @public source
   */
  refresh?(): Promise<void>
  /**
   * For disable/enable
   *
   * @public source
   */
  toggle?(): void

  /**
   * Used for cache normally
   *
   * @returns {undefined}
   */
  onEnter?(bufnr: number): void

  /**
   * Do completetion
   *
   * @public
   * @param {CompleteOption} opt
   * @returns {Promise<CompleteResult | null>}
   */
  doComplete(opt: CompleteOption): Promise<CompleteResult | null>
  /**
   * Action for complete item on complete item selected
   *
   * @public
   * @param {VimCompleteItem} item
   * @returns {Promise<void>}
   */
  onCompleteResolve?(item: VimCompleteItem): Promise<void> | void
  /**
   * Action for complete item on complete done
   *
   * @public
   * @param {VimCompleteItem} item
   * @returns {Promise<void>}
   */
  onCompleteDone?(item: VimCompleteItem, opt: CompleteOption): Promise<void>
  /**
   * Check if this source should work
   *
   * @public
   * @param {CompleteOption} opt
   * @returns {Promise<boolean> }
   */
  shouldComplete?(opt: CompleteOption): Promise<boolean>

  shouldCommit?(item: VimCompleteItem, character: string): boolean
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
  reason: TextDocumentSaveReason

  /**
   * Allows to pause the event loop and to apply [pre-save-edits](#TextEdit).
   * Edits of subsequent calls to this function will be applied in order. The
   * edits will be *ignored* if concurrent modifications of the document happened.
   *
   * *Note:* This function can only be called during event dispatch and not
   * in an asynchronous manner:
   *
   * @param thenable A thenable that resolves to [pre-save-edits](#TextEdit).
   */
  waitUntil?(thenable: Thenable<TextEdit[] | any>): void
}

export interface Thenable<T> {
  then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => TResult | Thenable<TResult>): Thenable<TResult>
  then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => void): Thenable<TResult> // tslint:disable-line
}

/**
 * An output channel is a container for readonly textual information.
 *
 * To get an instance of an `OutputChannel` use
 * [createOutputChannel](#workspace.createOutputChannel).
 */
export interface OutputChannel {

  /**
   * The human-readable name of this output channel.
   */
  readonly name: string

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
   * Removes all output from the channel.
   */
  clear(): void

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

  logger: log4js.Logger
}

export interface IWorkspace {
  readonly nvim: Neovim
  readonly cwd: string
  readonly root: string
  readonly isVim: boolean
  readonly isNvim: boolean
  readonly filetypes: Set<string>
  readonly pluginRoot: string
  readonly initialized: boolean
  readonly completeOpt: string
  readonly channelNames: string[]
  readonly documents: Document[]
  readonly configurations: Configurations
  document: Promise<Document | null>
  textDocuments: TextDocument[]
  workspaceFolder: WorkspaceFolder
  onDidOpenTextDocument: Event<TextDocument>
  onDidCloseTextDocument: Event<TextDocument>
  onDidChangeTextDocument: Event<DidChangeTextDocumentParams>
  onWillSaveTextDocument: Event<TextDocumentWillSaveEvent>
  onDidSaveTextDocument: Event<TextDocument>
  onDidChangeConfiguration: Event<ConfigurationChangeEvent>
  onDidWorkspaceInitialized: Event<void>
  onWillSaveUntil(callback: (event: TextDocumentWillSaveEvent) => void, thisArg: any, clientId: string): Disposable
  showMessage(msg: string, identify?: MsgTypes): void
  findUp(filename: string | string[]): Promise<string | null>
  getDocument(uri: number | string): Document
  getOffset(): Promise<number>
  getFormatOptions(uri?: string): Promise<FormattingOptions>
  getConfigFile(target: ConfigurationTarget): string
  applyEdit(edit: WorkspaceEdit): Promise<boolean>
  createFileSystemWatcher(globPattern: string, ignoreCreate?: boolean, ignoreChange?: boolean, ignoreDelete?: boolean): FileSystemWatcher
  getConfiguration(section?: string, _resource?: string): WorkspaceConfiguration
  registerTextDocumentContentProvider(scheme: string, provider: TextDocumentContentProvider): Disposable
  getQuickfixItem(loc: Location, text?: string, type?: string): Promise<QuickfixItem>
  getLine(uri: string, line: number): Promise<string>
  readFile(uri: string): Promise<string>
  echoLines(lines: string[], truncate?: boolean): Promise<void>
  getCurrentState(): Promise<EditerState>
  getCursorPosition(): Promise<Position>
  jumpTo(uri: string, position: Position): Promise<void>
  createFile(filepath: string, opts?: CreateFileOptions): Promise<void>
  renameFile(oldPath: string, newPath: string, opts?: RenameFileOptions): Promise<void>
  deleteFile(filepath: string, opts?: DeleteFileOptions): Promise<void>
  openResource(uri: string): Promise<void>
  createOutputChannel(name: string): OutputChannel
  showOutputChannel(name: string): void
  resolveModule(name: string): Promise<string>
  showQuickpick(items: string[], placeholder?: string): Promise<number>
  showPrompt(title: string): Promise<boolean>
  requestInput(title: string, defaultValue?: string): Promise<string>
  match(selector: DocumentSelector, document: TextDocument): number
  runCommand(cmd: string, cwd?: string, timeout?: number): Promise<string>
  runTerminalCommand(cmd: string, cwd?: string, keepfocus?: boolean): Promise<TerminalResult>
  createStatusBarItem(priority?: number): StatusBarItem
  dispose(): void
}
