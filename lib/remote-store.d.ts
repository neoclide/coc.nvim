/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import { VimCompleteItem } from './types';
export interface Cached {
    [index: string]: VimCompleteItem[];
}
declare const _default: {
    getResult(id: string, name: string): Promise<VimCompleteItem[]>;
    setResult(id: string, name: string, res: VimCompleteItem[]): void;
};
export default _default;
