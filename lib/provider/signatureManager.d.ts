import { CancellationToken, Disposable, DocumentSelector, Position, SignatureHelp, TextDocument } from 'vscode-languageserver-protocol';
import { SignatureHelpProvider } from './index';
import Manager from './manager';
export default class SignatureManager extends Manager<SignatureHelpProvider> implements Disposable {
    register(selector: DocumentSelector, provider: SignatureHelpProvider, triggerCharacters?: string[]): Disposable;
    shouldTrigger(document: TextDocument, triggerCharacter: string): boolean;
    provideSignatureHelp(document: TextDocument, position: Position, token: CancellationToken): Promise<SignatureHelp | null>;
    dispose(): void;
}
