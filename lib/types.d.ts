export declare type Filter = 'word' | 'fuzzy';
export interface SourceConfig {
    shortcut?: string;
    filetypes?: string[];
    disabled?: boolean;
}
export interface SourceOption {
    name: string;
    shortcut?: string;
    filetypes?: string[];
    engross?: boolean | number;
    priority?: number;
    optionalFns?: string[];
}
export interface CompleteOption {
    id: number;
    bufnr: string;
    line: string;
    col: number;
    input: string;
    buftype: string;
    filetype: string;
    filepath: string;
    word: string;
    colnr: number;
    linenr: number;
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
    engross?: boolean;
    startcol?: number;
}
export interface Config {
    completeOpt: string;
    fuzzyMatch: boolean;
    timeout: number;
    traceError: boolean;
    checkGit: boolean;
    disabled: string[];
    sources: {
        [index: string]: SourceConfig;
    };
}
export interface SourceStat {
    name: string;
    type: 'remote' | 'native';
    disabled: boolean;
    filepath: string;
}
