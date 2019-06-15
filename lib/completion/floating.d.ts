import { Neovim } from '@chemzqm/neovim';
import { CancellationToken } from 'vscode-jsonrpc';
import { Documentation, PumBounding } from '../types';
export interface FloatingConfig {
    srcId: number;
    maxPreviewWidth: number;
    enable: boolean;
}
export default class Floating {
    private nvim;
    private window;
    private floatBuffer;
    private config;
    private popup;
    constructor(nvim: Neovim);
    private readonly buffer;
    private showDocumentationFloating;
    private showDocumentationVim;
    show(docs: Documentation[], bounding: PumBounding, token: CancellationToken): Promise<void>;
    private calculateBounding;
    private checkBuffer;
    close(): void;
}
