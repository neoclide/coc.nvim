import { Neovim } from 'neovim';
import Document from './model/document';
import { TextDocument } from 'vscode-languageserver-protocol';
export declare class Workspace {
    nvim: Neovim;
    buffers: {
        [index: number]: Document;
    };
    private _onDidAddDocument;
    private _onDidRemoveDocument;
    private _onDidChangeDocument;
    private _onWillSaveDocument;
    private _onDidSaveDocument;
    private readonly onDidAddDocument;
    private readonly onDidRemoveDocument;
    private readonly onDidChangeDocument;
    private readonly onWillSaveDocument;
    private readonly onDidSaveDocument;
    constructor();
    getDocument(bufnr: number): Document | null;
    addBuffer(bufnr: number): Promise<void>;
    removeBuffer(bufnr: number): Promise<void>;
    bufferWillSave(bufnr: number): Promise<void>;
    bufferDidSave(bufnr: number): Promise<void>;
    readonly textDocuments: TextDocument[];
    refresh(): Promise<void>;
    getWords(bufnr: number): string[];
    createDocument(fullpath: string, filetype: string): Promise<TextDocument | null>;
    private getBuffer;
    private getUri;
    onDidOpenTextDocument(listener: any, thisArgs?: any, disposables?: any): void;
    onDidCloseTextDocument(listener: any, thisArgs?: any, disposables?: any): void;
    onDidChangeTextDocument(listener: any, thisArgs?: any, disposables?: any): void;
    onWillSaveTextDocument(listener: any, thisArgs?: any, disposables?: any): void;
    onDidSaveTextDocument(listener: any, thisArgs?: any, disposables?: any): void;
}
declare const _default: Workspace;
export default _default;
