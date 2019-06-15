import { ClientCapabilities, InitializeParams, RPCMessageType, ServerCapabilities, WorkspaceFoldersRequest, WorkspaceFoldersChangeEvent } from 'vscode-languageserver-protocol';
import { BaseLanguageClient, DynamicFeature, NextSignature, RegistrationData } from './client';
export interface WorkspaceFolderWorkspaceMiddleware {
    workspaceFolders?: WorkspaceFoldersRequest.MiddlewareSignature;
    didChangeWorkspaceFolders?: NextSignature<WorkspaceFoldersChangeEvent, void>;
}
export declare class WorkspaceFoldersFeature implements DynamicFeature<undefined> {
    private _client;
    private _listeners;
    constructor(_client: BaseLanguageClient);
    readonly messages: RPCMessageType;
    fillInitializeParams(params: InitializeParams): void;
    fillClientCapabilities(capabilities: ClientCapabilities): void;
    initialize(capabilities: ServerCapabilities): void;
    register(_message: RPCMessageType, data: RegistrationData<undefined>): void;
    unregister(id: string): void;
    dispose(): void;
}
