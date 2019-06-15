import { Neovim } from '@chemzqm/neovim';
import { IList, ListContext, ListItem } from '../../types';
import BasicList from '../basic';
export default class LinksList extends BasicList {
    private readonly listMap;
    readonly name = "lists";
    readonly defaultAction = "open";
    readonly description = "registed lists of coc.nvim";
    private mru;
    constructor(nvim: Neovim, listMap: Map<string, IList>);
    loadItems(_context: ListContext): Promise<ListItem[]>;
    doHighlight(): void;
}
