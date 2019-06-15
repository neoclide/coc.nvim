import { CancellationToken, Disposable, DocumentSelector, FoldingRange, TextDocument } from 'vscode-languageserver-protocol';
import { FoldingContext, FoldingRangeProvider } from './index';
import Manager from './manager';
export default class FoldingRangeManager extends Manager<FoldingRangeProvider> implements Disposable {
    register(selector: DocumentSelector, provider: FoldingRangeProvider): Disposable;
    provideFoldingRanges(document: TextDocument, context: FoldingContext, token: CancellationToken): Promise<FoldingRange[] | null>;
    dispose(): void;
}
