import { Terminal } from '../types';
import { Neovim } from '@chemzqm/neovim';
export default class TerminalModel implements Terminal {
    private cmd;
    private args;
    private nvim;
    private _name?;
    private chanId;
    bufnr: number;
    constructor(cmd: string, args: string[], nvim: Neovim, _name?: string);
    start(cwd?: string, env?: {
        [key: string]: string | null;
    }): Promise<void>;
    readonly name: string;
    readonly processId: Promise<number>;
    sendText(text: string, addNewLine?: boolean): void;
    show(preserveFocus?: boolean): Promise<void>;
    hide(): Promise<void>;
    dispose(): void;
}
