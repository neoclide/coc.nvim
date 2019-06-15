import { CancellationToken, Disposable, DocumentSelector, FormattingOptions, TextDocument, TextEdit } from 'vscode-languageserver-protocol';
import { DocumentFormattingEditProvider } from './index';
import Manager from './manager';
export default class FormatManager extends Manager<DocumentFormattingEditProvider> implements Disposable {
    register(selector: DocumentSelector, provider: DocumentFormattingEditProvider, priority?: number): Disposable;
    provideDocumentFormattingEdits(document: TextDocument, options: FormattingOptions, token: CancellationToken): Promise<TextEdit[]>;
    dispose(): void;
}
