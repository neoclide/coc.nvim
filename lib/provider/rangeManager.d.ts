import { SelectionRange, CancellationToken, Disposable, DocumentSelector, Position, TextDocument } from 'vscode-languageserver-protocol';
import { SelectionRangeProvider } from './index';
import Manager from './manager';
export default class SelectionRangeManager extends Manager<SelectionRangeProvider> implements Disposable {
    register(selector: DocumentSelector, provider: SelectionRangeProvider): Disposable;
    provideSelectionRanges(document: TextDocument, positions: Position[], token: CancellationToken): Promise<SelectionRange[] | null>;
    dispose(): void;
}
