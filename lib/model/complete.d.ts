import { CompleteOption, VimCompleteItem } from '../types';
import Source from './source';
export declare type Callback = () => void;
export default class Complete {
    id: string;
    private bufnr;
    private line;
    private col;
    private input;
    private word;
    private filetype;
    private running;
    private result;
    private callbacks;
    constructor(opts: Partial<CompleteOption>);
    getOption(): CompleteOption | null;
    private completeSource(source, opt);
    doComplete(sources: Source[]): Promise<VimCompleteItem[]>;
}
