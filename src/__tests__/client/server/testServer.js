const assert = require('assert')
const {URI} = require('vscode-uri')
const {
  createConnection, CompletionItemKind, ResourceOperationKind, FailureHandlingKind,
  DiagnosticTag, CompletionItemTag, TextDocumentSyncKind, MarkupKind, SignatureInformation, ParameterInformation,
  Location, Range, DocumentHighlight, DocumentHighlightKind, CodeAction, Command, TextEdit, Position, DocumentLink,
  ColorInformation, Color, ColorPresentation, FoldingRange, SelectionRange, SymbolKind, ProtocolRequestType, WorkDoneProgress,
  SignatureHelpRequest, SemanticTokensRefreshRequest, WorkDoneProgressCreateRequest, CodeLensRefreshRequest, InlayHintRefreshRequest, WorkspaceSymbolRequest, DidChangeConfigurationNotification} = require('vscode-languageserver')

const {
  DidCreateFilesNotification,
  DidRenameFilesNotification,
  DidDeleteFilesNotification,
  WillCreateFilesRequest, WillRenameFilesRequest, WillDeleteFilesRequest, InlayHint, InlayHintLabelPart, InlayHintKind, DocumentDiagnosticReportKind, Diagnostic, DiagnosticSeverity, InlineValueText, InlineValueVariableLookup, InlineValueEvaluatableExpression
} = require('vscode-languageserver-protocol')

let connection = createConnection()

console.log = connection.console.log.bind(connection.console)
console.error = connection.console.error.bind(connection.console)
let disposables = []
connection.onInitialize(params => {
  assert.equal((params.capabilities.workspace).applyEdit, true)
  assert.equal(params.capabilities.workspace.workspaceEdit.documentChanges, true)
  assert.deepEqual(params.capabilities.workspace.workspaceEdit.resourceOperations, ['create', 'rename', 'delete'])
  assert.equal(params.capabilities.workspace.workspaceEdit.failureHandling, FailureHandlingKind.Undo)
  assert.equal(params.capabilities.workspace.workspaceEdit.normalizesLineEndings, true)
  assert.equal(params.capabilities.workspace.workspaceEdit.changeAnnotationSupport.groupsOnLabel, false)
  assert.equal(params.capabilities.workspace.symbol.resolveSupport.properties[0], 'location.range')
  assert.equal(params.capabilities.textDocument.completion.completionItem.deprecatedSupport, true)
  assert.equal(params.capabilities.textDocument.completion.completionItem.preselectSupport, true)
  assert.equal(params.capabilities.textDocument.completion.completionItem.tagSupport.valueSet.length, 1)
  assert.equal(params.capabilities.textDocument.completion.completionItem.tagSupport.valueSet[0], CompletionItemTag.Deprecated)
  assert.equal(params.capabilities.textDocument.signatureHelp.signatureInformation.parameterInformation.labelOffsetSupport, true)
  assert.equal(params.capabilities.textDocument.definition.linkSupport, true)
  assert.equal(params.capabilities.textDocument.declaration.linkSupport, true)
  assert.equal(params.capabilities.textDocument.implementation.linkSupport, true)
  assert.equal(params.capabilities.textDocument.typeDefinition.linkSupport, true)
  assert.equal(params.capabilities.textDocument.rename.prepareSupport, true)
  assert.equal(params.capabilities.textDocument.publishDiagnostics.relatedInformation, true)
  assert.equal(params.capabilities.textDocument.publishDiagnostics.tagSupport.valueSet.length, 2)
  assert.equal(params.capabilities.textDocument.publishDiagnostics.tagSupport.valueSet[0], DiagnosticTag.Unnecessary)
  assert.equal(params.capabilities.textDocument.publishDiagnostics.tagSupport.valueSet[1], DiagnosticTag.Deprecated)
  assert.equal(params.capabilities.textDocument.documentLink.tooltipSupport, true)
  assert.equal(params.capabilities.textDocument.inlineValue.dynamicRegistration, true)
  assert.equal(params.capabilities.textDocument.inlayHint.dynamicRegistration, true)
  assert.equal(params.capabilities.textDocument.inlayHint.resolveSupport.properties[0], 'tooltip')

  let valueSet = params.capabilities.textDocument.completion.completionItemKind.valueSet
  assert.equal(valueSet[0], 1)
  assert.equal(valueSet[valueSet.length - 1], CompletionItemKind.TypeParameter)
  assert.deepEqual(params.capabilities.workspace.workspaceEdit.resourceOperations, [ResourceOperationKind.Create, ResourceOperationKind.Rename, ResourceOperationKind.Delete])
  assert.equal(params.capabilities.workspace.fileOperations.willCreate, true)

  let diagnosticClientCapabilities = params.capabilities.textDocument.diagnostic
  assert.equal(diagnosticClientCapabilities.dynamicRegistration, true)
  assert.equal(diagnosticClientCapabilities.relatedDocumentSupport, true)

  const capabilities = {
    textDocumentSync: TextDocumentSyncKind.Full,
    definitionProvider: true,
    hoverProvider: true,
    signatureHelpProvider: {
      triggerCharacters: [','],
      retriggerCharacters: [';']
    },
    completionProvider: {resolveProvider: true, triggerCharacters: ['"', ':']},
    referencesProvider: true,
    documentHighlightProvider: true,
    codeActionProvider: {
      resolveProvider: true
    },
    codeLensProvider: {
      resolveProvider: true
    },
    documentFormattingProvider: true,
    documentRangeFormattingProvider: true,
    documentOnTypeFormattingProvider: {
      firstTriggerCharacter: ':'
    },
    renameProvider: {
      prepareProvider: true
    },
    documentLinkProvider: {
      resolveProvider: true
    },
    colorProvider: true,
    declarationProvider: true,
    foldingRangeProvider: true,
    implementationProvider: {
      documentSelector: [{language: '*'}]
    },
    selectionRangeProvider: true,
    inlineValueProvider: {},
    inlayHintProvider: {
      resolveProvider: true
    },
    typeDefinitionProvider: {
      id: '82671a9a-2a69-4e9f-a8d7-e1034eaa0d2e',
      documentSelector: [{language: '*'}]
    },
    callHierarchyProvider: true,
    semanticTokensProvider: {
      legend: {
        tokenTypes: [],
        tokenModifiers: []
      },
      range: true,
      full: {
        delta: true
      }
    },
    workspace: {
      fileOperations: {
        // Static reg is folders + .txt files with operation kind in the path
        didCreate: {
          filters: [{scheme: 'file', pattern: {glob: '**/created-static/**{/,/*.txt}'}}]
        },
        didRename: {
          filters: [
            {scheme: 'file', pattern: {glob: '**/renamed-static/**/', matches: 'folder'}},
            {scheme: 'file', pattern: {glob: '**/renamed-static/**/*.txt', matches: 'file'}}
          ]
        },
        didDelete: {
          filters: [{scheme: 'file', pattern: {glob: '**/deleted-static/**{/,/*.txt}'}}]
        },
        willCreate: {
          filters: [{scheme: 'file', pattern: {glob: '**/created-static/**{/,/*.txt}'}}]
        },
        willRename: {
          filters: [
            {scheme: 'file', pattern: {glob: '**/renamed-static/**/', matches: 'folder'}},
            {scheme: 'file', pattern: {glob: '**/renamed-static/**/*.txt', matches: 'file'}}
          ]
        },
        willDelete: {
          filters: [{scheme: 'file', pattern: {glob: '**/deleted-static/**{/,/*.txt}'}}]
        },
      },
    },
    linkedEditingRangeProvider: true,
    diagnosticProvider: {
      identifier: 'da348dc5-c30a-4515-9d98-31ff3be38d14',
      interFileDependencies: true,
      workspaceDiagnostics: true
    },
    typeHierarchyProvider: true,
    workspaceSymbolProvider: {
      resolveProvider: true
    },
    notebookDocumentSync: {
      notebookSelector: [{
        notebook: {notebookType: 'jupyter-notebook'},
        cells: [{language: 'python'}]
      }]
    }
  }
  return {capabilities, customResults: {hello: 'world'}}
})

connection.onInitialized(() => {
  // Dynamic reg is folders + .js files with operation kind in the path
  connection.client.register(DidCreateFilesNotification.type, {
    filters: [{scheme: 'file', pattern: {glob: '**/created-dynamic/**{/,/*.js}'}}]
  })
  connection.client.register(DidRenameFilesNotification.type, {
    filters: [
      {scheme: 'file', pattern: {glob: '**/renamed-dynamic/**/', matches: 'folder'}},
      {scheme: 'file', pattern: {glob: '**/renamed-dynamic/**/*.js', matches: 'file'}}
    ]
  })
  connection.client.register(DidDeleteFilesNotification.type, {
    filters: [{scheme: 'file', pattern: {glob: '**/deleted-dynamic/**{/,/*.js}'}}]
  })
  connection.client.register(WillCreateFilesRequest.type, {
    filters: [{scheme: 'file', pattern: {glob: '**/created-dynamic/**{/,/*.js}'}}]
  })
  connection.client.register(WillRenameFilesRequest.type, {
    filters: [
      {scheme: 'file', pattern: {glob: '**/renamed-dynamic/**/', matches: 'folder'}},
      {scheme: 'file', pattern: {glob: '**/renamed-dynamic/**/*.js', matches: 'file'}}
    ]
  })
  connection.client.register(WillDeleteFilesRequest.type, {
    filters: [{scheme: 'file', pattern: {glob: '**/deleted-dynamic/**{/,/*.js}'}}]
  })
  connection.client.register(SignatureHelpRequest.type, {
    triggerCharacters: [':'],
    retriggerCharacters: [':']
  }).then(d => {
    disposables.push(d)
  })
  connection.client.register(WorkspaceSymbolRequest.type, {
    workDoneProgress: false,
    resolveProvider: true
  }).then(d => {
    disposables.push(d)
  })
  connection.client.register(DidChangeConfigurationNotification.type, {
    section: 'http'
  }).then(d => {
    disposables.push(d)
  })
  connection.client.register(DidCreateFilesNotification.type, {
    filters: [{
      pattern: {
        glob: '**/renamed-dynamic/**/',
        matches: 'folder',
        options: {
          ignoreCase: true
        }
      }
    }]
  }).then(d => {
    disposables.push(d)
  })
})

connection.onNotification('unregister', () => {
  for (let d of disposables) {
    d.dispose()
    disposables = []
  }
})

connection.onCodeLens(params => {
  return [{range: Range.create(0, 0, 0, 3)}, {range: Range.create(1, 0, 1, 3)}]
})

connection.onNotification('fireCodeLensRefresh', () => {
  connection.sendRequest(CodeLensRefreshRequest.type)
})

connection.onNotification('fireSemanticTokensRefresh', () => {
  connection.sendRequest(SemanticTokensRefreshRequest.type)
})

connection.onNotification('fireInlayHintsRefresh', () => {
  connection.sendRequest(InlayHintRefreshRequest.type)
})

connection.onCodeLensResolve(codelens => {
  return {range: codelens.range, command: {title: 'format', command: 'editor.action.format'}}
})

connection.onDeclaration(params => {
  assert.equal(params.position.line, 1)
  assert.equal(params.position.character, 1)
  return {uri: params.textDocument.uri, range: {start: {line: 1, character: 1}, end: {line: 1, character: 2}}}
})

connection.onDefinition(params => {
  assert.equal(params.position.line, 1)
  assert.equal(params.position.character, 1)
  return {uri: params.textDocument.uri, range: {start: {line: 0, character: 0}, end: {line: 0, character: 1}}}
})

connection.onHover(_params => {
  return {
    contents: {
      kind: MarkupKind.PlainText,
      value: 'foo'
    }
  }
})

connection.onCompletion(_params => {
  return [
    {label: 'item', insertText: 'text'}
  ]
})

connection.onCompletionResolve(item => {
  item.detail = 'detail'
  return item
})

connection.onSignatureHelp(_params => {
  const result = {
    signatures: [
      SignatureInformation.create('label', 'doc', ParameterInformation.create('label', 'doc'))
    ],
    activeSignature: 1,
    activeParameter: 1
  }
  return result
})

connection.onReferences(params => {
  return [
    Location.create(params.textDocument.uri, Range.create(0, 0, 0, 0)),
    Location.create(params.textDocument.uri, Range.create(1, 1, 1, 1))
  ]
})

connection.onDocumentHighlight(_params => {
  return [
    DocumentHighlight.create(Range.create(2, 2, 2, 2), DocumentHighlightKind.Read)
  ]
})

connection.onCodeAction(params => {
  if (params.textDocument.uri.endsWith('empty.bat')) return undefined
  return [
    CodeAction.create('title', Command.create('title', 'test_command'))
  ]
})

connection.onExecuteCommand(params => {
  if (params.command == 'test_command') {
    return {success: true}
  }
})

connection.onCodeActionResolve(codeAction => {
  codeAction.title = 'resolved'
  return codeAction
})

connection.onDocumentFormatting(_params => {
  return [
    TextEdit.insert(Position.create(0, 0), 'insert')
  ]
})

connection.onDocumentRangeFormatting(_params => {
  return [
    TextEdit.del(Range.create(1, 1, 1, 2))
  ]
})

connection.onDocumentOnTypeFormatting(_params => {
  return [
    TextEdit.replace(Range.create(2, 2, 2, 3), 'replace')
  ]
})

connection.onPrepareRename(_params => {
  return Range.create(1, 1, 1, 2)
})

connection.onRenameRequest(_params => {
  return {documentChanges: []}
})

connection.onDocumentLinks(_params => {
  return [
    DocumentLink.create(Range.create(1, 1, 1, 2))
  ]
})

connection.onDocumentLinkResolve(link => {
  link.target = URI.file('/target.txt').toString()
  return link
})

connection.onDocumentColor(_params => {
  return [
    ColorInformation.create(Range.create(1, 1, 1, 2), Color.create(1, 1, 1, 1))
  ]
})

connection.onColorPresentation(_params => {
  return [
    ColorPresentation.create('label')
  ]
})

connection.onFoldingRanges(_params => {
  return [
    FoldingRange.create(1, 2)
  ]
})

connection.onImplementation(params => {
  assert.equal(params.position.line, 1)
  assert.equal(params.position.character, 1)
  return {uri: params.textDocument.uri, range: {start: {line: 2, character: 2}, end: {line: 3, character: 3}}}
})

connection.onSelectionRanges(_params => {
  return [
    SelectionRange.create(Range.create(1, 2, 3, 4))
  ]
})

let lastFileOperationRequest
connection.workspace.onDidCreateFiles(params => {lastFileOperationRequest = {type: 'create', params}})
connection.workspace.onDidRenameFiles(params => {lastFileOperationRequest = {type: 'rename', params}})
connection.workspace.onDidDeleteFiles(params => {lastFileOperationRequest = {type: 'delete', params}})

connection.onRequest(
  new ProtocolRequestType('testing/lastFileOperationRequest'),
  () => {
    return lastFileOperationRequest
  },
)

connection.workspace.onWillCreateFiles(params => {
  const createdFilenames = params.files.map(f => `${f.uri}`).join('\n')
  return {
    documentChanges: [{
      textDocument: {uri: '/dummy-edit', version: null},
      edits: [
        TextEdit.insert(Position.create(0, 0), `WILL CREATE:\n${createdFilenames}`),
      ]
    }],
  }
})

connection.workspace.onWillRenameFiles(params => {
  const renamedFilenames = params.files.map(f => `${f.oldUri} -> ${f.newUri}`).join('\n')
  return {
    documentChanges: [{
      textDocument: {uri: '/dummy-edit', version: null},
      edits: [
        TextEdit.insert(Position.create(0, 0), `WILL RENAME:\n${renamedFilenames}`),
      ]
    }],
  }
})

connection.workspace.onWillDeleteFiles(params => {
  const deletedFilenames = params.files.map(f => `${f.uri}`).join('\n')
  return {
    documentChanges: [{
      textDocument: {uri: '/dummy-edit', version: null},
      edits: [
        TextEdit.insert(Position.create(0, 0), `WILL DELETE:\n${deletedFilenames}`),
      ]
    }],
  }
})

connection.onTypeDefinition(params => {
  assert.equal(params.position.line, 1)
  assert.equal(params.position.character, 1)
  return {uri: params.textDocument.uri, range: {start: {line: 2, character: 2}, end: {line: 3, character: 3}}}
})

connection.languages.callHierarchy.onPrepare(params => {
  return [
    {
      kind: SymbolKind.Function,
      name: 'name',
      range: Range.create(1, 1, 1, 1),
      selectionRange: Range.create(2, 2, 2, 2),
      uri: params.textDocument.uri
    }
  ]
})

connection.languages.callHierarchy.onIncomingCalls(params => {
  return [
    {
      from: params.item,
      fromRanges: [Range.create(1, 1, 1, 1)]
    }
  ]
})

connection.languages.callHierarchy.onOutgoingCalls(params => {
  return [
    {
      to: params.item,
      fromRanges: [Range.create(1, 1, 1, 1)]
    }
  ]
})

connection.languages.semanticTokens.onRange(() => {
  return {
    resultId: '1',
    data: []
  }
})

connection.languages.semanticTokens.on(() => {
  return {
    resultId: '2',
    data: []
  }
})

connection.languages.semanticTokens.onDelta(() => {
  return {
    resultId: '3',
    data: []
  }
})

connection.languages.diagnostics.on(() => {
  return {
    kind: DocumentDiagnosticReportKind.Full,
    items: [
      Diagnostic.create(Range.create(1, 1, 1, 1), 'diagnostic', DiagnosticSeverity.Error)
    ]
  }
})

connection.languages.diagnostics.onWorkspace(() => {
  return {
    items: [{
      kind: DocumentDiagnosticReportKind.Full,
      uri: 'uri',
      version: 1,
      items: [
        Diagnostic.create(Range.create(1, 1, 1, 1), 'diagnostic', DiagnosticSeverity.Error)
      ]
    }]
  }
})

const typeHierarchySample = {
  superTypes: [],
  subTypes: []
}
connection.languages.typeHierarchy.onPrepare(params => {
  const currentItem = {
    kind: SymbolKind.Class,
    name: 'ClazzB',
    range: Range.create(1, 1, 1, 1),
    selectionRange: Range.create(2, 2, 2, 2),
    uri: params.textDocument.uri
  }
  typeHierarchySample.superTypes = [{...currentItem, name: 'classA', uri: 'uri-for-A'}]
  typeHierarchySample.subTypes = [{...currentItem, name: 'classC', uri: 'uri-for-C'}]
  return [currentItem]
})

connection.languages.typeHierarchy.onSupertypes(_params => {
  return typeHierarchySample.superTypes
})

connection.languages.typeHierarchy.onSubtypes(_params => {
  return typeHierarchySample.subTypes
})

connection.languages.inlineValue.on(_params => {
  return [
    InlineValueText.create(Range.create(1, 2, 3, 4), 'text'),
    InlineValueVariableLookup.create(Range.create(1, 2, 3, 4), 'variableName', false),
    InlineValueEvaluatableExpression.create(Range.create(1, 2, 3, 4), 'expression'),
  ]
})
connection.languages.inlayHint.on(() => {
  const one = InlayHint.create(Position.create(1, 1), [InlayHintLabelPart.create('type')], InlayHintKind.Type)
  one.data = '1'
  const two = InlayHint.create(Position.create(2, 2), [InlayHintLabelPart.create('parameter')], InlayHintKind.Parameter)
  two.data = '2'
  return [one, two]
})

connection.languages.inlayHint.resolve(hint => {
  if (typeof hint.label === 'string') {
    hint.label = 'tooltip'
  } else {
    hint.label[0].tooltip = 'tooltip'
  }
  return hint
})

connection.languages.onLinkedEditingRange(() => {
  return {
    ranges: [Range.create(1, 1, 1, 1)],
    wordPattern: '\\w'
  }
})

connection.onRequest(
  new ProtocolRequestType('testing/sendSampleProgress'),
  async (_, __) => {
    const progressToken = 'TEST-PROGRESS-TOKEN'
    await connection.sendRequest(WorkDoneProgressCreateRequest.type, {token: progressToken})
    void connection.sendProgress(WorkDoneProgress.type, progressToken, {kind: 'begin', title: 'Test Progress'})
    void connection.sendProgress(WorkDoneProgress.type, progressToken, {kind: 'report', percentage: 50, message: 'Halfway!'})
    void connection.sendProgress(WorkDoneProgress.type, progressToken, {kind: 'end', message: 'Completed!'})
  },
)

connection.onRequest(
  new ProtocolRequestType('testing/beginOnlyProgress'),
  async (_, __) => {
    const progressToken = 'TEST-PROGRESS-BEGIN'
    await connection.sendRequest(WorkDoneProgressCreateRequest.type, {token: progressToken})
  },
)

connection.onWorkspaceSymbol(() => {
  return [
    {name: 'name', kind: SymbolKind.Array, location: {uri: 'file:///abc.txt'}}
  ]
})

connection.onWorkspaceSymbolResolve(symbol => {
  symbol.location = Location.create(symbol.location.uri, Range.create(1, 2, 3, 4))
  return symbol
})

// Listen on the connection
connection.listen()
