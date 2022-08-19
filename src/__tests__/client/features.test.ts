import * as assert from 'assert'
import path from 'path'
import { URI } from 'vscode-uri'
import { LanguageClient, ServerOptions, TransportKind, Middleware, LanguageClientOptions, State } from '../../language-client/index'
import { CancellationTokenSource, Color, DocumentSelector, Position, Range, DefinitionRequest, Location, HoverRequest, Hover, CompletionRequest, CompletionTriggerKind, CompletionItem, SignatureHelpRequest, SignatureHelpTriggerKind, SignatureInformation, ParameterInformation, ReferencesRequest, DocumentHighlightRequest, DocumentHighlight, DocumentHighlightKind, CodeActionRequest, CodeAction, WorkDoneProgressBegin, WorkDoneProgressReport, WorkDoneProgressEnd, ProgressToken, DocumentFormattingRequest, TextEdit, DocumentRangeFormattingRequest, DocumentOnTypeFormattingRequest, RenameRequest, WorkspaceEdit, DocumentLinkRequest, DocumentLink, DocumentColorRequest, ColorInformation, ColorPresentation, DeclarationRequest, FoldingRangeRequest, FoldingRange, ImplementationRequest, SelectionRangeRequest, SelectionRange, TypeDefinitionRequest, ProtocolRequestType, CallHierarchyPrepareRequest, CallHierarchyItem, CallHierarchyIncomingCall, CallHierarchyOutgoingCall, SemanticTokensRegistrationType, LinkedEditingRangeRequest, WillCreateFilesRequest, DidCreateFilesNotification, WillRenameFilesRequest, DidRenameFilesNotification, WillDeleteFilesRequest, DidDeleteFilesNotification, TextDocumentEdit, InlayHintRequest, InlayHintLabelPart, InlayHintKind, WorkspaceSymbolRequest, TypeHierarchyPrepareRequest, InlineValueRequest, InlineValueText, InlineValueVariableLookup, InlineValueEvaluatableExpression, DocumentDiagnosticRequest, DocumentDiagnosticReport, FullDocumentDiagnosticReport, DocumentDiagnosticReportKind, CancellationToken, TextDocumentSyncKind, Disposable, NotificationType0, DidChangeTextDocumentNotification, WillSaveTextDocumentNotification, DidOpenTextDocumentNotification, WillSaveTextDocumentWaitUntilRequest, DidSaveTextDocumentNotification, DidCloseTextDocumentNotification, CodeLensRequest, DocumentSymbolRequest, DidChangeConfigurationNotification, ConfigurationRequest, WorkDoneProgressCreateRequest, DidChangeWatchedFilesNotification } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import helper from '../helper'
import workspace from '../../workspace'
import languages from '../../languages'
import commands from '../../commands'

beforeAll(async () => {
  await helper.setup()
})

afterAll(async () => {
  await helper.shutdown()
})
describe('Client integration', () => {
  let client!: LanguageClient
  let middleware: Middleware
  let uri!: string
  let document!: TextDocument
  let tokenSource!: CancellationTokenSource
  const position: Position = Position.create(1, 1)
  const range: Range = Range.create(1, 1, 1, 2)
  let contentProviderDisposable: Disposable

  function rangeEqual(range: Range, sl: number, sc: number, el: number, ec: number): void {
    assert.strictEqual(range.start.line, sl)
    assert.strictEqual(range.start.character, sc)
    assert.strictEqual(range.end.line, el)
    assert.strictEqual(range.end.character, ec)
  }

  function positionEqual(pos: Position, l: number, c: number): void {
    assert.strictEqual(pos.line, l)
    assert.strictEqual(pos.character, c)
  }

  function colorEqual(color: Color, red: number, green: number, blue: number, alpha: number): void {
    assert.strictEqual(color.red, red)
    assert.strictEqual(color.green, green)
    assert.strictEqual(color.blue, blue)
    assert.strictEqual(color.alpha, alpha)
  }

  function uriEqual(actual: string, expected: string): void {
    assert.strictEqual(actual, expected)
  }

  function isArray<T>(value: Array<T> | undefined | null, clazz: any, length = 1): asserts value is Array<T> {
    assert.ok(Array.isArray(value), `value is array`)
    assert.strictEqual(value!.length, length, 'value has given length')
    if (clazz && typeof clazz.is === 'function') {
      for (let item of value) {
        assert.ok(clazz.is(item))
      }
    }
  }

  function isDefined<T>(value: T | undefined | null): asserts value is Exclude<T, undefined | null> {
    if (value === undefined || value === null) {
      throw new Error(`Value is null or undefined`)
    }
  }

  function isFullDocumentDiagnosticReport(value: DocumentDiagnosticReport): asserts value is FullDocumentDiagnosticReport {
    assert.ok(value.kind === DocumentDiagnosticReportKind.Full)
  }

  beforeAll(async () => {
    contentProviderDisposable = workspace.registerTextDocumentContentProvider('lsptests', {
      provideTextDocumentContent: (_uri: URI) => {
        return [
          'REM @ECHO OFF',
          'cd c:\\source',
          'REM This is the location of the files that you want to sort',
          'FOR %%f IN (*.doc *.txt) DO XCOPY c:\\source\\"%%f" c:\\text /m /y',
          'REM This moves any files with a .doc or',
          'REM .txt extension from c:\\source to c:\\text',
          'REM %%f is a variable',
          'FOR %%f IN (*.jpg *.png *.bmp) DO XCOPY C:\\source\\"%%f" c:\\images /m /y',
          'REM This moves any files with a .jpg, .png,',
          'REM or .bmp extension from c:\\source to c:\\images;;',
        ].join('\n')
      }
    })

    uri = URI.parse('lsptests://localhost/test.bat').toString()
    let doc = await workspace.loadFile(uri.toString())
    document = doc.textDocument
    tokenSource = new CancellationTokenSource()
    const serverModule = path.join(__dirname, './server/testServer.js')
    const serverOptions: ServerOptions = {
      run: { module: serverModule, transport: TransportKind.ipc },
      debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6014'] } }
    }
    const documentSelector: DocumentSelector = [{ scheme: 'lsptests' }]

    middleware = {}
    const clientOptions: LanguageClientOptions = {
      documentSelector, synchronize: {}, initializationOptions: {}, middleware
    }

    client = new LanguageClient('test svr', 'Test Language Server', serverOptions, clientOptions)
    let p = client.onReady()
    await client.start()
    await p
  })

  afterAll(async () => {
    await client.sendNotification('unregister')
    await helper.wait(50)
    contentProviderDisposable.dispose()
    await client.stop()
  })

  test('InitializeResult', () => {
    let expected = {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
        definitionProvider: true,
        hoverProvider: true,
        signatureHelpProvider: {
          triggerCharacters: [','],
          retriggerCharacters: [';']
        },
        completionProvider: { resolveProvider: true, triggerCharacters: ['"', ':'] },
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
          documentSelector: [{ language: '*' }]
        },
        selectionRangeProvider: true,
        inlineValueProvider: {},
        inlayHintProvider: {
          resolveProvider: true
        },
        typeDefinitionProvider: {
          id: '82671a9a-2a69-4e9f-a8d7-e1034eaa0d2e',
          documentSelector: [{ language: '*' }]
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
            didCreate: { filters: [{ scheme: 'file', pattern: { glob: '**/created-static/**{/,/*.txt}' } }] },
            didRename: {
              filters: [
                { scheme: 'file', pattern: { glob: '**/renamed-static/**/', matches: 'folder' } },
                { scheme: 'file', pattern: { glob: '**/renamed-static/**/*.txt', matches: 'file' } }
              ]
            },
            didDelete: { filters: [{ scheme: 'file', pattern: { glob: '**/deleted-static/**{/,/*.txt}' } }] },
            willCreate: { filters: [{ scheme: 'file', pattern: { glob: '**/created-static/**{/,/*.txt}' } }] },
            willRename: {
              filters: [
                { scheme: 'file', pattern: { glob: '**/renamed-static/**/', matches: 'folder' } },
                { scheme: 'file', pattern: { glob: '**/renamed-static/**/*.txt', matches: 'file' } }
              ]
            },
            willDelete: { filters: [{ scheme: 'file', pattern: { glob: '**/deleted-static/**{/,/*.txt}' } }] },
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
            notebook: { notebookType: 'jupyter-notebook' },
            cells: [{ language: 'python' }]
          }]
        }
      },
      customResults: {
        hello: 'world'
      }
    }
    assert.deepEqual(client.initializeResult, expected)
  })

  test('feature.getState()', async () => {
    const testFeature = (method: string, kind: string): void => {
      let feature = client.getFeature(method as any)
      assert.notStrictEqual(feature, undefined)
      let res = feature.getState()
      assert.strictEqual(res.kind, kind)
    }
    const testStaticFeature = (method: string, kind: string): void => {
      let feature = client.getStaticFeature(method as any)
      assert.notStrictEqual(feature, undefined)
      let res = feature.getState()
      assert.strictEqual(res.kind, kind)
    }
    testStaticFeature(ConfigurationRequest.method, 'static')
    testStaticFeature(WorkDoneProgressCreateRequest.method, 'window')
    testFeature(DidChangeWatchedFilesNotification.method, 'workspace')
    testFeature(DidChangeConfigurationNotification.method, 'workspace')
    testFeature(DidOpenTextDocumentNotification.method, 'document')
    testFeature(DidChangeTextDocumentNotification.method, 'document')
    testFeature(WillSaveTextDocumentNotification.method, 'document')
    testFeature(WillSaveTextDocumentWaitUntilRequest.method, 'document')
    testFeature(DidSaveTextDocumentNotification.method, 'document')
    testFeature(DidCloseTextDocumentNotification.method, 'document')
    testFeature(DidCreateFilesNotification.method, 'workspace')
    testFeature(DidRenameFilesNotification.method, 'workspace')
    testFeature(DidDeleteFilesNotification.method, 'workspace')
    testFeature(WillCreateFilesRequest.method, 'workspace')
    testFeature(WillRenameFilesRequest.method, 'workspace')
    testFeature(WillDeleteFilesRequest.method, 'workspace')
    testFeature(CompletionRequest.method, 'document')
    testFeature(HoverRequest.method, 'document')
    testFeature(SignatureHelpRequest.method, 'document')
    testFeature(DefinitionRequest.method, 'document')
    testFeature(ReferencesRequest.method, 'document')
    testFeature(DocumentHighlightRequest.method, 'document')
    testFeature(CodeActionRequest.method, 'document')
    testFeature(CodeLensRequest.method, 'document')
    testFeature(DocumentFormattingRequest.method, 'document')
    testFeature(DocumentRangeFormattingRequest.method, 'document')
    testFeature(DocumentOnTypeFormattingRequest.method, 'document')
    testFeature(RenameRequest.method, 'document')
    testFeature(DocumentSymbolRequest.method, 'document')
    testFeature(DocumentLinkRequest.method, 'document')
    testFeature(DocumentColorRequest.method, 'document')
    testFeature(DeclarationRequest.method, 'document')
    testFeature(FoldingRangeRequest.method, 'document')
    testFeature(ImplementationRequest.method, 'document')
    testFeature(SelectionRangeRequest.method, 'document')
    testFeature(TypeDefinitionRequest.method, 'document')
    testFeature(CallHierarchyPrepareRequest.method, 'document')
    testFeature(SemanticTokensRegistrationType.method, 'document')
    testFeature(LinkedEditingRangeRequest.method, 'document')
    testFeature(TypeHierarchyPrepareRequest.method, 'document')
    testFeature(InlineValueRequest.method, 'document')
    testFeature(InlayHintRequest.method, 'document')
    testFeature(WorkspaceSymbolRequest.method, 'workspace')
    testFeature(DocumentDiagnosticRequest.method, 'document')
  })

  test('Goto Definition', async () => {
    const provider = client.getFeature(DefinitionRequest.method).getProvider(document)
    isDefined(provider)
    const result = (await provider.provideDefinition(document, position, tokenSource.token)) as Location
    assert.strictEqual(Location.is(result), true)
    uriEqual(result.uri, uri)
    rangeEqual(result.range, 0, 0, 0, 1)
    let middlewareCalled = false
    middleware.provideDefinition = (document, position, token, next) => {
      middlewareCalled = true
      return next(document, position, token)
    }
    await provider.provideDefinition(document, position, tokenSource.token)
    middleware.provideDefinition = undefined
    assert.strictEqual(middlewareCalled, true)
  })

  test('Hover', async () => {
    const provider = client.getFeature(HoverRequest.method).getProvider(document)
    isDefined(provider)
    const result = await provider.provideHover(document, position, tokenSource.token)
    assert.ok(Hover.is(result))
    assert.strictEqual((result.contents as any).kind, 'plaintext')
    assert.strictEqual((result.contents as any).value, 'foo')
    let middlewareCalled = false
    middleware.provideHover = (document, position, token, next) => {
      middlewareCalled = true
      return next(document, position, token)
    }
    await provider.provideHover(document, position, tokenSource.token)
    middleware.provideHover = undefined
    assert.strictEqual(middlewareCalled, true)
  })

  test('Completion', async () => {
    const provider = client.getFeature(CompletionRequest.method).getProvider(document)
    isDefined(provider)
    const result = (await provider.provideCompletionItems(document, position, tokenSource.token, { triggerKind: CompletionTriggerKind.Invoked, triggerCharacter: ':' })) as CompletionItem[]

    isArray(result, CompletionItem)
    const item = result[0]
    assert.strictEqual(item.label, 'item')
    assert.strictEqual(item.insertText, 'text')
    assert.strictEqual(item.detail, undefined)
    isDefined(provider.resolveCompletionItem)

    const resolved = await provider.resolveCompletionItem(item, tokenSource.token)
    isDefined(resolved)
    assert.strictEqual(resolved.detail, 'detail')

    let middlewareCalled = 0
    middleware.provideCompletionItem = (document, position, context, token, next) => {
      middlewareCalled++
      return next(document, position, context, token)
    }
    middleware.resolveCompletionItem = (item, token, next) => {
      middlewareCalled++
      return next(item, token)
    }
    await provider.provideCompletionItems(document, position, tokenSource.token, { triggerKind: CompletionTriggerKind.Invoked, triggerCharacter: ':' })
    await provider.resolveCompletionItem(item, tokenSource.token)
    middleware.provideCompletionItem = undefined
    middleware.resolveCompletionItem = undefined
    assert.strictEqual(middlewareCalled, 2)
  })

  test('SignatureHelpRequest', async () => {
    await helper.wait(50)
    let provider = client.getFeature(SignatureHelpRequest.method).getProvider(document)
    isDefined(provider)
    const result = await provider.provideSignatureHelp(document, position, tokenSource.token,
      {
        isRetrigger: false,
        triggerKind: SignatureHelpTriggerKind.Invoked,
        triggerCharacter: ':'
      }
    )

    assert.strictEqual(result.activeSignature, 1)
    assert.strictEqual(result.activeParameter, 1)
    isArray(result.signatures, SignatureInformation)

    const signature = result.signatures[0]
    assert.strictEqual(signature.label, 'label')
    assert.strictEqual(signature.documentation, 'doc')
    isArray(signature.parameters, ParameterInformation)

    const parameter = signature.parameters[0]
    assert.strictEqual(parameter.label, 'label')
    assert.strictEqual(parameter.documentation, 'doc')

    let middlewareCalled = false
    middleware.provideSignatureHelp = (d, p, c, t, n) => {
      middlewareCalled = true
      return n(d, p, c, t)
    }
    await provider.provideSignatureHelp(document, position, tokenSource.token,
      {
        isRetrigger: false,
        triggerKind: SignatureHelpTriggerKind.Invoked,
        triggerCharacter: ':'
      }
    )
    middleware.provideSignatureHelp = undefined
    assert.ok(middlewareCalled)
  })

  test('References', async () => {
    const provider = client.getFeature(ReferencesRequest.method).getProvider(document)
    isDefined(provider)
    const result = await provider.provideReferences(document, position, {
      includeDeclaration: true
    }, tokenSource.token)

    isArray(result, Location, 2)
    for (let i = 0; i < result.length; i++) {
      const location = result[i]
      rangeEqual(location.range, i, i, i, i)
      assert.strictEqual(location.uri.toString(), document.uri.toString())
    }

    let middlewareCalled = false
    middleware.provideReferences = (d, p, c, t, n) => {
      middlewareCalled = true
      return n(d, p, c, t)
    }
    await provider.provideReferences(document, position, {
      includeDeclaration: true
    }, tokenSource.token)
    middleware.provideReferences = undefined
    assert.ok(middlewareCalled)
  })

  test('Document Highlight', async () => {
    const provider = client.getFeature(DocumentHighlightRequest.method).getProvider(document)
    isDefined(provider)
    const result = await provider.provideDocumentHighlights(document, position, tokenSource.token)

    isArray(result, DocumentHighlight, 1)

    const highlight = result[0]
    assert.strictEqual(highlight.kind, DocumentHighlightKind.Read)
    rangeEqual(highlight.range, 2, 2, 2, 2)

    let middlewareCalled = false
    middleware.provideDocumentHighlights = (d, p, t, n) => {
      middlewareCalled = true
      return n(d, p, t)
    }
    await provider.provideDocumentHighlights(document, position, tokenSource.token)
    middleware.provideDocumentHighlights = undefined
    assert.ok(middlewareCalled)
  })

  test('Code Actions', async () => {
    const provider = client.getFeature(CodeActionRequest.method).getProvider(document)
    isDefined(provider)
    const result = (await provider.provideCodeActions(document, range, {
      diagnostics: []
    }, tokenSource.token)) as CodeAction[]

    isArray(result, CodeAction)
    const action = result[0]
    assert.strictEqual(action.title, 'title')
    assert.strictEqual(action.command?.title, 'title')
    assert.strictEqual(action.command?.command, 'test_command')
    let response = await commands.execute(action.command)
    expect(response).toEqual({ success: true })

    const resolved = (await provider.resolveCodeAction(result[0], tokenSource.token))
    assert.strictEqual(resolved?.title, 'resolved')

    let middlewareCalled = false
    middleware.provideCodeActions = (d, r, c, t, n) => {
      middlewareCalled = true
      return n(d, r, c, t)
    }

    await provider.provideCodeActions(document, range, { diagnostics: [] }, tokenSource.token)
    middleware.provideCodeActions = undefined
    assert.ok(middlewareCalled)

    middlewareCalled = false
    middleware.resolveCodeAction = (c, t, n) => {
      middlewareCalled = true
      return n(c, t)
    }

    await provider.resolveCodeAction!(result[0], tokenSource.token)
    middleware.resolveCodeAction = undefined
    assert.ok(middlewareCalled)

    let uri = URI.parse('lsptests://localhost/empty.bat').toString()
    let textDocument = TextDocument.create(uri, 'bat', 1, '\n')
    let res = (await provider.provideCodeActions(textDocument, range, {
      diagnostics: []
    }, tokenSource.token)) as CodeAction[]
    expect(res).toBeUndefined()
  })

  test('CodeLens', async () => {
    let feature = client.getFeature(CodeLensRequest.method)
    let state = feature.getState()
    expect((state as any).registrations).toBe(true)
    expect((state as any).matches).toBe(true)
    let tokenSource = new CancellationTokenSource()
    let codeLens = await languages.getCodeLens(document, tokenSource.token)
    expect(codeLens.length).toBe(2)
    let resolved = await languages.resolveCodeLens(codeLens[0], tokenSource.token)
    expect(resolved.command).toBeDefined()
    let fireRefresh = false
    let provider = feature.getProvider(document)
    provider.onDidChangeCodeLensEmitter.event(() => {
      fireRefresh = true
    })
    await client.sendNotification('fireCodeLensRefresh')
    await helper.wait(50)
    expect(fireRefresh).toBe(true)
  })

  test('Progress', async () => {
    const progressToken = 'TEST-PROGRESS-TOKEN'
    const middlewareEvents: Array<WorkDoneProgressBegin | WorkDoneProgressReport | WorkDoneProgressEnd> = []
    let currentProgressResolver: (value: unknown) => void | undefined

    // Set up middleware that calls the current resolve function when it gets its 'end' progress event.
    middleware.handleWorkDoneProgress = (token: ProgressToken, params, next) => {
      if (token === progressToken) {
        middlewareEvents.push(params)
        if (params.kind === 'end') {
          setImmediate(currentProgressResolver)
        }
      }
      return next(token, params)
    }

    // Trigger multiple sample progress events.
    for (let i = 0; i < 2; i++) {
      await new Promise<unknown>((resolve, reject) => {
        currentProgressResolver = resolve
        void client.sendRequest(
          new ProtocolRequestType<any, null, never, any, any>('testing/sendSampleProgress'),
          {},
          tokenSource.token,
        ).catch(reject)
      })
    }

    middleware.handleWorkDoneProgress = undefined

    // Ensure all events were handled.
    assert.deepStrictEqual(
      middlewareEvents.map(p => p.kind),
      ['begin', 'report', 'end', 'begin', 'report', 'end'],
    )
    await client.sendRequest(
      new ProtocolRequestType<any, null, never, any, any>('testing/beginOnlyProgress'),
      {},
      tokenSource.token,
    )
  })

  test('Document Formatting', async () => {
    const provider = client.getFeature(DocumentFormattingRequest.method).getProvider(document)
    isDefined(provider)
    const result = await provider.provideDocumentFormattingEdits(document, { tabSize: 4, insertSpaces: false }, tokenSource.token)

    isArray(result, TextEdit)
    const edit = result[0]
    assert.strictEqual(edit.newText, 'insert')
    rangeEqual(edit.range, 0, 0, 0, 0)

    let middlewareCalled = true
    middleware.provideDocumentFormattingEdits = (d, c, t, n) => {
      middlewareCalled = true
      return n(d, c, t)
    }
    await provider.provideDocumentFormattingEdits(document, { tabSize: 4, insertSpaces: false }, tokenSource.token)
    middleware.provideDocumentFormattingEdits = undefined
    assert.ok(middlewareCalled)
  })

  test('Document Range Formatting', async () => {
    const provider = client.getFeature(DocumentRangeFormattingRequest.method).getProvider(document)
    isDefined(provider)
    const result = await provider.provideDocumentRangeFormattingEdits(document, range, { tabSize: 4, insertSpaces: false }, tokenSource.token)

    isArray(result, TextEdit)
    const edit = result[0]
    assert.strictEqual(edit.newText, '')
    rangeEqual(edit.range, 1, 1, 1, 2)

    let middlewareCalled = true
    middleware.provideDocumentRangeFormattingEdits = (d, r, c, t, n) => {
      middlewareCalled = true
      return n(d, r, c, t)
    }
    await provider.provideDocumentRangeFormattingEdits(document, range, { tabSize: 4, insertSpaces: false }, tokenSource.token)
    middleware.provideDocumentFormattingEdits = undefined
    assert.ok(middlewareCalled)
  })

  test('Document on Type Formatting', async () => {
    const provider = client.getFeature(DocumentOnTypeFormattingRequest.method).getProvider(document)
    isDefined(provider)
    const result = await provider.provideOnTypeFormattingEdits(document, position, 'a', { tabSize: 4, insertSpaces: false }, tokenSource.token)

    isArray(result, TextEdit)
    const edit = result[0]
    assert.strictEqual(edit.newText, 'replace')
    rangeEqual(edit.range, 2, 2, 2, 3)

    let middlewareCalled = true
    middleware.provideOnTypeFormattingEdits = (d, p, s, c, t, n) => {
      middlewareCalled = true
      return n(d, p, s, c, t)
    }
    await provider.provideOnTypeFormattingEdits(document, position, 'a', { tabSize: 4, insertSpaces: false }, tokenSource.token)
    middleware.provideDocumentFormattingEdits = undefined
    assert.ok(middlewareCalled)
  })

  test('Rename', async () => {
    const provider = client.getFeature(RenameRequest.method).getProvider(document)
    isDefined(provider)
    isDefined(provider.prepareRename)
    const prepareResult = await provider.prepareRename(document, position, tokenSource.token) as Range

    rangeEqual(prepareResult, 1, 1, 1, 2)
    const renameResult = await provider.provideRenameEdits(document, position, 'newName', tokenSource.token)
    assert.ok(WorkspaceEdit.is(renameResult))
    let middlewareCalled = 0
    middleware.prepareRename = (d, p, t, n) => {
      middlewareCalled++
      return n(d, p, t)
    }
    await provider.prepareRename(document, position, tokenSource.token)
    middleware.prepareRename = undefined
    middleware.provideRenameEdits = (d, p, w, t, n) => {
      middlewareCalled++
      return n(d, p, w, t)
    }
    await provider.provideRenameEdits(document, position, 'newName', tokenSource.token)
    middleware.provideRenameEdits = undefined
    assert.strictEqual(middlewareCalled, 2)
  })

  test('Document Link', async () => {
    const provider = client.getFeature(DocumentLinkRequest.method).getProvider(document)
    isDefined(provider)
    const result = await provider.provideDocumentLinks(document, tokenSource.token)

    isArray(result, DocumentLink)
    const documentLink = result[0]
    rangeEqual(documentLink.range, 1, 1, 1, 2)

    let middlewareCalled = 0
    middleware.provideDocumentLinks = (d, t, n) => {
      middlewareCalled++
      return n(d, t)
    }
    await provider.provideDocumentLinks(document, tokenSource.token)
    middleware.provideDocumentLinks = undefined

    isDefined(provider.resolveDocumentLink)
    const resolved = await provider.resolveDocumentLink(documentLink, tokenSource.token)
    isDefined(resolved.target)
    assert.strictEqual(resolved.target.toString(), URI.file('/target.txt').toString())

    middleware.resolveDocumentLink = (i, t, n) => {
      middlewareCalled++
      return n(i, t)
    }
    await provider.resolveDocumentLink(documentLink, tokenSource.token)
    middleware.resolveDocumentLink = undefined
    assert.strictEqual(middlewareCalled, 2)
  })

  test('Document Color', async () => {
    const provider = client.getFeature(DocumentColorRequest.method).getProvider(document)
    isDefined(provider)
    const colors = await provider.provideDocumentColors(document, tokenSource.token)

    isArray(colors, ColorInformation)
    const color = colors[0]

    rangeEqual(color.range, 1, 1, 1, 2)
    colorEqual(color.color, 1, 1, 1, 1)

    let middlewareCalled = 0
    middleware.provideDocumentColors = (d, t, n) => {
      middlewareCalled++
      return n(d, t)
    }
    await provider.provideDocumentColors(document, tokenSource.token)
    middleware.provideDocumentColors = undefined

    const presentations = await provider.provideColorPresentations(color.color, { document, range }, tokenSource.token)

    isArray(presentations, ColorPresentation)
    const presentation = presentations[0]
    assert.strictEqual(presentation.label, 'label')

    middleware.provideColorPresentations = (c, x, t, n) => {
      middlewareCalled++
      return n(c, x, t)
    }
    await provider.provideColorPresentations(color.color, { document, range }, tokenSource.token)
    middleware.provideColorPresentations = undefined
    assert.strictEqual(middlewareCalled, 2)
  })

  test('Goto Declaration', async () => {
    const provider = client.getFeature(DeclarationRequest.method).getProvider(document)
    isDefined(provider)
    const result = (await provider.provideDeclaration(document, position, tokenSource.token)) as Location

    uriEqual(result.uri, uri)
    rangeEqual(result.range, 1, 1, 1, 2)

    let middlewareCalled = false
    middleware.provideDeclaration = (document, position, token, next) => {
      middlewareCalled = true
      return next(document, position, token)
    }
    await provider.provideDeclaration(document, position, tokenSource.token)
    middleware.provideDeclaration = undefined
    assert.strictEqual(middlewareCalled, true)
  })

  test('Folding Ranges', async () => {
    const provider = client.getFeature(FoldingRangeRequest.method).getProvider(document)
    isDefined(provider)
    const result = (await provider.provideFoldingRanges(document, {}, tokenSource.token))

    isArray(result, FoldingRange, 1)
    const range = result[0]
    assert.strictEqual(range.startLine, 1)
    assert.strictEqual(range.endLine, 2)
    let middlewareCalled = true
    middleware.provideFoldingRanges = (d, c, t, n) => {
      middlewareCalled = true
      return n(d, c, t)
    }
    await provider.provideFoldingRanges(document, {}, tokenSource.token)
    middleware.provideFoldingRanges = undefined
    assert.ok(middlewareCalled)
  })

  test('Goto Implementation', async () => {
    const provider = client.getFeature(ImplementationRequest.method).getProvider(document)
    isDefined(provider)
    const result = (await provider.provideImplementation(document, position, tokenSource.token)) as Location

    uriEqual(result.uri, uri)
    rangeEqual(result.range, 2, 2, 3, 3)

    let middlewareCalled = false
    middleware.provideImplementation = (document, position, token, next) => {
      middlewareCalled = true
      return next(document, position, token)
    }
    await provider.provideImplementation(document, position, tokenSource.token)
    middleware.provideImplementation = undefined
    assert.strictEqual(middlewareCalled, true)
  })

  test('Selection Range', async () => {
    const provider = client.getFeature(SelectionRangeRequest.method).getProvider(document)
    isDefined(provider)
    const result = (await provider.provideSelectionRanges(document, [position], tokenSource.token))

    isArray(result, SelectionRange, 1)
    const range = result[0]
    rangeEqual(range.range, 1, 2, 3, 4)
    let middlewareCalled = false
    middleware.provideSelectionRanges = (d, p, t, n) => {
      middlewareCalled = true
      return n(d, p, t)
    }
    await provider.provideSelectionRanges(document, [position], tokenSource.token)
    middleware.provideSelectionRanges = undefined
    assert.strictEqual(middlewareCalled, true)
  })

  test('Type Definition', async () => {
    const provider = client.getFeature(TypeDefinitionRequest.method).getProvider(document)
    isDefined(provider)
    const result = (await provider.provideTypeDefinition(document, position, tokenSource.token)) as Location

    uriEqual(result.uri, uri)
    rangeEqual(result.range, 2, 2, 3, 3)

    let middlewareCalled = false
    middleware.provideTypeDefinition = (document, position, token, next) => {
      middlewareCalled = true
      return next(document, position, token)
    }
    await provider.provideTypeDefinition(document, position, tokenSource.token)
    middleware.provideTypeDefinition = undefined
    assert.strictEqual(middlewareCalled, true)
  })

  test('Call Hierarchy', async () => {
    const provider = client.getFeature(CallHierarchyPrepareRequest.method).getProvider(document)
    isDefined(provider)
    const result = (await provider.prepareCallHierarchy(document, position, tokenSource.token)) as CallHierarchyItem[]
    expect(result.length).toBe(1)

    let middlewareCalled = false
    middleware.prepareCallHierarchy = (d, p, t, n) => {
      middlewareCalled = true
      return n(d, p, t)
    }
    await provider.prepareCallHierarchy(document, position, tokenSource.token)
    middleware.prepareCallHierarchy = undefined
    assert.strictEqual(middlewareCalled, true)

    const item = result[0]
    const incoming = (await provider.provideCallHierarchyIncomingCalls(item, tokenSource.token)) as CallHierarchyIncomingCall[]
    expect(incoming.length).toBe(1)
    assert.deepEqual(incoming[0].from, item)
    middlewareCalled = false
    middleware.provideCallHierarchyIncomingCalls = (i, t, n) => {
      middlewareCalled = true
      return n(i, t)
    }
    await provider.provideCallHierarchyIncomingCalls(item, tokenSource.token)
    middleware.provideCallHierarchyIncomingCalls = undefined
    assert.strictEqual(middlewareCalled, true)

    const outgoing = (await provider.provideCallHierarchyOutgoingCalls(item, tokenSource.token)) as CallHierarchyOutgoingCall[]
    expect(outgoing.length).toBe(1)
    assert.deepEqual(outgoing[0].to, item)
    middlewareCalled = false
    middleware.provideCallHierarchyOutgoingCalls = (i, t, n) => {
      middlewareCalled = true
      return n(i, t)
    }
    await provider.provideCallHierarchyOutgoingCalls(item, tokenSource.token)
    middleware.provideCallHierarchyOutgoingCalls = undefined
    assert.strictEqual(middlewareCalled, true)
  })

  const referenceFileUri = URI.parse('/dummy-edit')
  function ensureReferenceEdit(edits: WorkspaceEdit, type: string, expectedLines: string[]) {
    // // Ensure the edits are as expected.
    assert.strictEqual(edits.documentChanges?.length, 1)
    const edit = edits.documentChanges[0] as TextDocumentEdit
    assert.strictEqual(edit.edits.length, 1)
    assert.strictEqual(edit.textDocument.uri, referenceFileUri.path)
    assert.strictEqual(edit.edits[0].newText.trim(), `${type}:\n${expectedLines.join('\n')}`.trim())
  }
  async function ensureNotificationReceived(type: string, params: any) {
    const result = await client.sendRequest(
      new ProtocolRequestType<any, any, never, any, any>('testing/lastFileOperationRequest'),
      {},
      tokenSource.token,
    )
    assert.strictEqual(result.type, type)
    assert.deepEqual(result.params, params)
    assert.deepEqual(result, {
      type,
      params
    })
  }

  const createFiles = [
    '/my/file.txt',
    '/my/file.js',
    '/my/folder/',
    // Static registration for tests is [operation]-static and *.txt
    '/my/created-static/file.txt',
    '/my/created-static/file.js',
    '/my/created-static/folder/',
    // Dynamic registration for tests is [operation]-dynamic and *.js
    '/my/created-dynamic/file.txt',
    '/my/created-dynamic/file.js',
    '/my/created-dynamic/folder/',
  ].map(p => URI.file(p))

  const renameFiles = [
    ['/my/file.txt', '/my-new/file.txt'],
    ['/my/file.js', '/my-new/file.js'],
    ['/my/folder/', '/my-new/folder/'],
    // Static registration for tests is [operation]-static and *.txt
    ['/my/renamed-static/file.txt', '/my-new/renamed-static/file.txt'],
    ['/my/renamed-static/file.js', '/my-new/renamed-static/file.js'],
    ['/my/renamed-static/folder/', '/my-new/renamed-static/folder/'],
    // Dynamic registration for tests is [operation]-dynamic and *.js
    ['/my/renamed-dynamic/file.txt', '/my-new/renamed-dynamic/file.txt'],
    ['/my/renamed-dynamic/file.js', '/my-new/renamed-dynamic/file.js'],
    ['/my/renamed-dynamic/folder/', '/my-new/renamed-dynamic/folder/'],
  ].map(([o, n]) => ({ oldUri: URI.file(o), newUri: URI.file(n) }))

  const deleteFiles = [
    '/my/file.txt',
    '/my/file.js',
    '/my/folder/',
    // Static registration for tests is [operation]-static and *.txt
    '/my/deleted-static/file.txt',
    '/my/deleted-static/file.js',
    '/my/deleted-static/folder/',
    // Dynamic registration for tests is [operation]-dynamic and *.js
    '/my/deleted-dynamic/file.txt',
    '/my/deleted-dynamic/file.js',
    '/my/deleted-dynamic/folder/',
  ].map(p => URI.file(p))

  test('File Operations - Will Create Files', async () => {
    const feature = client.getFeature(WillCreateFilesRequest.method)
    isDefined(feature)

    const sendCreateRequest = () => new Promise<WorkspaceEdit>(async (resolve, reject) => {
      void feature.send({ token: CancellationToken.None, files: createFiles, waitUntil: resolve })
      // If feature.send didn't call waitUntil synchronously then something went wrong.
      reject(new Error('Feature unexpectedly did not call waitUntil synchronously'))
    })

    // Send the event and ensure the server responds with an edit referencing the
    // correct files.
    let edits = await sendCreateRequest()
    ensureReferenceEdit(
      edits,
      'WILL CREATE',
      [
        'file:///my/created-static/file.txt',
        'file:///my/created-static/folder/',
        'file:///my/created-dynamic/file.js',
        'file:///my/created-dynamic/folder/',
      ],
    )

    // Add middleware that strips out any folders.
    middleware.workspace = middleware.workspace || {}
    middleware.workspace.willCreateFiles = (event, next) => next({
      ...event,
      files: event.files.filter(f => !f.path.endsWith('/')),
    })

    // Ensure we get the same results minus the folders that the middleware removed.
    edits = await sendCreateRequest()
    ensureReferenceEdit(
      edits,
      'WILL CREATE',
      [
        'file:///my/created-static/file.txt',
        'file:///my/created-dynamic/file.js',
      ],
    )

    middleware.workspace.willCreateFiles = undefined
  })

  test('File Operations - Did Create Files', async () => {
    const feature = client.getFeature(DidCreateFilesNotification.method)
    isDefined(feature)

    // Send the event and ensure the server reports the notification was sent.
    await feature.send({ files: createFiles })
    await ensureNotificationReceived(
      'create',
      {
        files: [
          { uri: 'file:///my/created-static/file.txt' },
          { uri: 'file:///my/created-static/folder/' },
          { uri: 'file:///my/created-dynamic/file.js' },
          { uri: 'file:///my/created-dynamic/folder/' },
        ],
      },
    )

    // Add middleware that strips out any folders.
    middleware.workspace = middleware.workspace || {}
    middleware.workspace.didCreateFiles = (event, next) => next({
      files: event.files.filter(f => !f.path.endsWith('/')),
    })

    // Ensure we get the same results minus the folders that the middleware removed.
    await feature.send({ files: createFiles })
    await ensureNotificationReceived(
      'create',
      {
        files: [
          { uri: 'file:///my/created-static/file.txt' },
          { uri: 'file:///my/created-dynamic/file.js' },
        ],
      },
    )

    middleware.workspace.didCreateFiles = undefined
  })

  test('File Operations - Will Rename Files', async () => {
    const feature = client.getFeature(WillRenameFilesRequest.method)
    isDefined(feature)

    const sendRenameRequest = () => new Promise<WorkspaceEdit>(async (resolve, reject) => {
      void feature.send({ files: renameFiles, waitUntil: resolve })
      // If feature.send didn't call waitUntil synchronously then something went wrong.
      reject(new Error('Feature unexpectedly did not call waitUntil synchronously'))
    })

    // Send the event and ensure the server responds with an edit referencing the
    // correct files.
    let edits = await sendRenameRequest()
    ensureReferenceEdit(
      edits,
      'WILL RENAME',
      [
        'file:///my/renamed-static/file.txt -> file:///my-new/renamed-static/file.txt',
        'file:///my/renamed-static/folder/ -> file:///my-new/renamed-static/folder/',
        'file:///my/renamed-dynamic/file.js -> file:///my-new/renamed-dynamic/file.js',
        'file:///my/renamed-dynamic/folder/ -> file:///my-new/renamed-dynamic/folder/',
      ],
    )

    // Add middleware that strips out any folders.
    middleware.workspace = middleware.workspace || {}
    middleware.workspace.willRenameFiles = (event, next) => next({
      ...event,
      files: event.files.filter(f => !f.oldUri.path.endsWith('/')),
    })

    // Ensure we get the same results minus the folders that the middleware removed.
    edits = await sendRenameRequest()
    ensureReferenceEdit(
      edits,
      'WILL RENAME',
      [
        'file:///my/renamed-static/file.txt -> file:///my-new/renamed-static/file.txt',
        'file:///my/renamed-dynamic/file.js -> file:///my-new/renamed-dynamic/file.js',
      ],
    )

    middleware.workspace.willRenameFiles = undefined
  })

  test('File Operations - Did Rename Files', async () => {
    const feature = client.getFeature(DidRenameFilesNotification.method)
    isDefined(feature)

    // Send the event and ensure the server reports the notification was sent.
    await feature.send({ files: renameFiles })
    await ensureNotificationReceived(
      'rename',
      {
        files: [
          { oldUri: 'file:///my/renamed-static/file.txt', newUri: 'file:///my-new/renamed-static/file.txt' },
          { oldUri: 'file:///my/renamed-static/folder/', newUri: 'file:///my-new/renamed-static/folder/' },
          { oldUri: 'file:///my/renamed-dynamic/file.js', newUri: 'file:///my-new/renamed-dynamic/file.js' },
          { oldUri: 'file:///my/renamed-dynamic/folder/', newUri: 'file:///my-new/renamed-dynamic/folder/' },
        ],
      },
    )

    // Add middleware that strips out any folders.
    middleware.workspace = middleware.workspace || {}
    middleware.workspace.didRenameFiles = (event, next) => next({
      files: event.files.filter(f => !f.oldUri.path.endsWith('/')),
    })

    // Ensure we get the same results minus the folders that the middleware removed.
    await feature.send({ files: renameFiles })
    await ensureNotificationReceived(
      'rename',
      {
        files: [
          { oldUri: 'file:///my/renamed-static/file.txt', newUri: 'file:///my-new/renamed-static/file.txt' },
          { oldUri: 'file:///my/renamed-dynamic/file.js', newUri: 'file:///my-new/renamed-dynamic/file.js' },
        ],
      },
    )

    middleware.workspace.didRenameFiles = undefined
  })

  test('File Operations - Will Delete Files', async () => {
    const feature = client.getFeature(WillDeleteFilesRequest.method)
    isDefined(feature)

    const sendDeleteRequest = () => new Promise<WorkspaceEdit>(async (resolve, reject) => {
      void feature.send({ files: deleteFiles, waitUntil: resolve })
      // If feature.send didn't call waitUntil synchronously then something went wrong.
      reject(new Error('Feature unexpectedly did not call waitUntil synchronously'))
    })

    // Send the event and ensure the server responds with an edit referencing the
    // correct files.
    let edits = await sendDeleteRequest()
    ensureReferenceEdit(
      edits,
      'WILL DELETE',
      [
        'file:///my/deleted-static/file.txt',
        'file:///my/deleted-static/folder/',
        'file:///my/deleted-dynamic/file.js',
        'file:///my/deleted-dynamic/folder/',
      ],
    )

    // Add middleware that strips out any folders.
    middleware.workspace = middleware.workspace || {}
    middleware.workspace.willDeleteFiles = (event, next) => next({
      ...event,
      files: event.files.filter(f => !f.path.endsWith('/')),
    })

    // Ensure we get the same results minus the folders that the middleware removed.
    edits = await sendDeleteRequest()
    ensureReferenceEdit(
      edits,
      'WILL DELETE',
      [
        'file:///my/deleted-static/file.txt',
        'file:///my/deleted-dynamic/file.js',
      ],
    )

    middleware.workspace.willDeleteFiles = undefined
  })

  test('File Operations - Did Delete Files', async () => {
    const feature = client.getFeature(DidDeleteFilesNotification.method)
    isDefined(feature)

    // Send the event and ensure the server reports the notification was sent.
    await feature.send({ files: deleteFiles })
    await ensureNotificationReceived(
      'delete',
      {
        files: [
          { uri: 'file:///my/deleted-static/file.txt' },
          { uri: 'file:///my/deleted-static/folder/' },
          { uri: 'file:///my/deleted-dynamic/file.js' },
          { uri: 'file:///my/deleted-dynamic/folder/' },
        ],
      },
    )

    // Add middleware that strips out any folders.
    middleware.workspace = middleware.workspace || {}
    middleware.workspace.didDeleteFiles = (event, next) => next({
      files: event.files.filter(f => !f.path.endsWith('/')),
    })

    // Ensure we get the same results minus the folders that the middleware removed.
    await feature.send({ files: deleteFiles })
    await ensureNotificationReceived(
      'delete',
      {
        files: [
          { uri: 'file:///my/deleted-static/file.txt' },
          { uri: 'file:///my/deleted-dynamic/file.js' },
        ],
      },
    )

    middleware.workspace.didDeleteFiles = undefined
  })

  test('Semantic Tokens', async () => {
    const provider = client.getFeature(SemanticTokensRegistrationType.method).getProvider(document)
    const rangeProvider = provider?.range
    isDefined(rangeProvider)
    const rangeResult = await rangeProvider.provideDocumentRangeSemanticTokens(document, range, tokenSource.token)
    assert.ok(rangeResult !== undefined)

    let middlewareCalled = false
    middleware.provideDocumentRangeSemanticTokens = (d, r, t, n) => {
      middlewareCalled = true
      return n(d, r, t)
    }
    await rangeProvider.provideDocumentRangeSemanticTokens(document, range, tokenSource.token)
    middleware.provideDocumentRangeSemanticTokens = undefined
    assert.strictEqual(middlewareCalled, true)

    const fullProvider = provider?.full
    isDefined(fullProvider)
    const fullResult = await fullProvider.provideDocumentSemanticTokens(document, tokenSource.token)
    assert.ok(fullResult !== undefined)

    middlewareCalled = false
    middleware.provideDocumentSemanticTokens = (d, t, n) => {
      middlewareCalled = true
      return n(d, t)
    }
    await fullProvider.provideDocumentSemanticTokens(document, tokenSource.token)
    middleware.provideDocumentSemanticTokens = undefined
    assert.strictEqual(middlewareCalled, true)

    middlewareCalled = false
    middleware.provideDocumentSemanticTokensEdits = (d, i, t, n) => {
      middlewareCalled = true
      return n(d, i, t)
    }
    await fullProvider.provideDocumentSemanticTokensEdits!(document, '2', tokenSource.token)
    middleware.provideDocumentSemanticTokensEdits = undefined
    assert.strictEqual(middlewareCalled, true)
    let called = false
    provider.onDidChangeSemanticTokensEmitter.event(() => {
      called = true
    })
    await client.sendNotification('fireSemanticTokensRefresh')
    await helper.waitValue(() => {
      return called
    }, true)
  })

  test('Linked Editing Ranges', async () => {
    const provider = client.getFeature(LinkedEditingRangeRequest.method).getProvider(document)
    isDefined(provider)
    const result = await provider.provideLinkedEditingRanges(document, position, tokenSource.token)

    isArray(result.ranges, Range, 1)
    rangeEqual(result.ranges[0], 1, 1, 1, 1)

    let middlewareCalled = false
    middleware.provideLinkedEditingRange = (document, position, token, next) => {
      middlewareCalled = true
      return next(document, position, token)
    }
    await provider.provideLinkedEditingRanges(document, position, tokenSource.token)
    middleware.provideTypeDefinition = undefined
    assert.strictEqual(middlewareCalled, true)
  })

  test('Document diagnostic pull', async () => {
    const provider = client.getFeature(DocumentDiagnosticRequest.method)?.getProvider(document)
    isDefined(provider)
    const result = await provider.diagnostics.provideDiagnostics(document, undefined, tokenSource.token)
    isDefined(result)
    isFullDocumentDiagnosticReport(result)

    const diag = result.items[0]
    rangeEqual(diag.range, 1, 1, 1, 1)
    assert.strictEqual(diag.message, 'diagnostic')

    let middlewareCalled = false
    middleware.provideDiagnostics = (document, previousResultId, token, next) => {
      middlewareCalled = true
      return next(document, previousResultId, token)
    }
    await provider.diagnostics.provideDiagnostics(document, undefined, tokenSource.token)
    middleware.provideDiagnostics = undefined
    assert.strictEqual(middlewareCalled, true)
  })

  test('Workspace diagnostic pull', async () => {
    const provider = client.getFeature(DocumentDiagnosticRequest.method)?.getProvider(document)
    isDefined(provider)
    isDefined(provider.diagnostics.provideWorkspaceDiagnostics)
    await provider.diagnostics.provideWorkspaceDiagnostics([], tokenSource.token, result => {
      isDefined(result)
      isArray(result.items, undefined, 1)
    })

    let middlewareCalled = false
    middleware.provideWorkspaceDiagnostics = (resultIds, token, reporter, next) => {
      middlewareCalled = true
      return next(resultIds, token, reporter)
    }
    await provider.diagnostics.provideWorkspaceDiagnostics([], tokenSource.token, () => {})
    middleware.provideWorkspaceDiagnostics = undefined
    assert.strictEqual(middlewareCalled, true)
  })

  test('Type Hierarchy', async () => {
    const provider = client.getFeature(TypeHierarchyPrepareRequest.method).getProvider(document)
    isDefined(provider)
    const result = await provider.prepareTypeHierarchy(document, position, tokenSource.token)

    isArray(result, undefined, 1)
    const item = result[0]

    let middlewareCalled = false
    middleware.prepareTypeHierarchy = (d, p, t, n) => {
      middlewareCalled = true
      return n(d, p, t)
    }
    await provider.prepareTypeHierarchy(document, position, tokenSource.token)
    middleware.prepareTypeHierarchy = undefined
    assert.strictEqual(middlewareCalled, true)

    const incoming = await provider.provideTypeHierarchySupertypes(item, tokenSource.token)
    isArray(incoming, undefined, 1)
    middlewareCalled = false
    middleware.provideTypeHierarchySupertypes = (i, t, n) => {
      middlewareCalled = true
      return n(i, t)
    }
    await provider.provideTypeHierarchySupertypes(item, tokenSource.token)
    middleware.provideTypeHierarchySupertypes = undefined
    assert.strictEqual(middlewareCalled, true)

    const outgoing = await provider.provideTypeHierarchySubtypes(item, tokenSource.token)
    isArray(outgoing, undefined, 1)
    middlewareCalled = false
    middleware.provideTypeHierarchySubtypes = (i, t, n) => {
      middlewareCalled = true
      return n(i, t)
    }
    await provider.provideTypeHierarchySubtypes(item, tokenSource.token)
    middleware.provideTypeHierarchySubtypes = undefined
    assert.strictEqual(middlewareCalled, true)
  })

  test('Inline Values', async () => {
    const providerData = client.getFeature(InlineValueRequest.method).getProvider(document)
    isDefined(providerData)
    const provider = providerData.provider
    const results = (await provider.provideInlineValues(document, range, { frameId: 1, stoppedLocation: range }, tokenSource.token))

    isArray(results, undefined, 3)

    for (const r of results) {
      rangeEqual(r.range, 1, 2, 3, 4)
    }

    // assert.ok(results[0] instanceof InlineValueText)
    assert.strictEqual((results[0] as InlineValueText).text, 'text')

    // assert.ok(results[1] instanceof InlineValueVariableLookup)
    assert.strictEqual((results[1] as InlineValueVariableLookup).variableName, 'variableName')

    // assert.ok(results[2] instanceof InlineValueEvaluatableExpression)
    assert.strictEqual((results[2] as InlineValueEvaluatableExpression).expression, 'expression')

    let middlewareCalled = false
    middleware.provideInlineValues = (d, r, c, t, n) => {
      middlewareCalled = true
      return n(d, r, c, t)
    }
    await provider.provideInlineValues(document, range, { frameId: 1, stoppedLocation: range }, tokenSource.token)
    middleware.provideInlineValues = undefined
    assert.strictEqual(middlewareCalled, true)
  })

  test('Inlay Hints', async () => {
    const providerData = client.getFeature(InlayHintRequest.method).getProvider(document)
    isDefined(providerData)
    const provider = providerData.provider
    const results = (await provider.provideInlayHints(document, range, tokenSource.token))

    isArray(results, undefined, 2)

    const hint = results[0]
    positionEqual(hint.position, 1, 1)
    assert.strictEqual(hint.kind, InlayHintKind.Type)
    const label = hint.label
    isArray(label as [], InlayHintLabelPart, 1)
    assert.strictEqual((label as InlayHintLabelPart[])[0].value, 'type')

    let middlewareCalled = false
    middleware.provideInlayHints = (d, r, t, n) => {
      middlewareCalled = true
      return n(d, r, t)
    }
    await provider.provideInlayHints(document, range, tokenSource.token)
    middleware.provideInlayHints = undefined
    assert.strictEqual(middlewareCalled, true)
    assert.ok(typeof provider.resolveInlayHint === 'function')

    const resolvedHint = await provider.resolveInlayHint!(hint, tokenSource.token)
    assert.strictEqual((resolvedHint?.label as InlayHintLabelPart[])[0].tooltip, 'tooltip')
    let called = false
    await client.sendNotification('fireInlayHintsRefresh')
    provider.onDidChangeInlayHints(() => {
      called = true
    })
    await helper.waitValue(() => {
      return called
    }, true)
  })

  test('Workspace symbols', async () => {
    const providers = client.getFeature(WorkspaceSymbolRequest.method).getProviders()
    isDefined(providers)
    assert.strictEqual(providers.length, 2)
    const provider = providers[0]
    const results = await provider.provideWorkspaceSymbols('', tokenSource.token)
    isArray(results, undefined, 1)

    assert.strictEqual(results.length, 1)

    const symbol = await provider.resolveWorkspaceSymbol!(results[0], tokenSource.token)
    isDefined(symbol)
    rangeEqual(symbol.location.range, 1, 2, 3, 4)
  })
})

namespace CrashNotification {
  export const type = new NotificationType0('test/crash')
}

class CrashClient extends LanguageClient {

  private resolve: (() => void) | undefined
  public onCrash: Promise<void>

  constructor(id: string, name: string, serverOptions: ServerOptions, clientOptions: LanguageClientOptions) {
    super(id, name, serverOptions, clientOptions)
    this.onCrash = new Promise(resolve => {
      this.resolve = resolve
    })
  }

  protected handleConnectionClosed(): void {
    super.handleConnectionClosed()
    this.resolve!()
  }
}

describe('sever tests', () => {
  test('Stop fails if server crashes after shutdown request', async () => {
    let file = path.join(__dirname, './server/crashOnShutdownServer.js')
    const serverOptions: ServerOptions = {
      module: file,
      transport: TransportKind.ipc,
    }
    const clientOptions: LanguageClientOptions = {}
    const client = new LanguageClient('test svr', 'Test Language Server', serverOptions, clientOptions)
    await client._start()

    await assert.rejects(async () => {
      await client.stop()
    }, /Pending response rejected since connection got disposed/)
    assert.strictEqual(client.needsStart(), true)
    assert.strictEqual(client.needsStop(), false)

    // Stopping again should be a no-op.
    await client.stop()
    assert.strictEqual(client.needsStart(), true)
    assert.strictEqual(client.needsStop(), false)
  })

  test('Stop fails if server shutdown request times out', async () => {
    const serverOptions: ServerOptions = {
      module: path.join(__dirname, './server/timeoutOnShutdownServer.js'),
      transport: TransportKind.ipc,
    }
    const clientOptions: LanguageClientOptions = {}
    const client = new LanguageClient('test svr', 'Test Language Server', serverOptions, clientOptions)
    await client._start()

    await assert.rejects(async () => {
      await client.stop(100)
    }, /Stopping the server timed out/)
  })

  test('Server can not be stopped right after start', async () => {
    const serverOptions: ServerOptions = {
      module: path.join(__dirname, './server/startStopServer.js'),
      transport: TransportKind.ipc,
    }
    const clientOptions: LanguageClientOptions = {}
    const client = new LanguageClient('test svr', 'Test Language Server', serverOptions, clientOptions)
    void client.start()
    await assert.rejects(async () => {
      await client.stop()
    }, /Client is not running and can't be stopped/)

    await client._start()
    await client.stop()
  })

  test('Test state change events', async () => {
    const serverOptions: ServerOptions = {
      module: path.join(__dirname, './server/nullServer.js'),
      transport: TransportKind.ipc,
    }
    const clientOptions: LanguageClientOptions = {}
    const client = new LanguageClient('test svr', 'Test Language Server', serverOptions, clientOptions)
    let state: State | undefined
    client.onDidChangeState(event => {
      state = event.newState
    })
    await client._start()
    assert.strictEqual(state, State.Running, 'First start')

    await client.stop()
    assert.strictEqual(state, State.Stopped, 'First stop')

    await client._start()
    assert.strictEqual(state, State.Running, 'Second start')

    await client.stop()
    assert.strictEqual(state, State.Stopped, 'Second stop')
  })

  test('Test state change events on crash', async () => {
    const serverOptions: ServerOptions = {
      module: path.join(__dirname, './server/crashServer.js'),
      transport: TransportKind.ipc,
    }
    const clientOptions: LanguageClientOptions = {}
    const client = new CrashClient('test svr', 'Test Language Server', serverOptions, clientOptions)
    let states: State[] = []
    client.onDidChangeState(event => {
      states.push(event.newState)
    })
    await client._start()
    assert.strictEqual(states.length, 2, 'First start')
    assert.strictEqual(states[0], State.Starting)
    assert.strictEqual(states[1], State.Running)

    states = []
    await client.sendNotification(CrashNotification.type)
    await client.onCrash

    await client._start()
    assert.strictEqual(states.length, 3, 'Restart after crash')
    assert.strictEqual(states[0], State.Stopped)
    assert.strictEqual(states[1], State.Starting)
    assert.strictEqual(states[2], State.Running)

    states = []
    await client.stop()
    assert.strictEqual(states.length, 1, 'After stop')
    assert.strictEqual(states[0], State.Stopped)
  })
})

describe('Server activation', () => {

  const uri: URI = URI.parse('lsptests://localhost/test.bat')
  const documentSelector: DocumentSelector = [{ scheme: 'lsptests', language: '*' }]
  const position: Position = Position.create(1, 1)
  let contentProviderDisposable!: Disposable

  beforeAll(async () => {
    contentProviderDisposable = workspace.registerTextDocumentContentProvider('lsptests', {
      provideTextDocumentContent: (_uri: URI) => {
        return [
          'REM @ECHO OFF'
        ].join('\n')
      }
    })

  })

  afterAll(async () => {
    contentProviderDisposable.dispose()
  })

  function createClient(): LanguageClient {
    const serverModule = path.join(__dirname, './server/customServer.js')
    const serverOptions: ServerOptions = {
      run: { module: serverModule, transport: TransportKind.ipc },
      debug: { module: serverModule, transport: TransportKind.ipc, options: { execArgv: ['--nolazy', '--inspect=6014'] } }
    }

    const clientOptions: LanguageClientOptions = {
      documentSelector,
      synchronize: {},
      initializationOptions: {},
      middleware: {},
    };
    (clientOptions as ({ $testMode?: boolean })).$testMode = true

    const result = new LanguageClient('test svr', 'Test Language Server', serverOptions, clientOptions)
    result.registerProposedFeatures()
    return result
  }

  test('Start server on request', async () => {
    const client = createClient()
    assert.strictEqual(client.state, State.Stopped)
    const result: number = await client.sendRequest('request', { value: 10 })
    assert.strictEqual(client.state, State.Running)
    assert.strictEqual(result, 11)
    await client.stop()
  })

  test('Start server fails on request when stopped once', async () => {
    const client = createClient()
    assert.strictEqual(client.state, State.Stopped)
    const result: number = await client.sendRequest('request', { value: 10 })
    assert.strictEqual(client.state, State.Running)
    assert.strictEqual(result, 11)
    await client.stop()
    await assert.rejects(async () => {
      await client.sendRequest('request', { value: 10 })
    }, /Client is not running/)
  })

  test('Start server on notification', async () => {
    const client = createClient()
    assert.strictEqual(client.state, State.Stopped)
    await client.sendNotification('notification')
    assert.strictEqual(client.state, State.Running)
    await client.stop()
  })

  test('Start server fails on notification when stopped once', async () => {
    const client = createClient()
    assert.strictEqual(client.state, State.Stopped)
    await client.sendNotification('notification')
    assert.strictEqual(client.state, State.Running)
    await client.stop()
    await assert.rejects(async () => {
      await client.sendNotification('notification')
    }, /Client is not running/)
  })

  test('Add pending request handler', async () => {
    const client = createClient()
    assert.strictEqual(client.state, State.Stopped)
    let requestReceived = false
    client.onRequest('request', () => {
      requestReceived = true
    })
    await client.sendRequest('triggerRequest')
    assert.strictEqual(requestReceived, true)
    await client.stop()
  })

  test('Add pending notification handler', async () => {
    const client = createClient()
    assert.strictEqual(client.state, State.Stopped)
    let notificationReceived = false
    client.onNotification('notification', () => {
      notificationReceived = true
    })
    await client.sendRequest('triggerNotification')
    assert.strictEqual(notificationReceived, true)
    await client.stop()
  })

  test('Starting disposed server fails', async () => {
    const client = createClient()
    await client._start()
    await client.dispose()
    await assert.rejects(async () => {
      await client._start()
    }, /Client got disposed and can't be restarted./)
  })

  async function checkServerStart(client: LanguageClient, disposable: Disposable): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Server didn't start in 1000 ms.`))
      }, 1000)
      client.onDidChangeState(event => {
        if (event.newState === State.Running) {
          clearTimeout(timeout)
          disposable.dispose()
          resolve()
        }
      })
    })
  }

  test('Start server on document open', async () => {
    const client = createClient()
    assert.strictEqual(client.state, State.Stopped)
    const started = checkServerStart(client, workspace.onDidOpenTextDocument(document => {
      if (workspace.match([{ scheme: 'lsptests', pattern: uri.fsPath }], document) > 0) {
        void client.start()
      }
    }))
    await workspace.openTextDocument(uri)
    await started
    await client.stop()
  })

  test('Start server on language feature', async () => {
    const client = createClient()
    assert.strictEqual(client.state, State.Stopped)
    const started = checkServerStart(client, languages.registerDeclarationProvider(documentSelector, {
      provideDeclaration: async () => {
        await client._start()
        return undefined
      }
    }))
    await workspace.openTextDocument(uri)
    await helper.doAction('declarations')
    await started
    await client.stop()
  })
})
