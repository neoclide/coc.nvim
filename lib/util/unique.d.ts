import { VimCompleteItem } from '../types';
export declare function uniqueItems(results: VimCompleteItem[]): VimCompleteItem[];
export declare function hasBetter(word: string, abbr: string | null, info: string | null, kind: string | null, list: VimCompleteItem[]): boolean;
