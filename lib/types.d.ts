export declare type Filter = 'word' | 'fuzzy';
export interface SourceOption {
    name: string;
    shortcut?: string;
    priority: number;
    filetypes?: string[];
    engross?: boolean | number;
    filter?: Filter;
}
export interface CompleteOption {
    bufnr: string;
    linenr: number;
    line: string;
    col: number;
    id: string;
    input: string;
    filetype: string;
    word: string;
    colnr: number;
}
export interface CompleteOptionVim {
    word: string;
    colnr: number;
    lnum: number;
    line: string;
    bufnr: number;
    col: number;
    filetype: string;
    input: string;
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
export interface CompleteResult {
    items: VimCompleteItem[];
    firstMatch?: boolean;
    offsetLeft?: number;
    offsetRight?: number;
}
export interface Config {
    fuzzyMatch: boolean;
    timeout: number;
    noTrace: boolean;
    sources: string[];
    [index: string]: any;
}
