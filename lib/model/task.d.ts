import { Neovim } from '@chemzqm/neovim';
import { TaskOptions } from '../types';
import { Disposable, Event } from 'vscode-languageserver-protocol';
/**
 * Task - task run by vim
 * @public
 */
export default class Task implements Disposable {
    private nvim;
    private id;
    private disposables;
    private readonly _onExit;
    private readonly _onStderr;
    private readonly _onStdout;
    readonly onExit: Event<number>;
    readonly onStdout: Event<string[]>;
    readonly onStderr: Event<string[]>;
    constructor(nvim: Neovim, id: string);
    start(opts: TaskOptions): Promise<boolean>;
    stop(): Promise<void>;
    readonly running: Promise<boolean>;
    dispose(): void;
}
