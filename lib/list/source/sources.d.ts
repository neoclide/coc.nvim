import { Neovim } from '@chemzqm/neovim';
import { ListContext, ListItem } from '../../types';
import BasicList from '../basic';
export default class SourcesList extends BasicList {
    readonly defaultAction = "toggle";
    readonly description = "registed completion sources";
    readonly name = "sources";
    constructor(nvim: Neovim);
    loadItems(_context: ListContext): Promise<ListItem[]>;
    doHighlight(): void;
}
