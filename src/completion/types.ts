import type { CancellationToken, DocumentSelector } from 'vscode-languageserver-protocol'
import type { CompletionItem, CompletionItemKind, CompletionItemLabelDetails, InsertTextFormat, InsertTextMode, Position, Range } from 'vscode-languageserver-types'
import type { ProviderResult } from '../provider'
import type { Documentation } from '../types'

export type EditRange = Range | { insert: Range, replace: Range }

export interface ItemDefaults {
  commitCharacters?: string[]
  editRange?: EditRange
  insertTextFormat?: InsertTextFormat
  insertTextMode?: InsertTextMode
  data?: any
}

// option on complete & should_complete
// what need change? line, col, input, colnr, changedtick
// word = '', triggerForInComplete = false
export interface CompleteOption {
  readonly position: Position
  readonly bufnr: number
  readonly line: string
  col: number
  input: string
  filetype: string
  readonly filepath: string
  readonly word: string
  readonly followWord: string
  // cursor position
  colnr: number
  synname?: string
  readonly linenr: number
  readonly source?: string
  readonly changedtick: number
  readonly triggerCharacter?: string
  triggerForInComplete?: boolean
}

export interface CompleteDoneOption extends CompleteOption {
  readonly snippetsSupport: boolean
  readonly insertMode: InsertMode
}

// For filter, render and resolve
export interface DurationCompleteItem {
  word: string
  abbr: string
  filterText: string
  readonly source: ISource
  readonly priority: number
  readonly shortcut?: string
  // start character for word insert
  character: number
  isSnippet?: boolean
  insertText?: string
  // copied from CompleteItem
  menu?: string
  kind?: string | CompletionItemKind
  dup?: boolean
  // start character for filter text
  delta: number
  preselect?: boolean
  sortText?: string
  deprecated?: boolean
  detail?: string
  labelDetails?: CompletionItemLabelDetails
  // Generated
  localBonus?: number
  score?: number
  positions?: ReadonlyArray<number>
  /**
   * labelDetail rendered after label
   */
  detailRendered?: boolean
}

export interface VimCompleteItem {
  word: string
  abbr?: string
  menu?: string
  info?: string
  kind?: string | CompletionItemKind
  equal?: number
  dup?: number
  preselect?: boolean
  user_data?: string
  detail?: string
}

export interface ExtendedCompleteItem extends VimCompleteItem {
  deprecated?: boolean
  labelDetails?: CompletionItemLabelDetails
  sortText?: string
  filterText?: string
  // could be snippet
  insertText?: string
  isSnippet?: boolean
  documentation?: Documentation[]
}

export enum InsertMode {
  Insert = 'insert',
  Repalce = 'replace',
}

export interface CompleteConfig {
  asciiMatch: boolean
  insertMode: InsertMode
  autoTrigger: string
  filterGraceful: boolean
  snippetsSupport: boolean
  languageSourcePriority: number
  triggerCompletionWait: number
  minTriggerInputLength: number
  triggerAfterInsertEnter: boolean
  acceptSuggestionOnCommitCharacter: boolean
  maxItemCount: number
  timeout: number
  localityBonus: boolean
  highPrioritySourceLimit: number
  lowPrioritySourceLimit: number
  removeDuplicateItems: boolean
  defaultSortMethod: SortMethod
  asciiCharactersOnly: boolean
  enableFloat: boolean
  ignoreRegexps: ReadonlyArray<string>
}

export enum SortMethod {
  None = 'none',
  Alphabetical = 'alphabetical',
  Length = 'length'
}

/**
 * Item returned from source
 */
export type CompleteItem = ExtendedCompleteItem | CompletionItem

export interface CompleteResult<T extends CompleteItem> {
  items: T[]
  isIncomplete?: boolean
  itemDefaults?: Readonly<ItemDefaults>
  startcol?: number
}

export enum CompleteFinishKind {
  Normal = '',
  Confirm = 'confirm',
  Cancel = 'cancel',
}

export type CompleteDoneItem = CompleteItem & {
  readonly word: string
  readonly source: string
  readonly user_data: string
}

export enum SourceType {
  Native,
  Remote,
  Service,
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

export interface SourceConfig<T extends ExtendedCompleteItem = ExtendedCompleteItem> {
  name: string
  triggerOnly?: boolean
  isSnippet?: boolean
  sourceType?: SourceType
  filepath?: string
  documentSelector?: DocumentSelector
  firstMatch?: boolean
  optionalFns?: string[]
  refresh?(): Promise<void>
  toggle?(): void
  onEnter?(bufnr: number): void
  shouldComplete?(opt: CompleteOption): ProviderResult<boolean>
  doComplete(opt: CompleteOption, token: CancellationToken): ProviderResult<CompleteResult<T>>
  onCompleteResolve?(item: T, opt: CompleteOption, token: CancellationToken): ProviderResult<void>
  onCompleteDone?(item: T, opt: CompleteOption): ProviderResult<void>
  shouldCommit?(item: T, character: string): boolean
}

export interface ISource<T extends CompleteItem = CompleteItem> {
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
  shouldComplete?(opt: CompleteOption): ProviderResult<boolean>
  doComplete(opt: CompleteOption, token: CancellationToken): ProviderResult<CompleteResult<T>>
  onCompleteResolve?(item: T, opt: CompleteOption, token: CancellationToken): ProviderResult<void>
  onCompleteDone?(item: T, opt: CompleteDoneOption): ProviderResult<void>
  shouldCommit?(item: T, character: string): boolean
  dispose?(): void
}
