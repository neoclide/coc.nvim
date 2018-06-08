/**
 * Helpers for converting FROM LanguageServer types language-server ts types
 */
import {Uri} from '../../util'
import * as Proto from '../protocol'
import {ITypeScriptServiceClient} from '../typescriptService'
import * as language from 'vscode-languageserver-protocol'

export namespace Range {
  export const fromTextSpan = (span: Proto.TextSpan): language.Range => {
    return {
      start: {
        line: span.start.line - 1,
        character: span.start.offset - 1
      },
      end: {
        line: span.end.line - 1,
        character: span.end.offset - 1
      }
    }
  }

  export const toFileRangeRequestArgs = (
    file: string,
    range: language.Range
  ): Proto.FileRangeRequestArgs => ({
    file,
    startLine: range.start.line + 1,
    startOffset: range.start.character + 1,
    endLine: range.end.line + 1,
    endOffset: range.end.character + 1
  })
}

export namespace Position {
  export const fromLocation = (tslocation: Proto.Location): language.Position => {
    return {
      line: tslocation.line - 1,
      character: tslocation.offset - 1
    }
  }

  export const toFileLocationRequestArgs = (
    file: string,
    position: language.Position
  ): Proto.FileLocationRequestArgs => ({
    file,
    line: position.line + 1,
    offset: position.character + 1
  })
}

export namespace Location {
  export const fromTextSpan = (
    resource: Uri,
    tsTextSpan: Proto.TextSpan
  ): language.Location => {
    return {
      uri: resource.toString(),
      range: Range.fromTextSpan(tsTextSpan)
    }
  }
}

export namespace TextEdit {
  export const fromCodeEdit = (edit: Proto.CodeEdit): language.TextEdit => {
    return {
      range: Range.fromTextSpan(edit),
      newText: edit.newText
    }
  }
}

export namespace WorkspaceEdit {
  export function fromFileCodeEdits(
    client: ITypeScriptServiceClient,
    edits: Iterable<Proto.FileCodeEdits>
  ): language.WorkspaceEdit {
    let changes = {}
    for (const edit of edits) {
      let uri = client.asUrl(edit.fileName).toString()
      changes[uri] = edit.textChanges.map(change => {
        return TextEdit.fromCodeEdit(change)
      })
    }
    return {changes}
  }
}
