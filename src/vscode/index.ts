import Uri, {UriComponents} from './uri'
import * as platform from './platform'
import * as fileSchemes from './fileSchemes'
import {Event, Emitter} from './event'
import {Disposable} from 'vscode-languageserver-protocol'
export {
  Uri,
  UriComponents,
  platform,
  Event,
  fileSchemes,
  Emitter as EventEmitter
}

export enum DiagnosticKind {
  Syntax,
  Semantic,
  Suggestion
}

export function disposeAll(disposables: Disposable[]):void {
  while (disposables.length) {
    const item = disposables.pop()
    if (item) {
      item.dispose()
    }
  }
}
