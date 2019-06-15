import { OutputChannel } from './types';
import { Disposable } from 'vscode-jsonrpc';
export interface WatchResponse {
    warning?: string;
    watcher: string;
    watch: string;
    relative_path?: string;
}
export interface FileChangeItem {
    size: number;
    name: string;
    exists: boolean;
    type: 'f' | 'd';
    mtime_ms: number;
}
export interface FileChange {
    root: string;
    subscription: string;
    files: FileChangeItem[];
}
export declare type ChangeCallback = (FileChange: any) => void;
/**
 * Watchman wrapper for fb-watchman client
 *
 * @public
 */
export default class Watchman {
    private channel?;
    private client;
    private watch;
    private relative_path;
    private _disposed;
    constructor(binaryPath: string, channel?: OutputChannel);
    checkCapability(): Promise<boolean>;
    watchProject(root: string): Promise<boolean>;
    private command;
    subscribe(globPattern: string, cb: ChangeCallback): Promise<Disposable>;
    unsubscribe(subscription: string): Promise<any>;
    dispose(): void;
    private appendOutput;
    static dispose(): void;
    static createClient(binaryPath: string, root: string, channel?: OutputChannel): Promise<Watchman | null>;
}
