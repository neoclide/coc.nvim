import { Neovim } from '@chemzqm/neovim';
import { ListContext, ListItem } from '../../types';
import BasicList from '../basic';
export default class OutputList extends BasicList {
    defaultAction: string;
    name: string;
    description: string;
    constructor(nvim: Neovim);
    loadItems(_context: ListContext): Promise<ListItem[]>;
}
