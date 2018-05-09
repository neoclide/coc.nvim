import { CompleteOption, VimCompleteItem, CompleteResult } from '../types';
import Source from './source';
export declare type Callback = () => void;
export default class Complete {
    results: CompleteResult[] | null;
    finished: boolean;
    option: CompleteOption;
    constructor(opts: CompleteOption);
    resuable(complete: Complete): boolean;
    private completeSource(source, opt);
    filterResults(results: CompleteResult[], input: string, cword: string, isResume: boolean): VimCompleteItem[];
    doComplete(sources: Source[]): Promise<VimCompleteItem[]>;
}
