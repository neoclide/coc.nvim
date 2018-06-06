import { CompleteOption, VimCompleteItem, RecentScore, CompleteResult } from '../types';
import Source from './source';
export declare type Callback = () => void;
export default class Complete {
    results: CompleteResult[] | null;
    option: CompleteOption;
    startcol?: number;
    recentScores: RecentScore;
    constructor(opts: CompleteOption);
    private completeSource;
    private checkResult;
    filterResults(results: CompleteResult[]): VimCompleteItem[];
    doComplete(sources: Source[]): Promise<[number, VimCompleteItem[]]>;
    private getOnlySourceName;
    private getBonusScore;
}
