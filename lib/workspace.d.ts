import { NeovimClient as Neovim } from '@chemzqm/neovim';
import { CreateFileOptions, DeleteFileOptions, DidChangeTextDocumentParams, Disposable, DocumentSelector, Event, FormattingOptions, Location, LocationLink, Position, Range, RenameFileOptions, TextDocument, WorkspaceEdit, WorkspaceFolder, WorkspaceFoldersChangeEvent } from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import Configurations from './configuration';
import DB from './model/db';
import Task from './model/task';
import Document from './model/document';
import FileSystemWatcher from './model/fileSystemWatcher';
import Mru from './model/mru';
import { TextDocumentContentProvider } from './provider';
import { Autocmd, ConfigurationChangeEvent, ConfigurationTarget, EditerState, Env, IWorkspace, KeymapOption, MapMode, MsgTypes, OutputChannel, QuickfixItem, StatusBarItem, StatusItemOption, Terminal, TerminalOptions, TerminalResult, TextDocumentWillSaveEvent, WorkspaceConfiguration, PatternType } from './types';
export declare class Workspace implements IWorkspace {
    readonly nvim: Neovim;
    readonly version: string;
    readonly keymaps: Map<string, [Function, boolean]>;
    bufnr: number;
    private resolver;
    private rootPatterns;
    private _workspaceFolders;
    private messageLevel;
    private willSaveUntilHandler;
    private statusLine;
    private _insertMode;
    private _env;
    private _root;
    private _cwd;
    private _blocking;
    private _initialized;
    private _attached;
    private buffers;
    private autocmds;
    private terminals;
    private creatingSources;
    private outputChannels;
    private schemeProviderMap;
    private namespaceMap;
    private disposables;
    private setupDynamicAutocmd;
    private watchedOptions;
    private _disposed;
    private _onDidOpenDocument;
    private _onDidCloseDocument;
    private _onDidChangeDocument;
    private _onWillSaveDocument;
    private _onDidSaveDocument;
    private _onDidChangeWorkspaceFolders;
    private _onDidChangeConfiguration;
    private _onDidWorkspaceInitialized;
    private _onDidOpenTerminal;
    private _onDidCloseTerminal;
    readonly onDidCloseTerminal: Event<Terminal>;
    readonly onDidOpenTerminal: Event<Terminal>;
    readonly onDidChangeWorkspaceFolders: Event<WorkspaceFoldersChangeEvent>;
    readonly onDidOpenTextDocument: Event<TextDocument>;
    readonly onDidCloseTextDocument: Event<TextDocument>;
    readonly onDidChangeTextDocument: Event<DidChangeTextDocumentParams>;
    readonly onWillSaveTextDocument: Event<TextDocumentWillSaveEvent>;
    readonly onDidSaveTextDocument: Event<TextDocument>;
    readonly onDidChangeConfiguration: Event<ConfigurationChangeEvent>;
    readonly onDidWorkspaceInitialized: Event<void>;
    readonly configurations: Configurations;
    constructor();
    init(): Promise<void>;
    getConfigFile(target: ConfigurationTarget): string;
    /**
     * Register autocmd on vim.
     */
    registerAutocmd(autocmd: Autocmd): Disposable;
    /**
     * Watch for option change.
     */
    watchOption(key: string, callback: (oldValue: any, newValue: any) => Thenable<void> | void, disposables?: Disposable[]): void;
    /**
     * Watch global variable, works on neovim only.
     */
    watchGlobal(key: string, callback?: (oldValue: any, newValue: any) => Thenable<void> | void, disposables?: Disposable[]): void;
    readonly cwd: string;
    readonly env: Env;
    readonly root: string;
    readonly rootPath: string;
    readonly workspaceFolders: WorkspaceFolder[];
    /**
     * uri of current file, could be null
     */
    readonly uri: string;
    readonly workspaceFolder: WorkspaceFolder;
    readonly textDocuments: TextDocument[];
    readonly documents: Document[];
    createNameSpace(name?: string): number;
    readonly channelNames: string[];
    readonly pluginRoot: string;
    readonly isVim: boolean;
    readonly isNvim: boolean;
    readonly completeOpt: string;
    readonly initialized: boolean;
    readonly ready: Promise<void>;
    /**
     * Current filetypes.
     */
    readonly filetypes: Set<string>;
    /**
     * Check if selector match document.
     */
    match(selector: DocumentSelector, document: TextDocument): number;
    /**
     * Findup for filename or filenames from current filepath or root.
     */
    findUp(filename: string | string[]): Promise<string | null>;
    resolveRootFolder(uri: URI, patterns: string[]): Promise<string>;
    /**
     * Create a FileSystemWatcher instance,
     * doesn't fail when watchman not found.
     */
    createFileSystemWatcher(globPattern: string, ignoreCreate?: boolean, ignoreChange?: boolean, ignoreDelete?: boolean): FileSystemWatcher;
    getWatchmanPath(): string | null;
    /**
     * Get configuration by section and optional resource uri.
     */
    getConfiguration(section?: string, resource?: string): WorkspaceConfiguration;
    /**
     * Get created document by uri or bufnr.
     */
    getDocument(uri: number | string): Document;
    /**
     * Get current cursor offset in document.
     */
    getOffset(): Promise<number>;
    /**
     * Apply WorkspaceEdit.
     */
    applyEdit(edit: WorkspaceEdit): Promise<boolean>;
    /**
     * Convert location to quickfix item.
     */
    getQuickfixItem(loc: Location | LocationLink, text?: string, type?: string): Promise<QuickfixItem>;
    /**
     * Create persistence Mru instance.
     */
    createMru(name: string): Mru;
    getSelectedRange(mode: string, document: TextDocument): Promise<Range | null>;
    /**
     * Populate locations to UI.
     */
    showLocations(locations: Location[]): Promise<void>;
    /**
     * Get content of line by uri and line.
     */
    getLine(uri: string, line: number): Promise<string>;
    /**
     * Get WorkspaceFolder of uri
     */
    getWorkspaceFolder(uri: string): WorkspaceFolder | null;
    /**
     * Get content from buffer of file by uri.
     */
    readFile(uri: string): Promise<string>;
    getFilepath(filepath: string): string;
    onWillSaveUntil(callback: (event: TextDocumentWillSaveEvent) => void, thisArg: any, clientId: string): Disposable;
    /**
     * Echo lines.
     */
    echoLines(lines: string[], truncate?: boolean): Promise<void>;
    /**
     * Show message in vim.
     */
    showMessage(msg: string, identify?: MsgTypes): void;
    /**
     * Current document.
     */
    readonly document: Promise<Document>;
    /**
     * Get current cursor position.
     */
    getCursorPosition(): Promise<Position>;
    /**
     * Get current document and position.
     */
    getCurrentState(): Promise<EditerState>;
    /**
     * Get format options
     */
    getFormatOptions(uri?: string): Promise<FormattingOptions>;
    /**
     * Jump to location.
     */
    jumpTo(uri: string, position?: Position | null, openCommand?: string): Promise<void>;
    /**
     * Move cursor to position.
     */
    moveTo(position: Position): Promise<void>;
    /**
     * Create a file in vim and disk
     */
    createFile(filepath: string, opts?: CreateFileOptions): Promise<void>;
    /**
     * Load uri as document.
     */
    loadFile(uri: string): Promise<Document>;
    /**
     * Rename file in vim and disk
     */
    renameFile(oldPath: string, newPath: string, opts?: RenameFileOptions): Promise<void>;
    /**
     * Delete file from vim and disk.
     */
    deleteFile(filepath: string, opts?: DeleteFileOptions): Promise<void>;
    /**
     * Open resource by uri
     */
    openResource(uri: string): Promise<void>;
    /**
     * Create a new output channel
     */
    createOutputChannel(name: string): OutputChannel;
    /**
     * Reveal buffer of output channel.
     */
    showOutputChannel(name: string): void;
    /**
     * Resovle module from yarn or npm.
     */
    resolveModule(name: string): Promise<string>;
    /**
     * Run nodejs command
     */
    runCommand(cmd: string, cwd?: string, timeout?: number): Promise<string>;
    /**
     * Run command in vim terminal
     */
    runTerminalCommand(cmd: string, cwd?: string, keepfocus?: boolean): Promise<TerminalResult>;
    createTerminal(opts: TerminalOptions): Promise<Terminal>;
    /**
     * Show quickpick
     */
    showQuickpick(items: string[], placeholder?: string): Promise<number>;
    /**
     * Prompt for confirm action.
     */
    showPrompt(title: string): Promise<boolean>;
    callAsync<T>(method: string, args: any[]): Promise<T>;
    /**
     * Request input from user
     */
    requestInput(title: string, defaultValue?: string): Promise<string>;
    /**
     * registerTextDocumentContentProvider
     */
    registerTextDocumentContentProvider(scheme: string, provider: TextDocumentContentProvider): Disposable;
    /**
     * Register keymap
     */
    registerKeymap(modes: MapMode[], key: string, fn: Function, opts?: Partial<KeymapOption>): Disposable;
    /**
     * Register expr keymap.
     */
    registerExprKeymap(mode: 'i' | 'n' | 'v' | 's' | 'x', key: string, fn: Function, buffer?: boolean): Disposable;
    /**
     * Create StatusBarItem
     */
    createStatusBarItem(priority?: number, opt?: StatusItemOption): StatusBarItem;
    dispose(): void;
    detach(): Promise<void>;
    /**
     * Create DB instance at extension root.
     */
    createDatabase(name: string): DB;
    /**
     * Create Task instance that runs in vim.
     */
    createTask(id: string): Task;
    private _setupDynamicAutocmd;
    private onBufReadCmd;
    private attach;
    private validteDocumentChanges;
    private createConfigurations;
    private initVimEvents;
    private onBufCreate;
    private onBufEnter;
    private onCursorMoved;
    private onBufWritePost;
    private onBufUnload;
    private onBufWritePre;
    private onDirChanged;
    private onFileTypeChange;
    private checkBuffer;
    private getFileEncoding;
    private resolveRoot;
    getRootPatterns(document: Document, patternType: PatternType): string[];
    renameCurrent(): Promise<void>;
    private setMessageLevel;
    private mergeDocumentChanges;
    readonly folderPaths: string[];
    removeWorkspaceFolder(fsPath: string): void;
    renameWorkspaceFolder(oldPath: string, newPath: string): void;
    addRootPatterns(filetype: string, rootPatterns: string[]): void;
    readonly insertMode: boolean;
    private getDocumentOption;
    private checkProcess;
    private addWorkspaceFolder;
    private getServerRootPatterns;
}
declare const _default: Workspace;
export default _default;
