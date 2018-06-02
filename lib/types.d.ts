export declare type Filter = 'word' | 'fuzzy';
export interface SourceConfig {
    shortcut: string;
    priority: number;
    engross: boolean;
    filetypes: string[] | null;
    filterAbbr: boolean;
    firstMatch: boolean;
    [index: string]: any;
}
export interface SourceOption {
    name: string;
    shortcut?: string;
    filetypes?: string[];
    engross?: boolean | number;
    priority?: number;
    optionalFns?: string[];
    only?: boolean;
    filterAbbr?: boolean;
    firstMatch?: boolean;
    showSignature?: boolean;
    bindKeywordprg?: boolean;
    signatureEvents?: string[];
    [index: string]: any;
}
export interface RecentScore {
    [index: string]: number;
}
export interface CompleteOption {
    id: number;
    bufnr: number;
    line: string;
    col: number;
    input: string;
    buftype: string;
    filetype: string;
    filepath: string;
    word: string;
    changedtick: number;
    colnr: number;
    linenr: number;
    linecount: number;
    iskeyword: string;
    moved?: number;
    [index: string]: any;
}
export interface VimCompleteItem {
    word: string;
    abbr?: string;
    menu?: string;
    info?: string;
    kind?: string;
    icase?: number;
    dup?: number;
    empty?: number;
    user_data?: string;
    score?: number;
}
export declare type FilterType = 'abbr' | 'word';
export interface CompleteResult {
    items: VimCompleteItem[];
    engross?: boolean;
    startcol?: number;
    source?: string;
    only?: boolean;
    firstMatch?: boolean;
    filter?: FilterType;
    input?: string;
}
export interface Config {
    hasUserData: boolean;
    completeOpt: string;
    fuzzyMatch: boolean;
    timeout: number;
    checkGit: boolean;
    disabled: string[];
    incrementHightlight: boolean;
    noSelect: boolean;
    sources: {
        [index: string]: Partial<SourceConfig>;
    };
    signatureEvents: string[];
}
export interface SourceStat {
    name: string;
    type: 'remote' | 'native';
    disabled: boolean;
    filepath: string;
}
export interface QueryOption {
    filetype: string;
    filename: string;
    content: string;
    col: number;
    lnum: number;
}
