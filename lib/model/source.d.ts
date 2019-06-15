import { Neovim } from '@chemzqm/neovim';
import { CancellationToken } from 'vscode-languageserver-protocol';
import { CompleteOption, CompleteResult, ISource, SourceConfig, SourceType, VimCompleteItem } from '../types';
export default class Source implements ISource {
    readonly name: string;
    readonly filepath: string;
    readonly sourceType: SourceType;
    readonly isSnippet: boolean;
    protected readonly nvim: Neovim;
    private _disabled;
    private defaults;
    constructor(option: Partial<SourceConfig>);
    readonly priority: number;
    readonly triggerOnly: boolean;
    readonly triggerCharacters: string[];
    readonly optionalFns: string[];
    readonly triggerPatterns: RegExp[] | null;
    readonly shortcut: string;
    readonly enable: boolean;
    readonly filetypes: string[] | null;
    readonly disableSyntaxes: string[];
    getConfig<T>(key: string, defaultValue?: T): T | null;
    toggle(): void;
    readonly firstMatch: boolean;
    readonly menu: string;
    /**
     * Filter words that too short or doesn't match input
     */
    protected filterWords(words: string[], opt: CompleteOption): string[];
    /**
     * fix start column for new valid characters
     *
     * @protected
     * @param {CompleteOption} opt
     * @param {string[]} valids - valid charscters
     * @returns {number}
     */
    protected fixStartcol(opt: CompleteOption, valids: string[]): number;
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    refresh(): Promise<void>;
    onCompleteDone(item: VimCompleteItem, opt: CompleteOption): Promise<void>;
    doComplete(opt: CompleteOption, token: CancellationToken): Promise<CompleteResult | null>;
}
