'use strict'
import type { Window } from '@chemzqm/neovim'
import type { Disposable, Event } from 'vscode-languageserver-protocol'
import type { CreateFile, DeleteFile, Location, Range, RenameFile, TextDocumentEdit } from 'vscode-languageserver-types'
import type { URI } from 'vscode-uri'
import type RelativePattern from './model/relativePattern'

export type { IConfigurationChangeEvent } from './configuration/types'

export type GlobPattern = string | RelativePattern

declare global {
  namespace NodeJS {
    interface Global {
      __isMain?: boolean
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
   * range enclosing this symbol not including leading/trailing whitespace but everything else like comments. This information is typically used to highlight the range in the editor.
   */
  targetRange?: Range
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

  readonly content?: string
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
  desc?: string
  sync?: boolean
  cancel?: boolean
  silent?: boolean
  repeat?: boolean
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
