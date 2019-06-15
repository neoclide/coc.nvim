import { Disposable } from 'vscode-languageserver-protocol';
import Source from '../model/source';
import { CompleteOption, CompleteResult, ISource } from '../types';
export default class Around extends Source {
    constructor();
    doComplete(opt: CompleteOption): Promise<CompleteResult>;
}
export declare function regist(sourceMap: Map<string, ISource>): Disposable;
