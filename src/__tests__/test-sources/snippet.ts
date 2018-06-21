import {
  CompletionItemProvider
} from '../../provider'
import {
  CompletionItem,
  TextDocument,
  Position,
  CancellationToken,
  CompletionContext,
  CompletionList,
  InsertTextFormat,
} from 'vscode-languageserver-protocol'
import languages from '../../languages'
import workspace from '../../workspace'

class SnippetProvider implements CompletionItemProvider {
  public async provideCompletionItems(
    document: TextDocument,
    position: Position,
    token: CancellationToken,
    context: CompletionContext
  ): Promise<CompletionItem[] | CompletionList> {
    let {uri} = document
    let doc = workspace.getDocumentFromUri(uri)
    let range = doc.getWordRangeAtPosition(position)
    return [{
      label: 'foo',
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: {
        range,
        newText: '${1:foo} ${2:bar} ${3|first,second,third|}'
      }
    }]
  }
}

const provider = new SnippetProvider()
languages.registerCompletionItemProvider('snippet', 'sni', ['-'], provider)
