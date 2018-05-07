import { CompleteOption, VimCompleteItem, CompleteResult } from '../types';
import Source from './source';
export declare type Callback = () => void;
export default class Complete {
    id: string;
    results: CompleteResult[] | null;
    finished: boolean;
    private bufnr;
    private linenr;
    private colnr;
    private line;
    private col;
    private input;
    private word;
    private filetype;
    private fuzzy;
    constructor(opts: Partial<CompleteOption>);
    getOption(): CompleteOption | null;
    resuable(complete: Complete): boolean;
    private completeSource(source, opt);
    filterResults(results: CompleteResult[], input: string, cword: string, isResume: boolean): VimCompleteItem[];
    doComplete(sources: Source[]): Promise<VimCompleteItem[]>;
}
