import { CancellationToken } from 'vscode-languageserver-protocol';
import { CompleteOption, CompleteResult, VimCompleteItem } from '../types';
import Source from './source';
export default class VimSource extends Source {
    private callOptinalFunc;
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    refresh(): Promise<void>;
    onCompleteDone(item: VimCompleteItem, opt: CompleteOption): Promise<void>;
    onEnter(bufnr: number): void;
    doComplete(opt: CompleteOption, token: CancellationToken): Promise<CompleteResult | null>;
}
