import { CancellationToken, Disposable, DocumentSelector, Hover, Position, TextDocument } from 'vscode-languageserver-protocol';
import { HoverProvider } from './index';
import Manager from './manager';
export default class HoverManager extends Manager<HoverProvider> implements Disposable {
    register(selector: DocumentSelector, provider: HoverProvider): Disposable;
    provideHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover[] | null>;
    dispose(): void;
}
