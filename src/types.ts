// vim: set sw=2 ts=2 sts=2 et foldmarker={{,}} foldmethod=marker foldlevel=0 nofen:
import { Neovim, Window, Buffer } from '@chemzqm/neovim'
import { CancellationToken, CreateFile, CreateFileOptions, DeleteFile, DeleteFileOptions, Disposable, DocumentSelector, Event, FormattingOptions, Location, Position, Range, RenameFile, RenameFileOptions, TextDocumentEdit, TextDocumentSaveReason, TextEdit, WorkspaceEdit, WorkspaceFolder } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import Configurations from './configuration'
import Document from './model/document'
import FileSystemWatcher from './model/fileSystemWatcher'
import { ProviderResult, TextDocumentContentProvider } from './provider'

export interface Thenable<T> {
  then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => TResult | Thenable<TResult>): Thenable<TResult>
  // eslint-disable-next-line @typescript-eslint/unified-signatures
  then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => void): Thenable<TResult>
}

export type ProviderName = 'rename' | 'onTypeEdit' | 'documentLink' | 'documentColor'
  | 'foldingRange' | 'format' | 'codeAction' | 'workspaceSymbols' | 'formatRange' | 'formatOnType'
  | 'hover' | 'signature' | 'documentSymbol' | 'documentHighlight' | 'definition'
  | 'declaration' | 'typeDefinition' | 'reference' | 'implementation'
  | 'codeLens' | 'selectionRange' | 'callHierarchy' | 'semanticTokens' | 'linkedEditing'

export interface CurrentState {
  doc: Document
  winid: number
  position: Position
  // :h mode()
  mode: string
}

export interface HandlerDelegate {
  checkProvier: (id: ProviderName, document: TextDocument) => void
  withRequestToken: <T> (name: string, fn: (token: CancellationToken) => Thenable<T>, checkEmpty?: boolean) => Promise<T>
  getCurrentState: () => Promise<CurrentState>
  addDisposable: (disposable: Disposable) => void
}

/**
 * Represent a highlight that not cross lines
 * all zero based.
 */
export interface HighlightItem {
  lnum: number
  hlGroup: string
  /**
   * 0 based start column.
   */
  colStart: number
  /**
   * 0 based end column.
   */
  colEnd: number
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

export interface Env {
  completeOpt: string
  runtimepath: string
  disabledSources: { [filetype: string]: string[] }
  readonly guicursor: string
  readonly mode: string
  readonly apiversion: number
  readonly floating: boolean
  readonly sign: boolean
  readonly extensionRoot: string
  readonly globalExtensions: string[]
  readonly workspaceFolders: string[]
  readonly config: any
  readonly pid: number
  readonly columns: number
  readonly lines: number
  readonly pumevent: boolean
  readonly cmdheight: number
  readonly filetypeMap: { [index: string]: string }
  readonly isVim: boolean
  readonly isCygwin: boolean
  readonly isMacvim: boolean
  readonly isiTerm: boolean
  readonly version: string
  readonly locationlist: boolean
  readonly progpath: string
  readonly dialog: boolean
  readonly textprop: boolean
  readonly updateHighlight: boolean
  readonly vimCommands: CommandConfig[]
}

export interface CommandConfig {
  id: string
  cmd: string
  title?: string
}

export interface EditerState {
  document: TextDocument
  position: Position
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
  textDocuments: TextDocument[]
  workspaceFolder: WorkspaceFolder
  onDidOpenTextDocument: Event<TextDocument & { bufnr: number }>
  onDidCloseTextDocument: Event<TextDocument & { bufnr: number }>
  onDidChangeTextDocument: Event<DidChangeTextDocumentParams>
  onWillSaveTextDocument: Event<TextDocumentWillSaveEvent>
  onDidSaveTextDocument: Event<TextDocument>
  onDidChangeConfiguration: Event<ConfigurationChangeEvent>
  onDidWorkspaceInitialized: Event<void>
  findUp(filename: string | string[]): Promise<string | null>
  getDocument(uri: number | string): Document
  getFormatOptions(uri?: string): Promise<FormattingOptions>
  getConfigFile(target: ConfigurationTarget): string
  applyEdit(edit: WorkspaceEdit): Promise<boolean>
  createFileSystemWatcher(globPattern: string, ignoreCreate?: boolean, ignoreChange?: boolean, ignoreDelete?: boolean): FileSystemWatcher
  getConfiguration(section?: string, _resource?: string): WorkspaceConfiguration
  registerTextDocumentContentProvider(scheme: string, provider: TextDocumentContentProvider): Disposable
  getQuickfixItem(loc: Location, text?: string, type?: string): Promise<QuickfixItem>
  getLine(uri: string, line: number): Promise<string>
  readFile(uri: string): Promise<string>
  getCurrentState(): Promise<EditerState>
  jumpTo(uri: string, position: Position): Promise<void>
  createFile(filepath: string, opts?: CreateFileOptions): Promise<void>
  renameFile(oldPath: string, newPath: string, opts?: RenameFileOptions): Promise<void>
  deleteFile(filepath: string, opts?: DeleteFileOptions): Promise<void>
  openResource(uri: string): Promise<void>
  resolveModule(name: string): Promise<string>
  match(selector: DocumentSelector, document: TextDocument): number
  runCommand(cmd: string, cwd?: string, timeout?: number): Promise<string>
  dispose(): void
}

// vim {{
export interface LocationListItem {
  bufnr: number
  lnum: number
  col: number
  text: string
  type: string
}

export interface QuickfixItem {
  uri?: string
  module?: string
  range?: Range
  text?: string
  type?: string
  filename?: string
  bufnr?: number
  lnum?: number
  col?: number
  valid?: boolean
  nr?: number
}
// }}

// Enums{{
export enum PatternType {
  Buffer,
  LanguageServer,
  Global,
}

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

export enum ConfigurationTarget {
  Global,
  User,
  Workspace
}

export enum ServiceStat {
  Initial,
  Starting,
  StartFailed,
  Running,
  Stopping,
  Stopped,
}

export enum FileType {
  /**
   * The file type is unknown.
   */
  Unknown = 0,
  /**
   * A regular file.
   */
  File = 1,
  /**
   * A directory.
   */
  Directory = 2,
  /**
   * A symbolic link to a file.
   */
  SymbolicLink = 64
}
// }}

// TextDocument {{
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
  waitUntil(thenable: Thenable<TextEdit[] | any>): void
}

export type DocumentChange = TextDocumentEdit | CreateFile | RenameFile | DeleteFile

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
// }}

// Completion {{
export interface Documentation {
  filetype: string
  content: string
  active?: [number, number]
}

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

export interface ExtendedCompleteItem extends VimCompleteItem {
  score?: number
  sortText?: string
  sourceScore?: number
  filterText?: string
  isSnippet?: boolean
  source?: string
  matchScore?: number
  priority?: number
  preselect?: boolean
  recentScore?: number
  signature?: string
  localBonus?: number
  index?: number
  // used for preview
  documentation?: Documentation[]
  detailShown?: number
  // saved line for apply TextEdit
  line?: string
}

export interface CompleteResult {
  items: ExtendedCompleteItem[]
  isIncomplete?: boolean
  startcol?: number
  source?: string
  priority?: number
}

export interface RecentScore {
  [index: string]: number
}

// option on complete & should_complete
export interface CompleteOption {
  readonly bufnr: number
  readonly line: string
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
  readonly source?: string
  readonly blacklist: string[]
  readonly changedtick: number
  triggerForInComplete?: boolean
}

export interface SourceStat {
  name: string
  priority: number
  triggerCharacters: string[]
  type: string
  shortcut: string
  filepath: string
  disabled: boolean
  filetypes: string[]
}

export type SourceConfig = Omit<Partial<ISource>, 'shortcut' | 'priority' | 'triggerOnly' | 'triggerCharacters' | 'triggerPatterns' | 'enable' | 'filetypes' | 'disableSyntaxes'>

export interface ISource {
  name: string
  enable?: boolean
  shortcut?: string
  priority?: number
  sourceType?: SourceType
  optionalFns?: string[]
  triggerCharacters?: string[]
  triggerOnly?: boolean
  triggerPatterns?: RegExp[]
  disableSyntaxes?: string[]
  isSnippet?: boolean
  filetypes?: string[]
  documentSelector?: DocumentSelector
  filepath?: string
  firstMatch?: boolean
  refresh?(): Promise<void>
  toggle?(): void
  onEnter?(bufnr: number): void
  shouldComplete?(opt: CompleteOption): Promise<boolean>
  doComplete(opt: CompleteOption, token: CancellationToken): ProviderResult<CompleteResult | null>
  onCompleteResolve?(item: ExtendedCompleteItem, token: CancellationToken): ProviderResult<void> | void
  onCompleteDone?(item: ExtendedCompleteItem, opt: CompleteOption): ProviderResult<void>
  shouldCommit?(item: ExtendedCompleteItem, character: string): boolean
}
// }}

// Configuration {{
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

export interface ConfigurationShape {
  workspaceConfigFile: string
  $updateConfigurationOption(target: ConfigurationTarget, key: string, value: any): void
  $removeConfigurationOption(target: ConfigurationTarget, key: string): void
}

export interface IConfigurationModel {
  contents: any
}

export interface IConfigurationData {
  defaults: IConfigurationModel
  user: IConfigurationModel
  workspace: IConfigurationModel
}
// }}

// File operation {{
/**
 * An event that is fired when files are going to be renamed.
 *
 * To make modifications to the workspace before the files are renamed,
 * call the [`waitUntil](#FileWillCreateEvent.waitUntil)-function with a
 * thenable that resolves to a [workspace edit](#WorkspaceEdit).
 */
export interface FileWillRenameEvent {

  /**
   * The files that are going to be renamed.
   */
  readonly files: ReadonlyArray<{ oldUri: URI, newUri: URI }>

  /**
   * Allows to pause the event and to apply a [workspace edit](#WorkspaceEdit).
   *
   * *Note:* This function can only be called during event dispatch and not
   * in an asynchronous manner:
   *
   * ```ts
   * workspace.onWillCreateFiles(event => {
   * 	// async, will *throw* an error
   * 	setTimeout(() => event.waitUntil(promise));
   *
   * 	// sync, OK
   * 	event.waitUntil(promise);
   * })
   * ```
   *
   * @param thenable A thenable that delays saving.
   */
  waitUntil(thenable: Thenable<WorkspaceEdit | any>): void
}

/**
 * An event that is fired after files are renamed.
 */
export interface FileRenameEvent {

  /**
   * The files that got renamed.
   */
  readonly files: ReadonlyArray<{ oldUri: URI, newUri: URI }>
}

/**
 * An event that is fired when files are going to be created.
 *
 * To make modifications to the workspace before the files are created,
 * call the [`waitUntil](#FileWillCreateEvent.waitUntil)-function with a
 * thenable that resolves to a [workspace edit](#WorkspaceEdit).
 */
export interface FileWillCreateEvent {

  /**
   * The files that are going to be created.
   */
  readonly files: ReadonlyArray<URI>

  /**
   * Allows to pause the event and to apply a [workspace edit](#WorkspaceEdit).
   *
   * *Note:* This function can only be called during event dispatch and not
   * in an asynchronous manner:
   *
   * ```ts
   * workspace.onWillCreateFiles(event => {
   *     // async, will *throw* an error
   *     setTimeout(() => event.waitUntil(promise));
   *
   *     // sync, OK
   *     event.waitUntil(promise);
   * })
   * ```
   *
   * @param thenable A thenable that delays saving.
   */
  waitUntil(thenable: Thenable<WorkspaceEdit | any>): void
}

/**
 * An event that is fired after files are created.
 */
export interface FileCreateEvent {

  /**
   * The files that got created.
   */
  readonly files: ReadonlyArray<URI>
}

/**
 * An event that is fired when files are going to be deleted.
 *
 * To make modifications to the workspace before the files are deleted,
 * call the [`waitUntil](#FileWillCreateEvent.waitUntil)-function with a
 * thenable that resolves to a [workspace edit](#WorkspaceEdit).
 */
export interface FileWillDeleteEvent {

  /**
   * The files that are going to be deleted.
   */
  readonly files: ReadonlyArray<URI>

  /**
   * Allows to pause the event and to apply a [workspace edit](#WorkspaceEdit).
   *
   * *Note:* This function can only be called during event dispatch and not
   * in an asynchronous manner:
   *
   * ```ts
   * workspace.onWillCreateFiles(event => {
   *     // async, will *throw* an error
   *     setTimeout(() => event.waitUntil(promise));
   *
   *     // sync, OK
   *     event.waitUntil(promise);
   * })
   * ```
   *
   * @param thenable A thenable that delays saving.
   */
  waitUntil(thenable: Thenable<WorkspaceEdit | any>): void
}

/**
 * An event that is fired after files are deleted.
 */
export interface FileDeleteEvent {

  /**
   * The files that got deleted.
   */
  readonly files: ReadonlyArray<URI>
}
// }}

// List {{
export interface LocationWithLine {
  uri: string
  line: string
  text?: string
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
  // column indexes
  spans: [number, number][]
  hlGroup?: string
}

export interface ListItemWithHighlights extends ListItem {
  highlights?: ListHighlights
}

export interface AnsiHighlight {
  span: [number, number]
  hlGroup: string
}

export interface ListItemsEvent {
  items: ListItem[]
  finished: boolean
  append?: boolean
  reload?: boolean
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
  noQuit: boolean
  first: boolean
}

export interface ListContext {
  args: string[]
  input: string
  cwd: string
  options: ListOptions
  window: Window
  buffer: Buffer
  listWindow: Window
}

export interface ListAction {
  name: string
  persist?: boolean
  reload?: boolean
  parallel?: boolean
  multiple?: boolean
  execute: (item: ListItem | ListItem[], context: ListContext) => ProviderResult<void>
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
   * Action list.
   */
  actions: ListAction[]
  /**
   * Default action name.
   */
  defaultAction: string
  /**
   * Load list items.
   */
  loadItems(context: ListContext, token: CancellationToken): Promise<ListItem[] | ListTask | null | undefined>
  /**
   * Resolve list item.
   */
  resolveItem?(item: ListItem): Promise<ListItem | null>
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
   * Highlight buffer by vim's syntax commands.
   */
  doHighlight?(): void
  dispose?(): void
}
// }}
