import { NeovimClient as Neovim } from '@chemzqm/neovim';
import { CodeLens } from 'vscode-languageserver-protocol';
export interface CodeLensInfo {
    codeLenes: CodeLens[];
    version: number;
}
export default class CodeLensManager {
    private nvim;
    private separator;
    private srcId;
    private enabled;
    private fetching;
    private disposables;
    private codeLensMap;
    private resolveCodeLens;
    constructor(nvim: Neovim);
    private init;
    private setConfiguration;
    private fetchDocumentCodeLenes;
    private setVirtualText;
    private _resolveCodeLenes;
    doAction(): Promise<void>;
    private validDocument;
    private readonly version;
    dispose(): void;
}
