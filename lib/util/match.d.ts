import { DocumentFilter, DocumentSelector } from 'vscode-languageserver-protocol';
export declare function score(selector: DocumentSelector | DocumentFilter | string, uri: string, languageId: string): number;
