import { VimCompleteItem } from '../types';
export declare function filterItemWord(items: VimCompleteItem[], input: string): VimCompleteItem[];
export declare function filterItemFuzzy(items: VimCompleteItem[], input: string): VimCompleteItem[];
export declare function filterFuzzy(input: string, word: string, icase: boolean): boolean;
export declare function filterWord(input: string, word: string, icase: boolean): boolean;
