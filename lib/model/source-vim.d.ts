import { CompleteOption, CompleteResult } from '../types';
import Source from './source';
export default class VimSource extends Source {
    private echoError(str);
    private callOptinalFunc(fname, args);
    shouldComplete(opt: CompleteOption): Promise<boolean>;
    refresh(): Promise<void>;
    doComplete(opt: CompleteOption): Promise<CompleteResult | null>;
}
