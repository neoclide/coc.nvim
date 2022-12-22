import type { Window, Buffer } from '@chemzqm/neovim'
import type { ProviderResult } from '../provider/index'
import type { LocationWithTarget } from '../types'
import type { CancellationToken } from '../util/protocol'

export interface LocationWithLine {
  uri: string
  line: string
  text?: string
}

export interface ListItem {
  label: string
  filterText?: string
  preselect?: boolean
  location?: LocationWithTarget | LocationWithLine | string
  data?: any
  ansiHighlights?: AnsiHighlight[]
  resolved?: boolean
  /**
   * A string that should be used when comparing this item
   * with other items, only used for fuzzy filter.
   */
  sortText?: string
  converted?: boolean
}

export interface ListItemWithScore extends ListItem {
  score?: number
}

export interface AnsiHighlight {
  span: [number, number]
  hlGroup: string
}

export interface ListItemsEvent {
  items: ListItemWithScore[]
  finished: boolean
  sorted: boolean
  append?: boolean
  reload?: boolean
}

export type ListMode = 'normal' | 'insert'

export type Matcher = 'strict' | 'fuzzy' | 'regex'

export interface ListOptions {
  position: string
  reverse: boolean
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
  height?: number
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
  tabPersist?: boolean
  execute: Function
}

export interface SingleListAction extends ListAction {
  multiple?: false
  execute: (item: ListItem, context: ListContext) => ProviderResult<void>
}

export interface MultipleListAction extends ListAction {
  multiple: boolean
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
