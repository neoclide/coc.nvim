import { NeovimClient as Neovim } from '@chemzqm/neovim';
import { SelectionRange, CodeActionKind, Definition, DocumentLink, LocationLink, Range } from 'vscode-languageserver-protocol';
import { Document } from '..';
import { CodeAction } from '../types';
interface SymbolInfo {
    filepath?: string;
    lnum: number;
    col: number;
    text: string;
    kind: string;
    level?: number;
    containerName?: string;
    selectionRange: Range;
    range?: Range;
}
interface CommandItem {
    id: string;
    title: string;
}
export default class Handler {
    private nvim;
    private preferences;
    private documentHighlighter;
    private hoverPosition;
    private colors;
    private hoverFactory;
    private signatureFactory;
    private documentLines;
    private codeLensManager;
    private signatureTokenSource;
    private disposables;
    private labels;
    constructor(nvim: Neovim);
    getCurrentFunctionSymbol(): Promise<string>;
    onHover(): Promise<boolean>;
    gotoDefinition(openCommand?: string): Promise<boolean>;
    gotoDeclaration(openCommand?: string): Promise<boolean>;
    gotoTypeDefinition(openCommand?: string): Promise<boolean>;
    gotoImplementation(openCommand?: string): Promise<boolean>;
    gotoReferences(openCommand?: string): Promise<boolean>;
    getDocumentSymbols(document?: Document): Promise<SymbolInfo[]>;
    rename(newName?: string): Promise<boolean>;
    documentFormatting(): Promise<boolean>;
    documentRangeFormatting(mode: string): Promise<number>;
    runCommand(id?: string, ...args: any[]): Promise<any>;
    getCodeActions(bufnr: number, range?: Range, only?: CodeActionKind[]): Promise<CodeAction[]>;
    doCodeAction(mode: string | null, only?: CodeActionKind[] | string): Promise<void>;
    /**
     * Get current codeActions
     *
     * @public
     * @returns {Promise<CodeAction[]>}
     */
    getCurrentCodeActions(mode?: string, only?: CodeActionKind[]): Promise<CodeAction[]>;
    doQuickfix(): Promise<boolean>;
    applyCodeAction(action: CodeAction): Promise<void>;
    doCodeLensAction(): Promise<void>;
    fold(kind?: string): Promise<boolean>;
    pickColor(): Promise<void>;
    pickPresentation(): Promise<void>;
    highlight(): Promise<void>;
    links(): Promise<DocumentLink[]>;
    openLink(): Promise<boolean>;
    getCommands(): Promise<CommandItem[]>;
    private onCharacterType;
    private triggerSignatureHelp;
    showSignatureHelp(): Promise<boolean>;
    handleLocations(definition: Definition | LocationLink[], openCommand?: string | false): Promise<void>;
    getSelectionRanges(): Promise<SelectionRange[] | null>;
    codeActionRange(start: number, end: number, only: string): Promise<void>;
    private previewHover;
    private getPreferences;
    private onEmptyLocation;
    dispose(): void;
}
export {};
