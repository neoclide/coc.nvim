import { Range } from 'vscode-languageserver-protocol';
import * as types from '../types';
import * as Snippets from "./parser";
import { SnippetSession } from './session';
export declare class SnippetManager implements types.SnippetManager {
    private sessionMap;
    private disposables;
    private statusItem;
    constructor();
    /**
     * Insert snippet at current cursor position
     */
    insertSnippet(snippet: string, select?: boolean, range?: Range): Promise<boolean>;
    isPlainText(text: string): boolean;
    selectCurrentPlaceholder(triggerAutocmd?: boolean): Promise<void>;
    nextPlaceholder(): Promise<void>;
    previousPlaceholder(): Promise<void>;
    cancel(): void;
    readonly session: SnippetSession;
    isActived(bufnr: number): boolean;
    jumpable(): boolean;
    getSession(bufnr: number): SnippetSession;
    resolveSnippet(body: string): Promise<Snippets.TextmateSnippet>;
    dispose(): void;
}
declare const _default: SnippetManager;
export default _default;
