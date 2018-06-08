
export type Filter = 'word' | 'fuzzy'

// Config property of source
export interface SourceConfig {
  shortcut: string
  priority: number
  filetypes: string[] | null
  filterAbbr: boolean
  // remote source only
  firstMatch: boolean
  [index: string]: any
}

// options for init source
export interface SourceOption {
  name: string
  shortcut?: string
  filetypes?: string[]
  priority?: number
  optionalFns?: string[]
  filterAbbr?: boolean
  // remote source only
  firstMatch?: boolean
  showSignature?: boolean
  bindKeywordprg?: boolean
  signatureEvents?: string[]
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
  // cursor position
  colnr: number
  linenr: number
  iskeyword: string
  moved?: number
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
}

export type FilterType = 'abbr' | 'word'

export interface CompleteResult {
  items: VimCompleteItem[]
  engross?: boolean
  startcol?: number
  source?: string
  firstMatch?: boolean
  filter?: FilterType
  priority?: number
}

export interface Config {
  hasUserData: boolean
  completeOpt: string
  fuzzyMatch: boolean
  timeout: number
  checkGit: boolean
  disabled: string[]
  incrementHightlight: boolean
  noSelect: boolean
  sources: {[index: string]: Partial<SourceConfig>}
  signatureEvents: string[]
}

export interface SourceStat {
  name: string
  type: 'remote' | 'native'
  disabled: boolean
  filepath: string
}

export interface QueryOption {
  filetype: string
  filename: string
  content: string
  col: number
  lnum: number
}

export interface FormatOptions {
  tabSize: number
  insertSpaces: boolean
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
