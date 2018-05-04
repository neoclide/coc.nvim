/******************************************************************
MIT License http://www.opensource.org/licenses/mit-license.php
Author Qiming Zhao <chemzqm@gmail> (https://github.com/chemzqm)
*******************************************************************/
import { CompleteResult } from './types';
export interface Cached {
    [index: string]: CompleteResult;
}
declare const _default: {
    getResult(id: string, name: string): Promise<CompleteResult>;
    setResult(id: string, name: string, res: CompleteResult): void;
};
export default _default;
