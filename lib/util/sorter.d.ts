import { VimCompleteItem } from '../types';
export declare function fuzzySort(words: string[], input: string): string[];
export declare function wordSort(words: string[], input?: string): string[];
export declare function fuzzySortItems(items: VimCompleteItem[], input: string): VimCompleteItem[];
export declare function wordSortItems(items: VimCompleteItem[], input?: string): VimCompleteItem[];
