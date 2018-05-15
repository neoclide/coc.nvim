import { Neovim } from 'neovim';
import Source from './model/source';
import Complete from './model/complete';
import { CompleteOption, RecentScore } from './types';
export declare class Completes {
    complete: Complete | null;
    recentScores: RecentScore;
    chars: string[];
    constructor();
    addRecent(word: string): void;
    newComplete(opts: CompleteOption): Complete;
    createComplete(opts: CompleteOption): Complete;
    getSources(nvim: Neovim, filetype: string): Promise<Source[]>;
    getSource(nvim: Neovim, name: string): Promise<Source | null>;
    reset(): void;
    calculateChars(): void;
}
declare const _default: Completes;
export default _default;
