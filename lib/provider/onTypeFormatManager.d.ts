import { CancellationToken, Disposable, DocumentSelector, Position, TextDocument, TextEdit } from 'vscode-languageserver-protocol';
import { OnTypeFormattingEditProvider } from './index';
export interface ProviderItem {
    triggerCharacters: string[];
    selector: DocumentSelector;
    provider: OnTypeFormattingEditProvider;
}
export default class OnTypeFormatManager implements Disposable {
    private providers;
    register(selector: DocumentSelector, provider: OnTypeFormattingEditProvider, triggerCharacters: string[]): Disposable;
    getProvider(document: TextDocument, triggerCharacter: string): OnTypeFormattingEditProvider | null;
    onCharacterType(character: string, document: TextDocument, position: Position, token: CancellationToken): Promise<TextEdit[] | null>;
    dispose(): void;
}
