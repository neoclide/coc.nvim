import { Neovim } from '@chemzqm/neovim';
import { Event } from 'vscode-languageserver-protocol';
import { ListItem, ListItemsEvent } from '../types';
import { ListManager } from './manager';
export interface ExtendedItem extends ListItem {
    score: number;
    matches: number[];
    filterLabel: string;
}
export default class Worker {
    private nvim;
    private manager;
    private recentFiles;
    private _loading;
    private taskId;
    private task;
    private timer;
    private interval;
    private totalItems;
    private tokenSource;
    private _onDidChangeItems;
    readonly onDidChangeItems: Event<ListItemsEvent>;
    constructor(nvim: Neovim, manager: ListManager);
    private loadMru;
    private loading;
    readonly isLoading: boolean;
    loadItems(reload?: boolean): Promise<void>;
    drawItems(): Promise<void>;
    stop(): void;
    readonly length: number;
    private readonly input;
    private getItemsHighlight;
    private filterItems;
    private getHighlights;
    private parseListItemAnsi;
    private fixLabel;
}
