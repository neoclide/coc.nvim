'use strict'
import type { Window } from '@chemzqm/neovim'
import type { CancellationToken, Disposable, Event } from 'vscode-languageserver-protocol'
import type { TextDocument } from 'vscode-languageserver-textdocument'
import type { CodeAction, CodeActionKind, CreateFile, DeleteFile, Location, Position, Range, RenameFile, SymbolKind, TextDocumentEdit } from 'vscode-languageserver-types'
import type { URI } from 'vscode-uri'
import type { ProviderName } from './languages'
import type Document from './model/document'
import type RelativePattern from './model/relativePattern'

export { IConfigurationChangeEvent } from './configuration/types'

export type GlobPattern = string | RelativePattern

declare global {
  namespace NodeJS {
    interface Global {
      __TEST__?: boolean
      __starttime?: number
      REVISION?: string
      WebAssembly: any
    }
  }
}
export type Optional<T extends object, K extends keyof T = keyof T> = Omit<
  T,
  K
> &
  Partial<Pick<T, K>>

export interface Thenable<T> {
  then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => TResult | Thenable<TResult>): Thenable<TResult>
  // eslint-disable-next-line @typescript-eslint/unified-signatures
  then<TResult>(onfulfilled?: (value: T) => TResult | Thenable<TResult>, onrejected?: (reason: any) => void): Thenable<TResult>
}

export interface AnsiHighlight {
  span: [number, number]
  hlGroup: string
}

export interface LocationWithTarget extends Location {
  /**
   * The full target range of this link. If the target for example is a symbol then target range is the
   * range enclosing this symbol not including leading/trailing whitespace but everything else
   * like comments. This information is typically used to highlight the range in the editor.
   */
  targetRange?: Range
}

export interface CurrentState {
  doc: Document
  winid: number
  position: Position
  // :h mode()
  mode: string
}

export interface BufferOption {
  readonly bufnr: number
  readonly eol: number
  readonly size: number
  readonly winid: number
  readonly lines: null | string[]
  readonly variables: { [key: string]: any }
  readonly bufname: string
  readonly fullpath: string
  readonly buftype: string
  readonly filetype: string
  readonly iskeyword: string
  readonly lisp: number
  readonly changedtick: number
  readonly previewwindow: number
}

export interface HandlerDelegate {
  uri: string | undefined
  checkProvider: (id: ProviderName, document: TextDocument) => void
  withRequestToken: <T> (name: string, fn: (token: CancellationToken) => Thenable<T>, checkEmpty?: boolean) => Promise<T>
  getCurrentState: () => Promise<CurrentState>
  addDisposable: (disposable: Disposable) => void
  getIcon(kind: SymbolKind): { text: string, hlGroup: string }
  getCodeActions(doc: Document, range?: Range, only?: CodeActionKind[]): Promise<ExtendedCodeAction[]>
  applyCodeAction(action: ExtendedCodeAction): Promise<void>
}

/*
 * With providerId so it can be resolved.
 */
export interface ExtendedCodeAction extends CodeAction {
  providerId: string
}

export interface IFileSystemWatcher extends Disposable {
  ignoreCreateEvents: boolean
  ignoreChangeEvents: boolean
  ignoreDeleteEvents: boolean
  onDidCreate: Event<URI>
  onDidChange: Event<URI>
  onDidDelete: Event<URI>
}

export interface Documentation {
  filetype: string
  content: string
  highlights?: HighlightItem[]
  active?: [number, number]
}

export interface FloatFactory {
  window: Window | null
  activated: () => Promise<boolean>
  show: (docs: Documentation[], options?: FloatOptions) => Promise<void>
  close: () => void
  checkRetrigger: (bufnr: number) => boolean
  dispose: () => void
}

export interface FloatConfig {
  border?: boolean | [number, number, number, number]
  rounded?: boolean
  highlight?: string
  title?: string
  borderhighlight?: string
  close?: boolean
  maxHeight?: number
  maxWidth?: number
  winblend?: number
  focusable?: boolean
  shadow?: boolean
}

export interface FloatOptions extends FloatConfig {
  title?: string
  offsetX?: number
}

export interface HighlightItemOption {
  /**
   * default to true
   */
  combine?: boolean
  /**
   * default to false
   */
  start_incl?: boolean
  /**
   * default to false
   */
  end_incl?: boolean
}

/**
 * Represent a highlight that not cross lines
 * all zero based.
 */
export interface HighlightItem extends HighlightItemOption {
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
  runtimepath: string
  readonly virtualText: boolean
  readonly guicursor: string
  readonly tabCount: number
  readonly mode: string
  readonly apiversion: number
  readonly pumwidth: number
  readonly ambiguousIsNarrow: boolean
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
  readonly semanticHighlights: string[]
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

export interface KeymapOption {
  sync: boolean
  cancel: boolean
  silent: boolean
  repeat: boolean
}

export interface Autocmd {
  pattern?: string
  event: string | string[]
  arglist?: string[]
  request?: boolean
  thisArg?: any
  callback: Function
}

export interface UltiSnippetOption {
  regex?: string
  context?: string
  noPython?: boolean
  range?: Range
  line?: string
}

export interface TextDocumentMatch {
  readonly uri: string
  readonly languageId: string
}
// window {{
export type MsgTypes = 'error' | 'warning' | 'more'
export type HighlightItemResult = [string, number, number, number, number?]
export type HighlightItemDef = [string, number, number, number, number?, number?, number?]

export interface HighlightDiff {
  remove: number[]
  removeMarkers: number[]
  add: HighlightItemDef[]
}

export interface StatusItemOption {
  progress?: boolean
}

export interface ScreenPosition {
  row: number
  col: number
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
   * Keep focus current window, default to false.
   */
  keepfocus?: boolean
  /**
   * Position of terminal window, default to 'right'.
   */
  position?: 'bottom' | 'right'
}

export interface TerminalResult {
  bufnr: number
  success: boolean
  content?: string
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
  /**
   * Extension or language-client id
   */
  source?: string
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

export type MenuOption = {
  title?: string,
  content?: string
  /**
   * Create and highlight shortcut characters.
   */
  shortcuts?: boolean
  /**
   * Position of menu picker, default to 'cursor'
   */
  position?: 'cursor' | 'center'
  /**
   * Border highlight that override user configuration.
   */
  borderhighlight?: string
} | string
// }}

// vim {{
export interface LocationListItem {
  bufnr: number
  lnum: number
  end_lnum: number
  col: number
  end_col: number
  text: string
  type: string
}

export interface QuickfixItem {
  uri?: string
  module?: string
  range?: Range
  text?: string
  type?: string
  filename: string
  bufnr?: number
  lnum?: number
  end_lnum?: number
  col?: number
  end_col?: number
  valid?: boolean
  nr?: number
  targetRange?: Range
}

/**
 * Options to configure the behavior of the quick pick UI.
 */
export interface QuickPickOptions {

  /**
   * An optional string that represents the title of the quick pick.
   */
  title?: string

  /**
   * An optional flag to include the description when filtering the picks.
   */
  matchOnDescription?: boolean

  /**
   * An optional flag to make the picker accept multiple selections, if true the result is an array of picks.
   */
  canPickMany?: boolean
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
// }}

// TextDocument {{
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
   * The optional length of the range that got replaced.
   *
   * @deprecated use range instead.
   */
  rangeLength?: number
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
  readonly textDocument: {
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
  readonly contentChanges: ReadonlyArray<TextDocumentContentChange>
  /**
   * Buffer number of document.
   */
  readonly bufnr: number
  /**
   * Original content before change
   */
  readonly original: string
  /**
   * Changed lines
   */
  readonly originalLines: ReadonlyArray<string>
}
// }}
