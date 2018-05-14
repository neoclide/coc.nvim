export type Filter = 'word' | 'fuzzy'

// Config property of source
export interface SourceConfig {
  shortcut: string
  priority: number
  engross: boolean
  filetypes: string[] | null
  [index: string]: any
}

// options for init source
export interface SourceOption {
  name: string
  shortcut?: string
  filetypes?: string[]
  engross?: boolean | number
  priority?: number
  optionalFns?: string[]
  only?: boolean
  [index: string]: any
}

// option on complete & should_complete
export interface CompleteOption {
  id: number
  bufnr: string
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
  noinsert?: boolean
}

export interface CompleteResult {
  items: VimCompleteItem[]
  engross?: boolean
  startcol?: number
  source?: string
  noinsert?: boolean
  only?: boolean
}

export interface Config {
  completeOpt: string
  fuzzyMatch: boolean
  timeout: number
  checkGit: boolean
  disabled: string[]
  sources: {[index:string]: Partial<SourceConfig>}
}

export interface SourceStat {
  name: string
  type: 'remote' | 'native'
  disabled: boolean
  filepath: string
}
