import { CompleteOption, CompleteResult } from '../types';
import Source from './source';
export default class VimSource extends Source {
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    refresh(): Promise<void>;
    private echoError(str);
    doComplete(opt: CompleteOption): Promise<CompleteResult | null>;
}
