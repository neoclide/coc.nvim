import { ListContext, ListItem } from '../../types';
import LocationList from './location';
export default class Symbols extends LocationList {
    readonly interactive = true;
    readonly description = "search workspace symbols";
    readonly detail = "Symbols list if provided by server, it works on interactive mode only.\n";
    name: string;
    loadItems(context: ListContext): Promise<ListItem[]>;
    resolveItem(item: ListItem): Promise<ListItem>;
    doHighlight(): void;
    private validWorkspaceSymbol;
}
