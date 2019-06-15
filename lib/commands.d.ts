import { Neovim } from '@chemzqm/neovim';
import * as language from 'vscode-languageserver-protocol';
import { Disposable } from 'vscode-languageserver-protocol';
import Plugin from './plugin';
export interface Command {
    readonly id: string | string[];
    execute(...args: any[]): void | Promise<any>;
}
declare class CommandItem implements Disposable, Command {
    id: string;
    private impl;
    private thisArg;
    internal: boolean;
    constructor(id: string, impl: (...args: any[]) => void, thisArg: any, internal?: boolean);
    execute(...args: any[]): void | Promise<any>;
    dispose(): void;
}
export declare class CommandManager implements Disposable {
    private readonly commands;
    titles: Map<string, string>;
    init(nvim: Neovim, plugin: Plugin): void;
    readonly commandList: CommandItem[];
    dispose(): void;
    execute(command: language.Command): void;
    register<T extends Command>(command: T, internal?: boolean): T;
    has(id: string): boolean;
    unregister(id: string): void;
    /**
     * Registers a command that can be invoked via a keyboard shortcut,
     * a menu item, an action, or directly.
     *
     * Registering a command with an existing command identifier twice
     * will cause an error.
     *
     * @param command A unique identifier for the command.
     * @param impl A command handler function.
     * @param thisArg The `this` context used when invoking the handler function.
     * @return Disposable which unregisters this command on disposal.
     */
    registerCommand(id: string, impl: (...args: any[]) => void, thisArg?: any, internal?: boolean): Disposable;
    /**
     * Executes the command denoted by the given command identifier.
     *
     * * *Note 1:* When executing an editor command not all types are allowed to
     * be passed as arguments. Allowed are the primitive types `string`, `boolean`,
     * `number`, `undefined`, and `null`, as well as [`Position`](#Position), [`Range`](#Range), [`URI`](#URI) and [`Location`](#Location).
     * * *Note 2:* There are no restrictions when executing commands that have been contributed
     * by extensions.
     *
     * @param command Identifier of the command to execute.
     * @param rest Parameters passed to the command function.
     * @return A promise that resolves to the returned value of the given command. `undefined` when
     * the command handler function doesn't return anything.
     */
    executeCommand(command: string, ...rest: any[]): Promise<any>;
    repeatCommand(): Promise<void>;
}
declare const _default: CommandManager;
export default _default;
