import { Disposable } from 'vscode-languageserver-protocol';
import { NeovimClient as Neovim } from '@chemzqm/neovim';
import { StatusBarItem } from '../types';
export default class StatusLine implements Disposable {
    private nvim;
    private items;
    private shownIds;
    private _text;
    private interval;
    constructor(nvim: Neovim);
    dispose(): void;
    createStatusBarItem(priority?: number, isProgress?: boolean): StatusBarItem;
    private getText;
    private setStatusText;
}
