import { Neovim } from '@chemzqm/neovim'
import { Diagnostic, DidChangeTextDocumentParams, Disposable, DocumentSelector, Event, Location, Position, TextDocument, TextDocumentSaveReason, TextEdit, WorkspaceEdit, WorkspaceFolder } from 'vscode-languageserver-protocol'
import Document from './model/document'
import FileSystemWatcher from './model/fileSystemWatcher'
import { FormattingOptions } from './provider'

export type MsgTypes = 'error' | 'warning' | 'more'

export interface EditerState {
  document: TextDocument
  position: Position
}

export type Filter = 'word' | 'fuzzy'

export type ModuleResolve = () => Promise<string>

export interface WinEnter {
  document: TextDocument | null
  winid: number
}

export enum SourceType {
  Native,
  Remote,
  Service,
}

export interface ChangeInfo {
  lnum: number
  line: string
  changedtick: number
}

export interface LanguageServerConfig {
  module?: string | ModuleResolve
  command?: string
  filetypes: string[]
  enable: boolean
  args?: string[]
  cwd?: string
  // socket port
  port?: number
  host?: string
  detached?: boolean
  shell?: boolean
  execArgv?: string[]
  initializationOptions?: any
  configSection?: string
  forceFullSync?: boolean
  [index: string]: any
}

export interface LocationListItem {
  bufnr: number
  lnum: number
  col: number
  text: string
  type: string
}

export interface QuickfixItem {
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
  fullpath: string
  buftype: string
  filetype: string
  iskeyword: string
  changedtick: number
  expandtab: boolean
  tabstop: number
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
}

// Config property of source
export interface SourceConfig {
  name: string
  sourceType?: SourceType
  triggerCharacters?: string[]
  optionalFns?: string[]
  shortcut?: string
  filepath?: string
}

export interface RecentScore {
  [index: string]: number
}

// option on complete & should_complete
export interface CompleteOption {
  id: number
  bufnr: number
  line: string
  col: number
  input: string
  buftype: string
  filetype: string
  filepath: string
  word: string
  changedtick: number
  triggerCharacter: string
  // cursor position
  colnr: number
  linenr: number
  iskeyword: string
  custom: boolean
  [index: string]: any
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
  score?: number
  // it's not saved by vim, for temporarily usage
  sortText?: string
  filterText?: string
  isSnippet?: boolean
}

export interface CompleteResult {
  items: VimCompleteItem[]
  isIncomplete?: boolean
  engross?: boolean
  startcol?: number
  source?: string
  priority?: number
}

export interface Config {
  hasUserData: boolean
  completeOpt: string
  watchmanBinaryPath: string
}

export interface SourceStat {
  name: string
  type: string
  filepath: string
  disabled: boolean
}

export interface QueryOption {
  filetype: string
  filename: string
  content: string
  col: number
  lnum: number
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
   * @param isGlobal if true, update global configuration
   */
  update(section: string, value: any, isGlobal?: boolean): void

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

export interface DocumentInfo {
  bufnr: number
  uri: string
  languageId: string
}

export interface IServiceProvider {
  // unique service id
  id: string
  name: string
  enable: boolean
  // supported language types
  languageIds: string[]
  // current state
  state: ServiceStat
  init(): Promise<void>
  dispose(): void
  stop(): Promise<void> | void
  restart(): Promise<void> | void
  onServiceReady: Event<void>
}

export interface ISource {
  // identifier
  name: string
  enable: boolean
  priority: number
  sourceType: SourceType
  triggerCharacters: string[]
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
  onEnter?(info: DocumentInfo): void

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
  onCompleteResolve?(item: VimCompleteItem): Promise<void>
  /**
   * Action for complete item on complete done
   *
   * @public
   * @param {VimCompleteItem} item
   * @returns {Promise<void>}
   */
  onCompleteDone?(item: VimCompleteItem): Promise<void>

  /**
   * Check if this source should work
   *
   * @public
   * @param {CompleteOption} opt
   * @returns {Promise<boolean> }
   */
  shouldComplete?(opt: CompleteOption): Promise<boolean>
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

export interface IWorkspace {
  nvim: Neovim
  bufnr: number
  // root of current file or cwd
  root: string
  isVim: boolean
  isNvim: boolean
  filetypes: Set<string>
  pluginRoot: string
  initialized: boolean
  completeOpt: string
  channelNames: string[]
  documents: Document[]
  document: Promise<Document | null>
  textDocuments: TextDocument[]
  workspaceFolder: WorkspaceFolder
  onDidEnterTextDocument: Event<DocumentInfo>
  onDidOpenTextDocument: Event<TextDocument>
  onDidBufWinEnter: Event<WinEnter>
  onDidCloseTextDocument: Event<TextDocument>
  onDidChangeTextDocument: Event<DidChangeTextDocumentParams>
  onWillSaveTextDocument: Event<TextDocumentWillSaveEvent>
  onDidSaveTextDocument: Event<TextDocument>
  onDidChangeConfiguration: Event<WorkspaceConfiguration>
  onDidWorkspaceInitialized: Event<void>
  onWillSaveUntil(callback: (event: TextDocumentWillSaveEvent) => void, thisArg: any, clientId: string): Disposable
  showMessage(msg: string, identify?: MsgTypes): void
  getDocument(uri: string | number): Document
  getDocument(bufnr: number): Document | null
  getOffset(): Promise<number>
  getFormatOptions(uri?: string): Promise<FormattingOptions>
  getConfigFile(target: ConfigurationTarget): string
  applyEdit(edit: WorkspaceEdit): Promise<boolean>
  createFileSystemWatcher(globPattern: string, ignoreCreate?: boolean, ignoreChange?: boolean, ignoreDelete?: boolean): FileSystemWatcher
  getConfiguration(section?: string, _resource?: string): WorkspaceConfiguration
  getQuickfixItem(loc: Location): Promise<QuickfixItem>
  getLine(uri: string, line: number): Promise<string>
  readFile(uri: string): Promise<string>
  echoLines(lines: string[]): Promise<void>
  getCurrentState(): Promise<EditerState>
  jumpTo(uri: string, position: Position): Promise<void>
  createFile(filepath: string, opts: { ignoreIfExists?: boolean }): Promise<void>
  openResource(uri: string): Promise<void>
  createOutputChannel(name: string): OutputChannel
  showOutputChannel(name: string): void
  resolveModule(name: string, section: string, silent?): Promise<string>
  showQuickpick(items: string[], placeholder?: string): Promise<number>
  showPrompt(title: string): Promise<boolean>
  match(selector: DocumentSelector, document: TextDocument): number
  runCommand(cmd: string, cwd?: string, timeout?: number): Promise<string>
  runTerminalCommand(cmd: string, cwd?: string): Promise<TerminalResult>
  dispose(): void
}
