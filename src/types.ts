import Document from './model/document'
import FileSystemWatcher from './model/fileSystemWatcher'
import {Neovim} from 'neovim'
import {
  CompletionItemProvider,
} from './provider'
import {
  Event,
  Uri,
  EventEmitter,
  Disposable,
} from './util'
import {
  TextDocument,
  WorkspaceEdit,
  DidChangeTextDocumentParams,
  TextDocumentWillSaveEvent,
} from 'vscode-languageserver-protocol'

export {
  Uri,
  Event,
  EventEmitter,
  Disposable,
  FileSystemWatcher,
  Document,
}

export type Filter = 'word' | 'fuzzy'

export enum SourceType {
  Native,
  Remote,
  Service,
}

// Config property of source
export interface SourceConfig {
  name: string
  priority: number
  filetypes: string[] | null
  sourceType: SourceType
  triggerCharacters: string[]
  shortcut?: string
  firstMatch?: boolean
  filepath?: string
  [index: string]: any
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
  inspect<T>(section: string): { key: string; defaultValue?: T; globalValue?: T; folderValue?: T} | undefined
  /**
   * Update a configuration value. The updated configuration values are persisted.
   *
   *
   * @param section Configuration name, supports _dotted_ names.
   * @param value The new value.
   * @param isGlobal if true, update global configuration
   */
  update(section: string, value: any, isGlobal?: boolean):void

  /**
   * Readable dictionary that backs this configuration.
   */
  readonly [key: string]: any
}

export interface ConfigurationInspect<T> {
  key: string
  defaultValue?: T
  globalValue?: T
  folderValue?: T
}

export interface MainThreadConfigurationShape {
  $updateConfigurationOption(target: ConfigurationTarget, key: string, value: any): Promise<void>
  $removeConfigurationOption(target: ConfigurationTarget, key: string): Promise<void>
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
  folder: IConfigurationModel
}

export enum ConfigurationTarget {
  Default,
  Global,
  Folder
}

export enum DiagnosticKind {
  Syntax,
  Semantic,
  Suggestion,
}

export enum ServiceStat {
  Init,
  Starting,
  Running,
  Restarting,
  Stopped,
}

export interface IWorkSpace {
  root: string
  nvim: Neovim
  textDocuments: TextDocument[]
  /**
   * createFileSystemWatcher
   *
   * @public
   * @param {string} globPattern - pattern for watch
   * @param {boolean} ignoreCreate?
   * @param {boolean} ignoreChange?
   * @param {boolean} ignoreDelete?
   * @returns {FileSystemWatcher}
   */
  createFileSystemWatcher(globPattern: string, ignoreCreate?: boolean, ignoreChange?: boolean, ignoreDelete?: boolean):FileSystemWatcher
  /**
   * Find a directory that contains sub
   * return a valid directory if not found
   *
   * @public
   * @param {string} sub
   * @returns {Promise<string>}
   */
  findDirectory(sub:string):Promise<string>

  /**
   * Save all buffers to disk
   *
   * @public
   * @param {boolean} force
   * @returns {Promise<void>}
   */
  saveAll(force:boolean):Promise<void>

  /**
   * Configuration for section
   *
   * @public
   * @param {string} section
   * @returns {WorkspaceConfiguration}
   */
  getConfiguration(section:string):WorkspaceConfiguration

  /**
   * getDocumentFromUri
   *
   * @public
   * @param {string} uri
   * @returns {Document | null}
   */
  getDocumentFromUri(uri:string):Document | null

  /**
   * apply workspace edit
   *
   * @public
   * @param {WorkspaceEdit} edit
   * @returns {Promise<void>}
   */
  applyEdit(edit: WorkspaceEdit):Promise<void>

  /**
   * refresh buffers
   *
   * @public
   * @returns {Promise<void>}
   */
  refresh():Promise<void>

  /**
   * Create TextDocument at uri, should be a file uri
   *
   * @public
   * @param {string} uri
   * @param {string} languageId?
   * @returns {Promise<TextDocument|null> }  export interface DocumentInfo}
   */
  createDocument(uri:string, languageId?:string):Promise<TextDocument|null>

  onDidEnterTextDocument: Event<DocumentInfo>

  onDidOpenTextDocument: Event<TextDocument>

  onDidCloseTextDocument: Event<TextDocument>

  onDidChangeTextDocument: Event<DidChangeTextDocumentParams>

  onWillSaveTextDocument: Event<TextDocumentWillSaveEvent>

  onDidSaveTextDocument: Event<TextDocument>

  // TODO add configuration change event
}

export interface DocumentInfo {
  bufnr:number
  uri:string
  languageId:string
  iskeyword:string
  expandtab:boolean
  tabstop:number
}

export interface IServiceProvider {
  // unique service name
  name: string
  // supported language types
  languageIds: string[]
  // current state
  state: ServiceStat
  init():void
  dispose():void
  restart():void
  onServiceReady: Event<void>
}

export interface ISource {
  // identifier
  name: string
  disabled: boolean
  priority: number
  sourceType: SourceType
  triggerCharacters: string[]
  filetypes: string[]
  filepath?: string
  // should the first character always match
  firstMatch?: boolean
  /**
   * @public source
   */
  refresh?():Promise<void>
  /**
   * For disable/enable
   *
   * @public source
   */
  toggle?():void
  /**
   * Action for complete item on complete item selected
   *
   * @public
   * @param {VimCompleteItem} item
   * @returns {Promise<void>}
   */
  onCompleteResolve(item:VimCompleteItem):Promise<void>
  /**
   * Action for complete item on complete done
   *
   * @public
   * @param {VimCompleteItem} item
   * @returns {Promise<void>}
   */
  onCompleteDone(item:VimCompleteItem):Promise<void>

  /**
   * Check if this source should work
   *
   * @public
   * @param {CompleteOption} opt
   * @returns {Promise<boolean> }  export interface ILanguage}
   */
  shouldComplete?(opt: CompleteOption): Promise<boolean>

  /**
   * Do completetion
   *
   * @public
   * @param {CompleteOption} opt
   * @returns {Promise<CompleteResult | null>}
   */
  doComplete(opt: CompleteOption): Promise<CompleteResult | null>
}

export interface ILanguage {

  dispose():void

  getCompleteSource(languageId: string): ISource

  registerCompletionItemProvider(
    name: string,
    shortcut: string,
    languageIds: string | string[],
    provider: CompletionItemProvider,
    triggerCharacters?: string[]):Disposable

}
