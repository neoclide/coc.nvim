import { CancellationToken, Disposable, DocumentSelector, Location, Position, ReferenceContext, TextDocument } from 'vscode-languageserver-protocol';
import { ReferenceProvider } from './index';
import Manager from './manager';
export default class ReferenceManager extends Manager<ReferenceProvider> implements Disposable {
    register(selector: DocumentSelector, provider: ReferenceProvider): Disposable;
    provideReferences(document: TextDocument, position: Position, context: ReferenceContext, token: CancellationToken): Promise<Location[] | null>;
    dispose(): void;
}
