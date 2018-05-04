import { VimCompleteItem } from '../types';
export declare function filterWord(words: string[], input: string): string[];
export declare function filterFuzzy(words: string[], input: string): string[];
export declare function filterItemWord(items: VimCompleteItem[], input: string): VimCompleteItem[];
export declare function filterItemFuzzy(items: VimCompleteItem[], input: string): VimCompleteItem[];
