import { TextEdit } from 'vscode-languageserver-protocol'

export function singleLineEdit(edit: TextEdit): boolean {
  let { range, newText } = edit
  return range.start.line == range.end.line && newText.indexOf('\n') == -1
}
