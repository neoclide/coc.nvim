import { VimCompleteItem, CompleteOption, CompleteResult } from '../types';
import Source from './source';
export default class VimSource extends Source {
    private echoError;
    private callOptinalFunc;
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    refresh(): Promise<void>;
    onCompleteDone(item: VimCompleteItem): Promise<void>;
    doComplete(opt: CompleteOption): Promise<CompleteResult | null>;
}
