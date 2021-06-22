import { Neovim, Window, Buffer } from '@chemzqm/neovim'
import log4js from 'log4js'
import { CancellationToken, CompletionTriggerKind, CreateFile, CreateFileOptions, DeleteFile, DeleteFileOptions, Diagnostic, Disposable, DocumentSelector, Event, FormattingOptions, Location, Position, Range, RenameFile, RenameFileOptions, SymbolKind, TextDocumentEdit, TextDocumentSaveReason, TextEdit, WorkspaceEdit, WorkspaceFolder } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { URI } from 'vscode-uri'
import Configurations from './configuration'
import { LanguageClient } from './language-client'
import Document from './model/document'
import FileSystemWatcher from './model/fileSystemWatcher'
import { ProviderResult, TextDocumentContentProvider } from './provider'
import * as protocol from 'vscode-languageserver-protocol'

export type MsgTypes = 'error' | 'warning' | 'more'
export type ExtensionState = 'disabled' | 'loaded' | 'activated' | 'unknown'

export type ProviderName = 'rename' | 'onTypeEdit' | 'documentLink' | 'documentColor'
  | 'foldingRange' | 'format' | 'codeAction' | 'workspaceSymbols' | 'formatRange'
  | 'hover' | 'signature' | 'documentSymbol' | 'documentHighlight' | 'definition'
  | 'declaration' | 'typeDefinition' | 'reference' | 'implementation'
  | 'codeLens' | 'selectionRange' | 'callHierarchy' | 'semanticTokens' | 'linkedEditing'

export interface ParsedUrlQueryInput {
  [key: string]: unknown
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

export interface DiagnosticConfig {
  enableSign: boolean
  locationlistUpdate: boolean
  enableHighlightLineNumber: boolean
  checkCurrentLine: boolean
  enableMessage: string
  displayByAle: boolean
  signPriority: number
  errorSign: string
  warningSign: string
  infoSign: string
  hintSign: string
  level: number
  messageTarget: string
  messageDelay: number
  maxWindowHeight: number
  maxWindowWidth: number
  refreshOnInsertMode: boolean
  virtualText: boolean
  virtualTextCurrentLineOnly: boolean
  virtualTextSrcId: number
  virtualTextPrefix: string
  virtualTextLines: number
  virtualTextLineSeparator: string
  filetypeMap: object
  showUnused?: boolean
  showDeprecated?: boolean
  format?: string
}

export interface DiagnosticEventParams {
  bufnr: number
  uri: string
  diagnostics: ReadonlyArray<Diagnostic>
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

export interface DialogPreferences {
  maxWidth?: number
  maxHeight?: number
  floatHighlight?: string
  floatBorderHighlight?: string
  pickerButtons?: boolean
  pickerButtonShortcut?: boolean
  confirmKey?: string
}

export interface NotificationPreferences {
  top: number
  right: number
  maxWidth: number
  maxHeight: number
  highlight: string
  minProgressWidth: number
}

export interface DialogConfig {
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

export interface NotificationConfig {
  content: string
  /**
   * Optional title text.
   */
  title?: string
  /**
   * Timeout in miliseconds to dismiss notification.
   */
  timeout?: number
  /**
   * show close button, default to true when not specified.
   */
  close?: boolean
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

export type DocumentChange = TextDocumentEdit | CreateFile | RenameFile | DeleteFile

export interface CodeAction extends protocol.CodeAction {
  clientId?: string
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

export interface TaskOptions {
  cmd: string
  args?: string[]
  cwd?: string
  pty?: boolean
  env?: { [key: string]: string }
  detach?: boolean
}

export interface Documentation {
  filetype: string
  content: string
  active?: [number, number]
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

export interface TagDefinition {
  name: string
  cmd: string
  filename: string
}

export interface Autocmd {
  pattern?: string
  event: string | string[]
  arglist?: string[]
  request?: boolean
  thisArg?: any
  callback: Function
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

export interface ErrorItem {
  location: Location
  message: string
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

export type MapMode = 'n' | 'i' | 'v' | 'x' | 's' | 'o'

export enum PatternType {
  Buffer,
  LanguageServer,
  Global,
}

export enum ExtensionType {
  Global,
  Local,
  SingleFile,
  Internal
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
   * @param resource A resource URI.
   * @return `true` if the given section for the given resource (if provided) is affected.
   */
  affectsConfiguration(section: string, resource?: string): boolean
}

export interface LanguageServerConfig {
  module?: string
  command?: string
  transport?: string
  transportPort?: number
  disableWorkspaceFolders?: boolean
  disableSnippetCompletion?: boolean
  disableDynamicRegister?: boolean
  disableCompletion?: boolean
  disableDiagnostics?: boolean
  formatterPriority?: number
  filetypes: string[]
  additionalSchemes: string[]
  enable?: boolean
  args?: string[]
  cwd?: string
  env?: any
  // socket port
  port?: number
  host?: string
  detached?: boolean
  shell?: boolean
  execArgv?: string[]
  rootPatterns?: string[]
  ignoredRootPaths?: string[]
  initializationOptions?: any
  progressOnInitialization?: boolean
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
  source: string
  code: string | number
  message: string
  severity: string
  level: number
  location: Location
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

export interface InsertChange {
  lnum: number
  col: number
  pre: string
  changedtick: number
}

export interface ScreenPosition {
  row: number
  col: number
}

export interface PumBounding {
  readonly height: number
  readonly width: number
  readonly row: number
  readonly col: number
  readonly scrollbar: boolean
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
  // it's not saved by vim, for temporarily usage
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

export interface PopupChangeEvent {
  completed_item: VimCompleteItem
  height: number
  width: number
  row: number
  col: number
  size: number
  scrollbar: boolean
}

export interface CompleteResult {
  items: VimCompleteItem[]
  isIncomplete?: boolean
  startcol?: number
  source?: string
  priority?: number
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

export interface CompleteConfig {
  disableKind: boolean
  disableMenu: boolean
  disableMenuShortcut: boolean
  enablePreview: boolean
  enablePreselect: boolean
  labelMaxLength: number
  floatEnable: boolean
  maxPreviewWidth: number
  autoTrigger: string
  previewIsKeyword: string
  triggerCompletionWait: number
  minTriggerInputLength: number
  triggerAfterInsertEnter: boolean
  acceptSuggestionOnCommitCharacter: boolean
  noselect: boolean
  keepCompleteopt: boolean
  numberSelect: boolean
  maxItemCount: number
  timeout: number
  snippetIndicator: string
  fixInsertedWord: boolean
  localityBonus: boolean
  highPrioritySourceLimit: number
  lowPrioritySourceLimit: number
  removeDuplicateItems: boolean
  defaultSortMethod: string
  asciiCharactersOnly: boolean
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
  oldUri: URI
  newUri: URI
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
  readonly files: ReadonlyArray<{ oldUri: URI, newUri: URI }>;

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
  waitUntil(thenable: Thenable<WorkspaceEdit | any>): void;
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
  readonly files: ReadonlyArray<URI>;

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
  waitUntil(thenable: Thenable<WorkspaceEdit | any>): void;
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
  readonly files: ReadonlyArray<URI>;

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
  waitUntil(thenable: Thenable<WorkspaceEdit | any>): void;
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

export interface TerminalResult {
  bufnr: number
  success: boolean
  content?: string
}

export interface ConfigurationShape {
  workspaceConfigFile: string
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
  // column indexes, end exclusive
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

export interface PreiewOptions {
  bufname?: string
  filetype: string
  lines: string[]
  lnum?: number
  range?: Range
  /**
   * @deprecated not used
   */
  sketch?: boolean
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
   * Always return buffer instead of parsed response.
   */
  buffer?: boolean
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

export interface DownloadOptions extends Omit<FetchOptions, 'buffer'> {
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

export interface AnsiItem {
  foreground?: string
  background?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  text: string
}

export interface ISource {
  // identifier
  name: string
  enable?: boolean
  shortcut?: string
  priority?: number
  sourceType?: SourceType
  optionalFns?: string[]
  triggerCharacters?: string[]
  // should only be used when trigger match.
  triggerOnly?: boolean
  // regex to detect trigger completion, ignored when triggerCharacters exists.
  triggerPatterns?: RegExp[]
  disableSyntaxes?: string[]
  isSnippet?: boolean
  // @deprecated, use documentSelector instead.
  filetypes?: string[]
  // enhanced filter than filetypes
  documentSelector?: DocumentSelector
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
   * Check if this source should doComplete
   *
   * @public
   * @param {CompleteOption} opt
   * @returns {Promise<boolean> }
   */
  shouldComplete?(opt: CompleteOption): Promise<boolean>
  /**
   * Do completion
   *
   * @public
   * @param {CompleteOption} opt
   * @param {CancellationToken} token
   * @returns {Promise<CompleteResult | null>}
   */
  doComplete(opt: CompleteOption, token: CancellationToken): ProviderResult<CompleteResult | null>
  /**
   * Action for complete item on complete item selected
   *
   * @public
   * @param {VimCompleteItem} item
   * @param {CancellationToken} token
   * @returns {Promise<void>}
   */
  onCompleteResolve?(item: VimCompleteItem, token: CancellationToken): ProviderResult<void> | void
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

export type SourceConfig = Omit<Partial<ISource>, 'shortcut' | 'priority' | 'triggerOnly' | 'triggerCharacters' | 'triggerPatterns' | 'enable' | 'filetypes' | 'disableSyntaxes'>
// Config property of source
// export interface SourceConfig extends ISource {
// }

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
  waitUntil(thenable: Thenable<TextEdit[] | any>): void
}

export interface Thenable<T> {
  then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => TResult | Thenable<TResult>): Thenable<TResult>
  // eslint-disable-next-line @typescript-eslint/unified-signatures
  then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => void): Thenable<TResult>
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

export interface DocumentSymbolProviderMetadata {
  /**
   * A human-readable string that is shown when multiple outlines trees show for one document.
   */
  label?: string
}
