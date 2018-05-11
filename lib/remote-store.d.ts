import { VimCompleteItem } from './types';
export interface Cached {
    [index: string]: VimCompleteItem[];
}
declare const _default: {
    getResult(id: number, name: string): Promise<VimCompleteItem[]>;
    setResult(id: number, name: string, res: VimCompleteItem[]): void;
};
export default _default;
