import { CompletionItem, CompletionItemKind, Position } from 'vscode-languageserver-types';
import { CompleteOption } from '../types';
export declare function getPosition(opt: CompleteOption): Position;
export declare function getWord(item: CompletionItem, opt: CompleteOption): string;
export declare function getDocumentation(item: CompletionItem): string;
export declare function completionKindString(kind: CompletionItemKind, map: Map<CompletionItemKind, string>, defaultValue?: string): string;
export declare function getSnippetDocumentation(languageId: string, body: string): string;
export declare function getValidWord(text: string, invalidChars: string[]): string;
