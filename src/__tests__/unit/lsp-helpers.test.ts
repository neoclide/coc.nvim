'use strict'
import { CodeAction, Command, Diagnostic, DiagnosticSeverity, DocumentSymbol, Hover, Position, Range, SignatureHelp, SymbolKind } from 'vscode-languageserver-types'
import languages, { ProviderName } from '../../languages'
import {
  BATCH_METHODS,
  BATCH_POSITION_METHODS,
  batchResultText,
  codeActionsText,
  codeActionSummary,
  configuredServiceId,
  countTextEdits,
  diagnosticText,
  diagnosticsText,
  documentSymbolsText,
  flattenSymbols,
  fullRange,
  getDocumentSymbolResult,
  getHoverResult,
  getLocationResult,
  getSignatureResult,
  hasProvider,
  hoverContents,
  hoverResultText,
  hoverSummary,
  limitResults,
  locationOutputSchema,
  locationText,
  maxResultsFromArgs,
  normalizeLocations,
  normalizeDocumentSymbols,
  positionFromArgs,
  positionInputSchema,
  queryCacheKey,
  rangeFromArgs,
  selectCodeAction,
  serviceCapabilitySummary,
  ServiceLimiter,
  signatureResultText,
  signatureSummary,
  symbolKindName,
  workspaceSymbolsText
} from '../../mcp/tools/lsp'
import { CancellationToken, CancellationTokenSource } from '../../util/protocol'
import workspace from '../../workspace'

describe('mcp lsp helpers', () => {
  before(() => {
    workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': { vim: 'test' } })
  })

  after(() => {
    workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': {} })
  })

  it('maxResultsFromArgs falls back and clamps', () => {
    assert.strictEqual(maxResultsFromArgs(undefined, 200), 200)
    assert.strictEqual(maxResultsFromArgs({ maxResults: 'x' }, 200), 200)
    assert.strictEqual(maxResultsFromArgs({ maxResults: 0 }, 200), 1)
    assert.strictEqual(maxResultsFromArgs({ maxResults: 5000 }, 200), 1000)
    assert.strictEqual(maxResultsFromArgs({ maxResults: 5 }, 200), 5)
    assert.strictEqual(maxResultsFromArgs({ maxResults: Infinity }, 200), 200)
    assert.strictEqual(maxResultsFromArgs({ maxResults: 2.9 }, 200), 2)
  })

  it('limitResults truncates and reports totals', () => {
    let limited = limitResults([1, 2, 3, 4], 2)
    assert.deepStrictEqual(limited.items, [1, 2])
    assert.strictEqual(limited.total, 4)
    assert.strictEqual(limited.truncated, true)
    assert.deepStrictEqual(limitResults(null, 10).items, [])
    assert.strictEqual(limitResults([1], 10).truncated, false)
  })

  it('positionFromArgs and rangeFromArgs parse LSP values', () => {
    assert.deepStrictEqual(positionFromArgs({ position: { line: 1, character: 2 } }), Position.create(1, 2))
    assert.strictEqual(positionFromArgs({}), null)
    assert.strictEqual(positionFromArgs({ position: { line: 'x' } }), null)
    let range = rangeFromArgs({ range: { start: { line: 0, character: 0 }, end: { line: 1, character: 1 } } })
    assert.deepStrictEqual(range, Range.create(0, 0, 1, 1))
    assert.strictEqual(rangeFromArgs({}), null)
    assert.strictEqual(rangeFromArgs({ range: { end: { line: 1, character: 1 } } }), null)
    assert.strictEqual(rangeFromArgs({ range: { start: { line: 0, character: 0 } } }), null)
    assert.strictEqual(rangeFromArgs({ range: { start: {}, end: { line: 1, character: 1 } } }), null)
    assert.strictEqual(rangeFromArgs({ range: { start: { line: 0, character: 0 }, end: {} } }), null)
  })

  it('fullRange spans the whole document text', () => {
    let doc: any = {
      lineCount: 3
    }
    let range = fullRange(doc)
    assert.deepStrictEqual(range.start, Position.create(0, 0))
    assert.deepStrictEqual(range.end, Position.create(3, 0))
  })

  it('locationText renders positions and truncation', () => {
    let items = [{ uri: 'file:///a.ts', range: { start: { line: 0, character: 0 } } }]
    assert.ok(locationText('References', items, { items, total: 5, truncated: true }).includes('1 of 5 results'))
    assert.ok(locationText('References', items, { items, total: 1, truncated: false }).includes('1 result'))
    assert.ok(locationText('References', [], undefined).includes('no results'))
    assert.ok(locationText('References', [{ uri: 'file:///no-range' }]).includes('file:///no-range'))
    assert.ok(locationText('References', [items[0], items[0]]).includes('2 results'))
  })

  it('normalizeLocations handles Location, LocationLink and dedupes', () => {
    let loc = { uri: 'file:///a.ts', range: Range.create(0, 0, 0, 1) }
    let link = { targetUri: 'file:///b.ts', targetRange: Range.create(1, 0, 1, 2), targetSelectionRange: Range.create(1, 0, 1, 1) }
    let result = normalizeLocations([loc, loc, link])
    assert.strictEqual(result.length, 2)
    assert.deepStrictEqual(result[0], { uri: 'file:///a.ts', range: loc.range })
    assert.deepStrictEqual(result[1], { uri: 'file:///b.ts', range: link.targetSelectionRange, targetRange: link.targetRange })
    assert.deepStrictEqual(normalizeLocations(null), [])
    assert.deepStrictEqual(normalizeLocations(loc), [{ uri: 'file:///a.ts', range: loc.range }])
    let linkWithoutSelection = { targetUri: 'file:///c.ts', targetRange: Range.create(2, 0, 2, 1) }
    assert.deepStrictEqual(normalizeLocations([null, 1, {}, linkWithoutSelection, linkWithoutSelection]), [{
      uri: 'file:///c.ts',
      range: linkWithoutSelection.targetRange,
      targetRange: linkWithoutSelection.targetRange
    }])
  })

  it('configuredServiceId reads mcp.languageServiceMap', () => {
    let doc: any = { languageId: 'vim' }
    assert.strictEqual(configuredServiceId(doc), 'test')
    workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': {} })
    assert.strictEqual(configuredServiceId(doc), undefined)
    workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': { vim: 'test' } })
  })

  it('queryCacheKey includes uri, variant, version and position', () => {
    let doc: any = { uri: 'file:///a.ts', version: 3 }
    let pos = Position.create(1, 2)
    assert.strictEqual(queryCacheKey('hover:test', doc, pos), ['file:///a.ts', 'hover:test', 3, 1, 2].join('\u0000'))
    assert.strictEqual(queryCacheKey('hover:test', doc, null), ['file:///a.ts', 'hover:test', 3, -1, -1].join('\u0000'))
    // a different position or version is a different key
    assert.notStrictEqual(queryCacheKey('hover:test', doc, Position.create(2, 2)), queryCacheKey('hover:test', doc, pos))
    doc.version = 4
    assert.notStrictEqual(queryCacheKey('hover:test', doc, pos), queryCacheKey('hover:test', { ...doc, version: 3 }, pos))
    assert.notStrictEqual(queryCacheKey('definition:test', doc, pos), queryCacheKey('hover:test', doc, pos))
  })

  it('ServiceLimiter caps concurrent tasks', async () => {
    let limiter = new ServiceLimiter(1)
    let active = 0
    let maxActive = 0
    let release!: () => void
    let gate = new Promise<void>(resolve => { release = resolve })
    let tasks = [1, 2, 3].map(() => limiter.run(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await gate
      active--
    }))
    release()
    await Promise.all(tasks)
    assert.strictEqual(maxActive, 1)
  })

  it('ServiceLimiter drops queued tasks when their token is cancelled', async () => {
    let limiter = new ServiceLimiter(1)
    let order: string[] = []
    let release!: () => void
    let gate = new Promise<void>(resolve => { release = resolve })
    let start!: () => void
    let started = new Promise<void>(resolve => { start = resolve })
    let firstToken = new CancellationTokenSource()
    let secondToken = new CancellationTokenSource()
    let first = limiter.run(async () => {
      start()
      await gate
      order.push('first')
    }, firstToken.token)
    await started
    let second = limiter.run(async () => {
      order.push('second')
    }, secondToken.token)
    secondToken.cancel()
    await assert.rejects(second, /cancelled/)
    assert.strictEqual(limiter.stuckCount, 0)
    release()
    await first
    assert.deepStrictEqual(order, ['first'])
  })

  it('ServiceLimiter counts cancelled running requests as stuck until they settle', async () => {
    let limiter = new ServiceLimiter(1)
    let release!: () => void
    let gate = new Promise<void>(resolve => { release = resolve })
    let start!: () => void
    let started = new Promise<void>(resolve => { start = resolve })
    let token = new CancellationTokenSource()
    let task = limiter.run(async () => {
      start()
      await gate
    }, token.token)
    await started
    assert.strictEqual(limiter.stuckCount, 0)
    token.cancel()
    assert.strictEqual(limiter.stuckCount, 1)
    release()
    await task
    assert.strictEqual(limiter.stuckCount, 0)
  })

  it('ServiceLimiter rejects immediately when the token is already cancelled', async () => {
    let limiter = new ServiceLimiter(1)
    let token = new CancellationTokenSource()
    token.cancel()
    await assert.rejects(limiter.run(async () => 'ran', token.token), /cancelled/)
    assert.strictEqual(limiter.stuckCount, 0)
    assert.strictEqual(await limiter.run(async () => 'ok'), 'ok')
  })

  it('ServiceLimiter with limit 0 runs tasks immediately but tracks stuck requests', async () => {
    let limiter = new ServiceLimiter(0)
    let order: string[] = []
    let release!: () => void
    let gate = new Promise<void>(resolve => { release = resolve })
    let start!: () => void
    let started = new Promise<void>(resolve => { start = resolve })
    let token = new CancellationTokenSource()
    let task = limiter.run(async () => {
      start()
      order.push('start')
      await gate
      order.push('end')
    }, token.token)
    // with limit 0 the task starts without waiting for a slot
    await started
    assert.strictEqual(limiter.stuckCount, 0)
    token.cancel()
    assert.strictEqual(limiter.stuckCount, 1)
    release()
    await task
    assert.strictEqual(limiter.stuckCount, 0)
    assert.deepStrictEqual(order, ['start', 'end'])
  })

  it('hoverContents and hoverSummary extract text', () => {
    assert.deepStrictEqual(hoverContents('plain'), ['plain'])
    assert.deepStrictEqual(hoverContents({ value: 'md' }), ['md'])
    assert.deepStrictEqual(hoverContents(['a', { value: 'b' }] as any), ['a', 'b'])
    let hover: Hover = { contents: [{ value: 'x' }] as any, range: Range.create(0, 0, 0, 1) }
    assert.deepStrictEqual(hoverSummary(hover), { contents: ['x'], range: hover.range })
    assert.deepStrictEqual(hoverContents([null, 1, {}, { value: 2 }]), [])
  })

  it('signatureSummary renders labels and parameters', () => {
    let help: SignatureHelp = {
      signatures: [
        {
          label: 'fn(a)',
          documentation: 'doc',
          parameters: [{ label: 'a', documentation: 'param' }]
        }
      ],
      activeSignature: 0,
      activeParameter: 0
    }
    let summary = signatureSummary(help)
    assert.strictEqual(summary.activeSignature, 0)
    assert.strictEqual(summary.signatures[0].label, 'fn(a)')
    assert.strictEqual(summary.signatures[0].parameters[0].documentation, 'param')
    assert.strictEqual(signatureSummary(undefined).activeSignature, -1)
    let markup = signatureSummary({
      signatures: [{
        label: 'fn()',
        documentation: { kind: 'markdown', value: 'markdown docs' },
        parameters: [{ label: [0, 2], documentation: { kind: 'plaintext', value: 'parameter docs' } }]
      }]
    })
    assert.strictEqual(markup.signatures[0].documentation, 'markdown docs')
    assert.strictEqual(markup.signatures[0].parameters[0].documentation, 'parameter docs')
    assert.deepStrictEqual(signatureSummary({ signatures: [{ label: 'bare' }] }).signatures[0].parameters, [])
  })

  it('flattenSymbols walks the tree with depth and truncates', () => {
    let child = DocumentSymbol.create('child', undefined, SymbolKind.Method, Range.create(1, 0, 1, 1), Range.create(1, 0, 1, 1))
    let root = DocumentSymbol.create('root', undefined, SymbolKind.Class, Range.create(0, 0, 2, 1), Range.create(0, 0, 0, 4))
    root.children = [child]
    let limited = flattenSymbols([root], 10)
    assert.strictEqual(limited.items.length, 2)
    assert.strictEqual(limited.items[0].name, 'root')
    assert.strictEqual(limited.items[0].kind, 'Class')
    assert.strictEqual(limited.items[1].depth, 1)
    assert.deepStrictEqual(flattenSymbols(null, 10).items, [])
  })

  it('normalizes document symbols from both LSP response shapes', () => {
    assert.strictEqual(normalizeDocumentSymbols(null), null)
    assert.strictEqual(normalizeDocumentSymbols([]), null)
    let symbol = DocumentSymbol.create('root', undefined, SymbolKind.Class, Range.create(0, 0, 1, 0), Range.create(0, 0, 0, 4))
    assert.deepStrictEqual(normalizeDocumentSymbols([symbol]), [symbol])
    let flat: any = { name: 'flat', kind: SymbolKind.Function, location: { uri: 'file:///a', range: Range.create(0, 0, 0, 1) } }
    assert.strictEqual(normalizeDocumentSymbols([flat])![0].name, 'flat')
  })

  it('queries provider-backed hover, signature, symbols and locations directly', async t => {
    let doc: any = { uri: 'file:///helpers.ts', version: 1, languageId: 'typescript', textDocument: {} }
    t.mock.method(languages, 'hasProvider', () => true)
    t.mock.method(languages, 'getHover', async () => [{ contents: 'hover' } as Hover])
    t.mock.method(languages, 'getSignatureHelp', async () => ({ signatures: [{ label: 'fn()' }] }))
    t.mock.method(languages, 'getDocumentSymbol', async () => [])
    assert.deepStrictEqual(await getHoverResult(doc, Position.create(0, 0), undefined, CancellationToken.None), { hovers: [{ contents: 'hover' }] })
    assert.deepStrictEqual(await getSignatureResult(doc, Position.create(0, 1), undefined, CancellationToken.None), { help: { signatures: [{ label: 'fn()' }] } })
    assert.deepStrictEqual(await getDocumentSymbolResult(doc, undefined, CancellationToken.None), { symbols: [] })
    let query: any = {
      provider: ProviderName.Definition,
      label: 'Definition',
      cacheKey: 'helper-location',
      fetch: t.mock.fn(async () => [{ uri: 'file:///target', range: Range.create(0, 0, 0, 1) }]),
      serviceMethod: 'textDocument/definition',
      buildParams: t.mock.fn()
    }
    let locResult: any = await getLocationResult(doc, Position.create(0, 2), undefined, query, CancellationToken.None)
    assert.strictEqual(locResult.locations[0].uri, 'file:///target')
  })

  it('turns provider exceptions and missing providers into query errors', async t => {
    let doc: any = { uri: 'file:///errors.ts', version: 2, languageId: 'typescript', textDocument: {} }
    t.mock.method(languages, 'hasProvider', () => false)
    assert.ok('error' in await getHoverResult(doc, Position.create(0, 0), undefined, CancellationToken.None))
    assert.ok('error' in await getSignatureResult(doc, Position.create(0, 1), undefined, CancellationToken.None))
    assert.ok('error' in await getDocumentSymbolResult(doc, undefined, CancellationToken.None))
    t.mock.method(languages, 'hasProvider', () => true)
    let hoverCalls = 0
    t.mock.method(languages, 'getHover', async () => {
      hoverCalls++
      // oxlint-disable-next-line typescript/only-throw-error
      if (hoverCalls === 1) throw 'hover failed'
      throw new Error('hover error')
    })
    let signatureCalls = 0
    t.mock.method(languages, 'getSignatureHelp', async () => {
      signatureCalls++
      if (signatureCalls === 1) throw new Error('signature failed')
      // oxlint-disable-next-line typescript/only-throw-error
      throw 'signature string'
    })
    let symbolsCalls = 0
    t.mock.method(languages, 'getDocumentSymbol', async () => {
      symbolsCalls++
      // oxlint-disable-next-line typescript/only-throw-error
      if (symbolsCalls === 1) throw 'symbols failed'
      throw new Error('symbols error')
    })
    assert.ok((await getHoverResult(doc, Position.create(1, 0), undefined, CancellationToken.None) as any).error.includes('hover failed'))
    assert.ok((await getHoverResult(doc, Position.create(2, 0), undefined, CancellationToken.None) as any).error.includes('hover error'))
    assert.ok((await getSignatureResult(doc, Position.create(1, 1), undefined, CancellationToken.None) as any).error.includes('signature failed'))
    assert.ok((await getSignatureResult(doc, Position.create(2, 1), undefined, CancellationToken.None) as any).error.includes('signature string'))
    assert.ok((await getDocumentSymbolResult({ ...doc, version: 3 }, undefined, CancellationToken.None) as any).error.includes('symbols failed'))
    assert.ok((await getDocumentSymbolResult({ ...doc, version: 4 }, undefined, CancellationToken.None) as any).error.includes('symbols error'))
    let query: any = {
      provider: ProviderName.Definition,
      label: 'Definition',
      cacheKey: 'helper-location-error',
      // oxlint-disable-next-line typescript/only-throw-error
      fetch: t.mock.fn(async () => { throw 'location failed' }),
      serviceMethod: 'textDocument/definition',
      buildParams: t.mock.fn()
    }
    assert.ok((await getLocationResult(doc, Position.create(1, 2), undefined, query, CancellationToken.None) as any).error.includes('location failed'))
    query.cacheKey = 'helper-location-error-object'
    query.fetch = t.mock.fn(async () => { throw new Error('location error') })
    assert.ok((await getLocationResult(doc, Position.create(2, 2), undefined, query, CancellationToken.None) as any).error.includes('location error'))
  })

  it('hasProvider handles provider manager errors', t => {
    t.mock.method(languages, 'hasProvider', () => { throw new Error('failed') })
    assert.strictEqual(hasProvider(ProviderName.Hover, { textDocument: {} } as any), false)
  })

  it('countTextEdits counts changes and documentChanges', () => {
    assert.strictEqual(countTextEdits({
      changes: { 'file:///a.ts': [{}, {}] },
      documentChanges: [{ edits: [{}] }]
    }), 3)
    assert.strictEqual(countTextEdits({}), 0)
    assert.strictEqual(countTextEdits({ changes: { a: null }, documentChanges: [null, {}, { edits: 'invalid' }] }), 0)
  })

  it('codeActionSummary extracts action metadata', () => {
    let action = CodeAction.create('title', Command.create('title', 'cmd'))
    let summary = codeActionSummary(action)
    assert.strictEqual(summary.title, 'title')
    assert.deepStrictEqual(summary.command, { command: 'cmd', title: 'title' })
    assert.strictEqual(summary.hasEdit, false)
    let withEdit = CodeAction.create('fix')
    withEdit.edit = { changes: {} }
    assert.strictEqual(codeActionSummary(withEdit).hasEdit, true)
    let disabled = CodeAction.create('disabled')
    disabled.kind = 'quickfix'
    disabled.isPreferred = true
    disabled.disabled = { reason: 'not applicable' }
    let disabledSummary = codeActionSummary(disabled)
    assert.strictEqual(disabledSummary.kind, 'quickfix')
    assert.strictEqual(disabledSummary.isPreferred, true)
    assert.deepStrictEqual(disabledSummary.disabled, { reason: 'not applicable' })
  })

  it('selectCodeAction validates title, index and disabled actions', () => {
    let first = CodeAction.create('first')
    let disabled = CodeAction.create('disabled')
    disabled.disabled = { reason: 'reason' }
    let actions = [first, disabled]
    assert.strictEqual(selectCodeAction(actions, { title: 'first' }).action, first)
    assert.strictEqual(selectCodeAction(actions, { index: 0 }).action, first)
    assert.ok(selectCodeAction(actions, { title: 'missing' }).error.includes('not found'))
    assert.ok(selectCodeAction(actions, { index: 9 }).error.includes('not found'))
    assert.ok(selectCodeAction(actions, {}).error.includes('required'))
    assert.ok(selectCodeAction(actions, { index: 1 }).error.includes('disabled'))
  })

  it('summarizes service capabilities with absent optional data', () => {
    let stat = { id: 'test', state: 'running', languageIds: ['vim'] }
    let s1 = serviceCapabilitySummary(stat)
    assert.strictEqual(s1.capabilities, null)
    assert.strictEqual(s1.serverInfo, null)
    let s2 = serviceCapabilitySummary(stat, { client: { initializeResult: { capabilities: { hoverProvider: true }, serverInfo: { name: 'server' } } } })
    assert.strictEqual(s2.capabilities.hoverProvider, true)
    assert.strictEqual(s2.serverInfo.name, 'server')
    let s3 = serviceCapabilitySummary(stat, { client: {} })
    assert.strictEqual(s3.capabilities, null)
    assert.strictEqual(s3.serverInfo, null)
  })

  it('symbolKindName maps numeric and string kinds', () => {
    assert.strictEqual(symbolKindName(SymbolKind.Method), 'Method')
    assert.strictEqual(symbolKindName('3'), 'Namespace')
    assert.strictEqual(symbolKindName('Method'), 'Method')
    assert.strictEqual(symbolKindName(9999), '9999')
    assert.strictEqual(symbolKindName(undefined), undefined)
  })

  it('schemas expose shared properties without serviceId', () => {
    let schema = positionInputSchema()
    assert.notStrictEqual(schema.properties.uri, undefined)
    assert.notStrictEqual(schema.properties.position, undefined)
    assert.notStrictEqual(schema.properties.maxResults, undefined)
    assert.strictEqual(schema.properties.serviceId, undefined)
    assert.notStrictEqual(locationOutputSchema().properties.locations, undefined)
    assert.notStrictEqual(positionInputSchema({ custom: { type: 'boolean' } }).properties.custom, undefined)
    let itemSchema = { type: 'string' }
    assert.strictEqual(locationOutputSchema(itemSchema).properties.locations.items, itemSchema)
  })

  it('batch method sets are consistent', () => {
    assert.ok(BATCH_METHODS.includes('hover'))
    assert.ok(BATCH_METHODS.includes('document_symbols'))
    assert.strictEqual(BATCH_POSITION_METHODS.has('document_symbols'), false)
    assert.strictEqual(BATCH_POSITION_METHODS.has('definition'), true)
  })

  it('renders hover, signature and symbol results', () => {
    assert.strictEqual(hoverResultText([]), 'No hover content')
    assert.strictEqual(hoverResultText([{ contents: ['a', 'b'] }, { contents: ['c'] }]), 'a\n\nb\n\n---\n\nc')
    assert.strictEqual(signatureResultText({ signatures: [], activeSignature: -1 }), 'No signature help')
    assert.strictEqual(signatureResultText({ signatures: [{ label: 'a' }, { label: 'b' }], activeSignature: 1 }), '  a\n* b')
    assert.strictEqual(documentSymbolsText({ items: [], total: 0, truncated: false }), 'No document symbols')
    assert.ok(documentSymbolsText({ items: [{ depth: 1, name: 'child', kind: 'Method' }], total: 2, truncated: true }).includes('Truncated'))
    assert.ok(!documentSymbolsText({ items: [{ depth: 0, name: 'root', kind: 'Class' }], total: 1, truncated: false }).includes('Truncated'))
    assert.strictEqual(workspaceSymbolsText({ items: [], total: 0, truncated: false }), 'No workspace symbols')
    assert.ok(workspaceSymbolsText({ items: [{ name: 'a', kind: 'Class', containerName: 'ns' }], total: 2, truncated: true }).includes('in ns'))
    assert.strictEqual(workspaceSymbolsText({ items: [{ name: 'b', kind: 'Method' }], total: 1, truncated: false }), 'b (Method)')
  })

  it('renders all batch result variants', () => {
    assert.ok(batchResultText('hover', { error: 'failed' }).includes('error - failed'))
    assert.ok(batchResultText('definition', { locations: [], returned: 1, count: 2, truncated: true }).includes('(truncated)'))
    assert.ok(!batchResultText('definition', { locations: [], returned: 1, count: 1, truncated: false }).includes('(truncated)'))
    assert.ok(batchResultText('document_symbols', { symbols: [], returned: 1, count: 2, truncated: true }).includes('symbol(s)'))
    assert.ok(!batchResultText('document_symbols', { symbols: [], returned: 1, count: 1, truncated: false }).includes('(truncated)'))
    assert.ok(batchResultText('hover', { hovers: [], count: 2 }).includes('2 hover'))
    assert.ok(batchResultText('signature_help', { signatures: [{}, {}] }).includes('2 signature'))
    assert.strictEqual(batchResultText('other', {}), 'other: done')
  })

  it('renders diagnostics and code actions', () => {
    let plain = Diagnostic.create(Range.create(0, 0, 0, 1), 'plain')
    let numbered = Diagnostic.create(Range.create(1, 1, 1, 2), 'numbered', DiagnosticSeverity.Warning, 7)
    let objectCode = Diagnostic.create(Range.create(2, 0, 2, 1), 'object', 99 as DiagnosticSeverity)
    objectCode.code = { value: 'E1', target: '' } as any
    assert.strictEqual(diagnosticText(plain), 'Error 1:1 plain')
    assert.ok(diagnosticText(numbered).includes('Warning 2:2 numbered [7]'))
    assert.ok(diagnosticText(objectCode).includes('Unknown 3:1 object [E1]'))
    assert.strictEqual(diagnosticsText({ items: [], total: 0, truncated: false }), 'No diagnostics')
    assert.ok(diagnosticsText({ items: [plain], total: 2, truncated: true }).includes('Truncated'))
    assert.ok(!diagnosticsText({ items: [plain], total: 1, truncated: false }).includes('Truncated'))
    assert.strictEqual(codeActionsText([], { items: [], total: 0, truncated: false }), 'No code actions')
    let actions = [{ title: 'fix' }, { title: 'skip', disabled: { reason: 'disabled' } }]
    assert.ok(codeActionsText(actions, { items: actions, total: 3, truncated: true }).includes('disabled: disabled'))
    assert.ok(!codeActionsText(actions, { items: actions, total: 2, truncated: false }).includes('Truncated'))
  })
})
