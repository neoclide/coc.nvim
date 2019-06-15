import { CancellationToken, Disposable, DocumentSelector, Location, Position, TextDocument } from 'vscode-languageserver-protocol';
import { TypeDefinitionProvider } from './index';
import Manager from './manager';
export default class TypeDefinitionManager extends Manager<TypeDefinitionProvider> implements Disposable {
    register(selector: DocumentSelector, provider: TypeDefinitionProvider): Disposable;
    provideTypeDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<Location[] | null>;
    dispose(): void;
}
