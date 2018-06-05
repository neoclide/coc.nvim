import Uri, { UriComponents } from './uri';
import * as platform from './platform';
import * as fileSchemes from './fileSchemes';
import { Event, Emitter } from './event';
import { Disposable } from 'vscode-languageserver-protocol';
export { Uri, UriComponents, platform, Event, fileSchemes, Emitter as EventEmitter };
export declare enum DiagnosticKind {
    Syntax = 0,
    Semantic = 1,
    Suggestion = 2
}
export declare function disposeAll(disposables: Disposable[]): void;
