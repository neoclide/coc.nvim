import { CancellationToken, Disposable, DocumentSelector, Location, Position, TextDocument, LocationLink } from 'vscode-languageserver-protocol';
import { DeclarationProvider } from './index';
import Manager from './manager';
export default class DeclarationManager extends Manager<DeclarationProvider> implements Disposable {
    register(selector: DocumentSelector, provider: DeclarationProvider): Disposable;
    provideDeclaration(document: TextDocument, position: Position, token: CancellationToken): Promise<Location[] | Location | LocationLink[] | null>;
    dispose(): void;
}
