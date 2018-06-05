import { Neovim } from 'neovim';
import * as Proto from './protocol';
import API from './utils/api';
import { TypeScriptServiceConfiguration } from './utils/configuration';
import { Uri, DiagnosticKind, Event } from '../vscode';
import { CancellationToken } from 'vscode-languageserver-protocol';
import { ITypeScriptServiceClient } from './typescriptService';
export interface TsDiagnostics {
    readonly kind: DiagnosticKind;
    readonly resource: Uri;
    readonly diagnostics: Proto.Diagnostic[];
}
export default class TypeScriptServiceClient implements ITypeScriptServiceClient {
    private readonly nvim;
    readonly root: string;
    private static readonly WALK_THROUGH_SNIPPET_SCHEME_COLON;
    private pathSeparator;
    private tracer;
    private _onReady?;
    private _configuration;
    private versionProvider;
    private tsServerLogFile;
    private servicePromise;
    private lastError;
    private lastStart;
    private numberRestarts;
    private isRestarting;
    private cancellationPipeName;
    private requestQueue;
    private callbacks;
    private readonly _onTsServerStarted;
    private readonly _onProjectLanguageServiceStateChanged;
    private readonly _onDidBeginInstallTypings;
    private readonly _onDidEndInstallTypings;
    private readonly _onTypesInstallerInitializationFailed;
    /**
     * API version obtained from the version picker after checking the corresponding path exists.
     */
    private _apiVersion;
    /**
     * Version reported by currently-running tsserver.
     */
    private _tsserverVersion;
    private readonly disposables;
    constructor(nvim: Neovim, root: string);
    private _onDiagnosticsReceived;
    readonly onDiagnosticsReceived: Event<TsDiagnostics>;
    private _onConfigDiagnosticsReceived;
    readonly onConfigDiagnosticsReceived: Event<Proto.ConfigFileDiagnosticEvent>;
    private _onResendModelsRequested;
    readonly onResendModelsRequested: Event<void>;
    readonly configuration: TypeScriptServiceConfiguration;
    dispose(): void;
    restartTsServer(): void;
    readonly onTsServerStarted: Event<API>;
    readonly onProjectLanguageServiceStateChanged: Event<Proto.ProjectLanguageServiceStateEventBody>;
    readonly onDidBeginInstallTypings: Event<Proto.BeginInstallTypesEventBody>;
    readonly onDidEndInstallTypings: Event<Proto.EndInstallTypesEventBody>;
    readonly onTypesInstallerInitializationFailed: Event<Proto.TypesInstallerInitializationFailedEventBody>;
    readonly apiVersion: API;
    onReady(f: () => void): Promise<void>;
    private info;
    private error;
    private service;
    ensureServiceStarted(): void;
    private startService;
    openTsServerLogFile(): Promise<boolean>;
    private serviceStarted;
    private setCompilerOptionsForInferredProjects;
    private getCompilerOptionsForInferredProjects;
    private serviceExited;
    normalizePath(resource: Uri): string | null;
    private readonly inMemoryResourcePrefix;
    asUrl(filepath: string): Uri;
    execute(command: string, args: any, expectsResultOrToken?: boolean | CancellationToken): Promise<any>;
    private sendNextRequests;
    private sendRequest;
    private tryCancelRequest;
    private dispatchMessage;
    private dispatchEvent;
    private getTsServerArgs;
    private getDebugPort;
    private resetClientVersion;
}
