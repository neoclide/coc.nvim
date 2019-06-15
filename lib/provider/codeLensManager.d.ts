import { CancellationToken, CodeLens, Disposable, DocumentSelector, TextDocument } from 'vscode-languageserver-protocol';
import { CodeLensProvider } from './index';
import Manager from './manager';
export default class CodeLensManager extends Manager<CodeLensProvider> implements Disposable {
    register(selector: DocumentSelector, provider: CodeLensProvider): Disposable;
    provideCodeLenses(document: TextDocument, token: CancellationToken): Promise<CodeLens[] | null>;
    resolveCodeLens(codeLens: CodeLens, token: CancellationToken): Promise<CodeLens>;
    dispose(): void;
}
