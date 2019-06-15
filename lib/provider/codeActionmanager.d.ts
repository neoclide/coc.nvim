import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, Disposable, DocumentSelector, Range, TextDocument } from 'vscode-languageserver-protocol';
import { CodeActionProvider } from './index';
import Manager from './manager';
export default class CodeActionManager extends Manager<CodeActionProvider> implements Disposable {
    register(selector: DocumentSelector, provider: CodeActionProvider, clientId: string, codeActionKinds?: CodeActionKind[]): Disposable;
    provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Promise<Map<string, CodeAction[]> | null>;
    dispose(): void;
}
