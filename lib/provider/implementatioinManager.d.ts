import { CancellationToken, Disposable, DocumentSelector, Location, Position, TextDocument } from 'vscode-languageserver-protocol';
import { ImplementationProvider } from './index';
import Manager from './manager';
export default class ImplementationManager extends Manager<ImplementationProvider> implements Disposable {
    register(selector: DocumentSelector, provider: ImplementationProvider): Disposable;
    provideReferences(document: TextDocument, position: Position, token: CancellationToken): Promise<Location[] | null>;
    dispose(): void;
}
