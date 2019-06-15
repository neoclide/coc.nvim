import { Neovim } from '@chemzqm/neovim';
import { ListContext, ListItem } from '../../types';
import BasicList from '../basic';
export default class ServicesList extends BasicList {
    defaultAction: string;
    description: string;
    name: string;
    constructor(nvim: Neovim);
    loadItems(_context: ListContext): Promise<ListItem[]>;
    doHighlight(): void;
}
