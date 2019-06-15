import { Buffer, Neovim, Window } from '@chemzqm/neovim';
import { Documentation, Fragment } from '../types';
export default class FloatBuffer {
    private nvim;
    buffer: Buffer;
    private window?;
    private lines;
    private highlights;
    private positions;
    private enableHighlight;
    width: number;
    constructor(nvim: Neovim, buffer: Buffer, window?: Window);
    getHeight(docs: Documentation[], maxWidth: number): number;
    readonly valid: Promise<boolean>;
    calculateFragments(docs: Documentation[], maxWidth: number): Fragment[];
    setDocuments(docs: Documentation[], maxWidth: number): Promise<void>;
    splitFragment(fragment: Fragment, defaultFileType: string): Fragment[];
    private fixFiletype;
    setLines(): void;
}
