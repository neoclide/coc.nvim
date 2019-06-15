import { Disposable, Event } from 'vscode-languageserver-protocol';
import { Extension, ExtensionInfo, ExtensionState } from './types';
import { Neovim } from '@chemzqm/neovim';
import './util/extensions';
export declare type API = {
    [index: string]: any;
} | void | null | undefined;
export interface PropertyScheme {
    type: string;
    default: any;
    description: string;
    enum?: string[];
    items?: any;
    [key: string]: any;
}
export interface ExtensionItem {
    id: string;
    extension: Extension<API>;
    deactivate: () => void;
    directory?: string;
    isLocal: boolean;
}
export declare class Extensions {
    private list;
    private disabled;
    private db;
    private memos;
    private root;
    private _onDidLoadExtension;
    private _onDidActiveExtension;
    private _onDidUnloadExtension;
    private _additionalSchemes;
    private activated;
    ready: boolean;
    readonly onDidLoadExtension: Event<Extension<API>>;
    readonly onDidActiveExtension: Event<Extension<API>>;
    readonly onDidUnloadExtension: Event<string>;
    init(nvim: Neovim): Promise<void>;
    activateExtensions(): void;
    updateExtensions(interval: string, force?: boolean): Promise<Disposable | null>;
    private checkExtensions;
    installExtensions(list: string[]): Promise<void>;
    readonly all: Extension<API>[];
    getExtension(id: string): ExtensionItem;
    getExtensionState(id: string): ExtensionState;
    getExtensionStates(): Promise<ExtensionInfo[]>;
    toggleExtension(id: string): Promise<void>;
    reloadExtension(id: string): Promise<void>;
    uninstallExtension(ids: string[]): Promise<void>;
    isDisabled(id: string): boolean;
    onExtensionInstall(id: string): Promise<void>;
    has(id: string): boolean;
    isActivted(id: string): boolean;
    loadExtension(folder: string, isLocal?: boolean): Promise<void>;
    private loadFileExtensions;
    /**
     * Load single javascript file as extension.
     */
    loadExtensionFile(filepath: string): void;
    activate(id: any, silent?: boolean): void;
    deactivate(id: any): boolean;
    call(id: string, method: string, args: any[]): Promise<any>;
    getExtensionApi(id: string): API | null;
    registerExtension(extension: Extension<API>, deactivate?: () => void): void;
    readonly globalExtensions: string[];
    private globalExtensionStats;
    private localExtensionStats;
    private isGlobalExtension;
    private loadJson;
    packageNameFromUrl(url: string): string;
    readonly schemes: {
        [key: string]: PropertyScheme;
    };
    addSchemeProperty(key: string, def: PropertyScheme): void;
    private setupActiveEvents;
    private createExtension;
}
declare const _default: Extensions;
export default _default;
