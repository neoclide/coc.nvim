import { Disposable, Event } from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';
import Watchman from '../watchman';
import { RenameEvent } from '../types';
export default class FileSystemWatcher implements Disposable {
    private globPattern;
    ignoreCreateEvents: boolean;
    ignoreChangeEvents: boolean;
    ignoreDeleteEvents: boolean;
    private _onDidCreate;
    private _onDidChange;
    private _onDidDelete;
    private _onDidRename;
    readonly onDidCreate: Event<URI>;
    readonly onDidChange: Event<URI>;
    readonly onDidDelete: Event<URI>;
    readonly onDidRename: Event<RenameEvent>;
    private disposables;
    constructor(clientPromise: Promise<Watchman> | null, globPattern: string, ignoreCreateEvents: boolean, ignoreChangeEvents: boolean, ignoreDeleteEvents: boolean);
    private listen;
    dispose(): void;
}
