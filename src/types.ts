export type Filter = 'word' | 'fuzzy'

// Config property of source
export interface SourceConfig {
  shortcut: string
  priority: number
  engross: boolean
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
  engross?: boolean | number
  priority?: number
  optionalFns?: string[]
  filterAbbr?: boolean
  // remote source only
  firstMatch?: boolean
  showSignature?:boolean
  bindKeywordprg?:boolean
  signatureEvents?:string[]
  [index: string]: any
}

export interface RecentScore {
  [index:string]: number
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
  // new input if startcol not equal
  input?: string
  priority?:number
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
  sources: {[index:string]: Partial<SourceConfig>}
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
