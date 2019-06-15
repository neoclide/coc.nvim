import { Disposable } from 'vscode-languageserver-protocol';
import Source from '../model/source';
import { CompleteOption, CompleteResult, ISource } from '../types';
export default class Buffer extends Source {
    constructor();
    readonly ignoreGitignore: boolean;
    private getWords;
    doComplete(opt: CompleteOption): Promise<CompleteResult>;
}
export declare function regist(sourceMap: Map<string, ISource>): Disposable;
