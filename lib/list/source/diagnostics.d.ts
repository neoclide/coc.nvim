import { ListContext, ListItem } from '../../types';
import LocationList from './location';
export default class DiagnosticsList extends LocationList {
    readonly defaultAction = "open";
    readonly description = "diagnostics of current workspace";
    name: string;
    loadItems(context: ListContext): Promise<ListItem[]>;
    doHighlight(): void;
}
