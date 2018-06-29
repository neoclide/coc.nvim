import {
  CompletionItem,
  InsertTextFormat,
} from 'vscode-languageserver-protocol'

export function convertCompleteItems(items:CompletionItem[]):CompletionItem[] {
  if (items.length == 0) return items
  for (let item of items) {
    let {textEdit, insertTextFormat} = item
    if (textEdit && insertTextFormat != InsertTextFormat.Snippet) {
      item.insertTextFormat = InsertTextFormat.Snippet
      let {newText} = textEdit
      textEdit.newText = `${newText}$0`
    }
  }
  return items
}
