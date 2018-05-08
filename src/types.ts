export type Filter = 'word' | 'fuzzy'

// user could set
export interface SourceConfig {
  shortcut?: string
  filetypes?: string[]
  disabled?: boolean
}

// options for init source
export interface SourceOption {
  name: string
  shortcut?: string
  filetypes?: string[]
  engross?: boolean | number
  priority?: number
}

// option on complete & should_complete
export interface CompleteOption {
  bufnr: string
  line: string
  col: number
  id: string
  input: string
  filetype: string
  word: string
  // cursor position
  colnr: number
  linenr: number
}

export interface CompleteOptionVim {
  word: string
  colnr: number
  lnum: number
  line: string
  bufnr: number
  col: number
  filetype: string
  input: string
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

export interface CompleteResult {
  items: VimCompleteItem[]
  firstMatch?: boolean
  offsetLeft?: number
  offsetRight?: number
}

export interface Config {
  completeOpt: string
  fuzzyMatch: boolean
  timeout: number
  noTrace: boolean
  disabled: string[]
  sources: {[index:string]: SourceConfig}
}

export interface SourceStat {
  name: string
  type: 'remote' | 'native'
  disabled: boolean
  filepath: string
}
