/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
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
    private result;
    private nvim;
    private callbacks;
    constructor(opts: Partial<CompleteOption>);
    getOption(): CompleteOption | null;
    private completeSource(source, opt);
    doComplete(sources: Source[]): Promise<VimCompleteItem[]>;
}
