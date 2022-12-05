import type { CodeAction, CodeActionKind, Position, Range, SymbolKind } from 'vscode-languageserver-types'
import type { ProviderName } from '../languages'
import type Document from '../model/document'
import type { TextDocumentMatch } from '../types'
import type { CancellationToken, Disposable } from '../util/protocol'

export interface CurrentState {
  doc: Document
  winid: number
  position: Position
  // :h mode()
  mode: string
}

export interface HandlerDelegate {
  uri: string | undefined
  checkProvider: (id: ProviderName, document: TextDocumentMatch) => void
  withRequestToken: <T> (name: string, fn: (token: CancellationToken) => Thenable<T>, checkEmpty?: boolean) => Promise<T>
  getCurrentState: () => Promise<CurrentState>
  addDisposable: (disposable: Disposable) => void
  getIcon(kind: SymbolKind): { text: string, hlGroup: string }
  getCodeActions(doc: Document, range?: Range, only?: CodeActionKind[]): Promise<CodeAction[]>
  applyCodeAction(action: CodeAction): Promise<void>
}
