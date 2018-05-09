import { CompleteOption } from '../../types';
/**
 * shouldResolve
 *
 * @public
 * @param {string} line: content of current line
 * @param {number} colnr: cursor column nr
 * @returns {boolean}
 */
export declare function shouldResolve(opt: CompleteOption): Promise<boolean>;
export declare function resolve(opt: CompleteOption): Promise<string[]>;
