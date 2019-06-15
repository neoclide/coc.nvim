import { CancellationToken, Disposable, DocumentSelector, Location, Position, TextDocument } from 'vscode-languageserver-protocol';
import { DefinitionProvider } from './index';
import Manager from './manager';
export default class DefinitionManager extends Manager<DefinitionProvider> implements Disposable {
    register(selector: DocumentSelector, provider: DefinitionProvider): Disposable;
    provideDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<Location[] | null>;
    dispose(): void;
}
