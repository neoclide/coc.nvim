import { Neovim } from '@chemzqm/neovim';
import Colors from './colors';
export default class DocumentHighlighter {
    private nvim;
    private colors;
    private disposables;
    private matchIds;
    private cursorMoveTs;
    constructor(nvim: Neovim, colors: Colors);
    clearHighlight(): void;
    highlight(bufnr: number): Promise<void>;
    private getHighlights;
    dispose(): void;
}
