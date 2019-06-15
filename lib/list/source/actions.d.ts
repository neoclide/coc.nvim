import { Neovim } from '@chemzqm/neovim';
import { ListArgument, ListContext, ListItem } from '../../types';
import BasicList from '../basic';
export default class ActionsList extends BasicList {
    defaultAction: string;
    description: string;
    name: string;
    options: ListArgument[];
    constructor(nvim: Neovim);
    loadItems(context: ListContext): Promise<ListItem[]>;
    doHighlight(): void;
}
