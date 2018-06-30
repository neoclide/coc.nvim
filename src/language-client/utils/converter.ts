import {
  Position,
  CodeLensParams,
  ReferenceParams,
  DocumentSymbolParams,
  DocumentSelector,
  TextDocument,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  WillSaveTextDocumentParams,
  DidSaveTextDocumentParams,
  VersionedTextDocumentIdentifier,
  CompletionContext,
  CompletionParams,
  TextDocumentPositionParams,
  TextDocumentItem,
} from 'vscode-languageserver-protocol'
import {
  TextDocumentWillSaveEvent,
} from '../../types'
import Uri from 'vscode-uri'

export function documentSelectorToLanguageIds(documentSelector:DocumentSelector):string[] {
  let res = documentSelector.map(filter => {
    if (typeof filter == 'string') {
      return filter
    }
    return filter.language
  })
  res = res.filter(s => s != null)
  if (res.length == 0) {
    throw new Error('Invliad document selector')
  }
  return res
}

export function convertToTextDocumentItem(document:TextDocument):TextDocumentItem {
  return {
    uri: document.uri,
    languageId: document.languageId,
    version: document.version,
    text: document.getText()
  }
}

export function asCloseTextDocumentParams(document:TextDocument):DidCloseTextDocumentParams {
  return {
    textDocument: {
      uri: document.uri
    }
  }
}

export function asChangeTextDocumentParams(document:TextDocument):DidChangeTextDocumentParams {
  let result:DidChangeTextDocumentParams = {
    textDocument: {
      uri: document.uri,
      version: document.version
    },
    contentChanges: [{ text: document.getText() }]
  }
  return result
}

export function asWillSaveTextDocumentParams(event:TextDocumentWillSaveEvent):WillSaveTextDocumentParams {
  return {
    textDocument: event.document,
    reason: event.reason
  }
}

export function asVersionedTextDocumentIdentifier(textDocument: TextDocument):VersionedTextDocumentIdentifier {
  return {
    uri: textDocument.uri,
    version: textDocument.version
  }
}

export function asSaveTextDocumentParams(document:TextDocument, includeText:boolean):DidSaveTextDocumentParams {
  let result:DidSaveTextDocumentParams = {
    textDocument: asVersionedTextDocumentIdentifier(document)
  }
  if (includeText) {
    result.text = document.getText()
  }
  return result
}

export function asUri(resource:Uri):string {
  return resource.toString()
}

export function asCompletionParams(textDocument:TextDocument, position:Position, context:CompletionContext):CompletionParams {
  return {
    textDocument: {
      uri: textDocument.uri,
    },
    position,
    context,
  }
}

export function asTextDocumentPositionParams(textDocument:TextDocument, position:Position):TextDocumentPositionParams {
  return {
    textDocument: {
      uri: textDocument.uri,
    },
    position
  }
}

export function asReferenceParams(textDocument:TextDocument, position:Position, options: { includeDeclaration: boolean; }):ReferenceParams {
  return {
    textDocument: {
      uri: textDocument.uri,
    },
    position,
    context: { includeDeclaration: options.includeDeclaration }
  }
}

export function asDocumentSymbolParams(textDocument:TextDocument):DocumentSymbolParams {
  return {
    textDocument: {
      uri: textDocument.uri
    }
  }
}

export function asCodeLensParams(textDocument:TextDocument):CodeLensParams {
  return {
    textDocument: {
      uri: textDocument.uri
    }
  }
}
