'use strict'
import { CodeAction, Command, Diagnostic, DiagnosticSeverity, DocumentSymbol, Hover, Position, Range, SignatureHelp, SymbolKind } from 'vscode-languageserver-types'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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
  beforeAll(() => {
    workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': { vim: 'test' } })
  })

  afterAll(() => {
    workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': {} })
  })

  it('maxResultsFromArgs falls back and clamps', () => {
    expect(maxResultsFromArgs(undefined, 200)).toBe(200)
    expect(maxResultsFromArgs({ maxResults: 'x' }, 200)).toBe(200)
    expect(maxResultsFromArgs({ maxResults: 0 }, 200)).toBe(1)
    expect(maxResultsFromArgs({ maxResults: 5000 }, 200)).toBe(1000)
    expect(maxResultsFromArgs({ maxResults: 5 }, 200)).toBe(5)
    expect(maxResultsFromArgs({ maxResults: Infinity }, 200)).toBe(200)
    expect(maxResultsFromArgs({ maxResults: 2.9 }, 200)).toBe(2)
  })

  it('limitResults truncates and reports totals', () => {
    let limited = limitResults([1, 2, 3, 4], 2)
    expect(limited.items).toEqual([1, 2])
    expect(limited.total).toBe(4)
    expect(limited.truncated).toBe(true)
    expect(limitResults(null, 10).items).toEqual([])
    expect(limitResults([1], 10).truncated).toBe(false)
  })

  it('positionFromArgs and rangeFromArgs parse LSP values', () => {
    expect(positionFromArgs({ position: { line: 1, character: 2 } })).toEqual(Position.create(1, 2))
    expect(positionFromArgs({})).toBeNull()
    expect(positionFromArgs({ position: { line: 'x' } })).toBeNull()
    let range = rangeFromArgs({ range: { start: { line: 0, character: 0 }, end: { line: 1, character: 1 } } })
    expect(range).toEqual(Range.create(0, 0, 1, 1))
    expect(rangeFromArgs({})).toBeNull()
    expect(rangeFromArgs({ range: { end: { line: 1, character: 1 } } })).toBeNull()
    expect(rangeFromArgs({ range: { start: { line: 0, character: 0 } } })).toBeNull()
    expect(rangeFromArgs({ range: { start: {}, end: { line: 1, character: 1 } } })).toBeNull()
    expect(rangeFromArgs({ range: { start: { line: 0, character: 0 }, end: {} } })).toBeNull()
  })

  it('fullRange spans the whole document text', () => {
    let doc: any = {
      lineCount: 3
    }
    let range = fullRange(doc)
    expect(range.start).toEqual(Position.create(0, 0))
    expect(range.end).toEqual(Position.create(3, 0))
  })

  it('locationText renders positions and truncation', () => {
    let items = [{ uri: 'file:///a.ts', range: { start: { line: 0, character: 0 } } }]
    expect(locationText('References', items, { items, total: 5, truncated: true })).toContain('1 of 5 results')
    expect(locationText('References', items, { items, total: 1, truncated: false })).toContain('1 result')
    expect(locationText('References', [], undefined)).toContain('no results')
    expect(locationText('References', [{ uri: 'file:///no-range' }])).toContain('file:///no-range')
    expect(locationText('References', [items[0], items[0]])).toContain('2 results')
  })

  it('normalizeLocations handles Location, LocationLink and dedupes', () => {
    let loc = { uri: 'file:///a.ts', range: Range.create(0, 0, 0, 1) }
    let link = { targetUri: 'file:///b.ts', targetRange: Range.create(1, 0, 1, 2), targetSelectionRange: Range.create(1, 0, 1, 1) }
    let result = normalizeLocations([loc, loc, link])
    expect(result.length).toBe(2)
    expect(result[0]).toEqual({ uri: 'file:///a.ts', range: loc.range })
    expect(result[1]).toEqual({ uri: 'file:///b.ts', range: link.targetSelectionRange, targetRange: link.targetRange })
    expect(normalizeLocations(null)).toEqual([])
    expect(normalizeLocations(loc)).toEqual([{ uri: 'file:///a.ts', range: loc.range }])
    let linkWithoutSelection = { targetUri: 'file:///c.ts', targetRange: Range.create(2, 0, 2, 1) }
    expect(normalizeLocations([null, 1, {}, linkWithoutSelection, linkWithoutSelection])).toEqual([{
      uri: 'file:///c.ts',
      range: linkWithoutSelection.targetRange,
      targetRange: linkWithoutSelection.targetRange
    }])
  })

  it('configuredServiceId reads mcp.languageServiceMap', () => {
    let doc: any = { languageId: 'vim' }
    expect(configuredServiceId(doc)).toBe('test')
    workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': {} })
    expect(configuredServiceId(doc)).toBeUndefined()
    workspace.configurations.updateMemoryConfig({ 'mcp.languageServiceMap': { vim: 'test' } })
  })

  it('queryCacheKey includes uri, variant, version and position', () => {
    let doc: any = { uri: 'file:///a.ts', version: 3 }
    let pos = Position.create(1, 2)
    expect(queryCacheKey('hover:test', doc, pos)).toBe(['file:///a.ts', 'hover:test', 3, 1, 2].join('\u0000'))
    expect(queryCacheKey('hover:test', doc, null)).toBe(['file:///a.ts', 'hover:test', 3, -1, -1].join('\u0000'))
    // a different position or version is a different key
    expect(queryCacheKey('hover:test', doc, Position.create(2, 2))).not.toBe(queryCacheKey('hover:test', doc, pos))
    doc.version = 4
    expect(queryCacheKey('hover:test', doc, pos)).not.toBe(queryCacheKey('hover:test', { ...doc, version: 3 }, pos))
    expect(queryCacheKey('definition:test', doc, pos)).not.toBe(queryCacheKey('hover:test', doc, pos))
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
    expect(maxActive).toBe(1)
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
    await expect(second).rejects.toThrow(/cancelled/)
    expect(limiter.stuckCount).toBe(0)
    release()
    await first
    expect(order).toEqual(['first'])
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
    expect(limiter.stuckCount).toBe(0)
    token.cancel()
    expect(limiter.stuckCount).toBe(1)
    release()
    await task
    expect(limiter.stuckCount).toBe(0)
  })

  it('ServiceLimiter rejects immediately when the token is already cancelled', async () => {
    let limiter = new ServiceLimiter(1)
    let token = new CancellationTokenSource()
    token.cancel()
    await expect(limiter.run(async () => 'ran', token.token)).rejects.toThrow(/cancelled/)
    expect(limiter.stuckCount).toBe(0)
    expect(await limiter.run(async () => 'ok')).toBe('ok')
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
    expect(limiter.stuckCount).toBe(0)
    token.cancel()
    expect(limiter.stuckCount).toBe(1)
    release()
    await task
    expect(limiter.stuckCount).toBe(0)
    expect(order).toEqual(['start', 'end'])
  })

  it('hoverContents and hoverSummary extract text', () => {
    expect(hoverContents('plain')).toEqual(['plain'])
    expect(hoverContents({ value: 'md' })).toEqual(['md'])
    expect(hoverContents(['a', { value: 'b' }] as any)).toEqual(['a', 'b'])
    let hover: Hover = { contents: [{ value: 'x' }] as any, range: Range.create(0, 0, 0, 1) }
    expect(hoverSummary(hover)).toEqual({ contents: ['x'], range: hover.range })
    expect(hoverContents([null, 1, {}, { value: 2 }])).toEqual([])
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
    expect(summary.activeSignature).toBe(0)
    expect(summary.signatures[0].label).toBe('fn(a)')
    expect(summary.signatures[0].parameters[0].documentation).toBe('param')
    expect(signatureSummary(undefined).activeSignature).toBe(-1)
    let markup = signatureSummary({
      signatures: [{
        label: 'fn()',
        documentation: { kind: 'markdown', value: 'markdown docs' },
        parameters: [{ label: [0, 2], documentation: { kind: 'plaintext', value: 'parameter docs' } }]
      }]
    })
    expect(markup.signatures[0].documentation).toBe('markdown docs')
    expect(markup.signatures[0].parameters[0].documentation).toBe('parameter docs')
    expect(signatureSummary({ signatures: [{ label: 'bare' }] }).signatures[0].parameters).toEqual([])
  })

  it('flattenSymbols walks the tree with depth and truncates', () => {
    let child = DocumentSymbol.create('child', undefined, SymbolKind.Method, Range.create(1, 0, 1, 1), Range.create(1, 0, 1, 1))
    let root = DocumentSymbol.create('root', undefined, SymbolKind.Class, Range.create(0, 0, 2, 1), Range.create(0, 0, 0, 4))
    root.children = [child]
    let limited = flattenSymbols([root], 10)
    expect(limited.items.length).toBe(2)
    expect(limited.items[0].name).toBe('root')
    expect(limited.items[0].kind).toBe('Class')
    expect(limited.items[1].depth).toBe(1)
    expect(flattenSymbols(null, 10).items).toEqual([])
  })

  it('normalizes document symbols from both LSP response shapes', () => {
    expect(normalizeDocumentSymbols(null)).toBeNull()
    expect(normalizeDocumentSymbols([])).toBeNull()
    let symbol = DocumentSymbol.create('root', undefined, SymbolKind.Class, Range.create(0, 0, 1, 0), Range.create(0, 0, 0, 4))
    expect(normalizeDocumentSymbols([symbol])).toEqual([symbol])
    let flat: any = { name: 'flat', kind: SymbolKind.Function, location: { uri: 'file:///a', range: Range.create(0, 0, 0, 1) } }
    expect(normalizeDocumentSymbols([flat])![0].name).toBe('flat')
  })

  it('queries provider-backed hover, signature, symbols and locations directly', async () => {
    let doc: any = { uri: 'file:///helpers.ts', version: 1, languageId: 'typescript', textDocument: {} }
    let provider = vi.spyOn(languages, 'hasProvider').mockReturnValue(true)
    let hover = vi.spyOn(languages, 'getHover').mockResolvedValue([{ contents: 'hover' } as Hover])
    let signature = vi.spyOn(languages, 'getSignatureHelp').mockResolvedValue({ signatures: [{ label: 'fn()' }] })
    let symbols = vi.spyOn(languages, 'getDocumentSymbol').mockResolvedValue([])
    try {
      expect(await getHoverResult(doc, Position.create(0, 0), undefined, CancellationToken.None)).toEqual({ hovers: [{ contents: 'hover' }] })
      expect(await getSignatureResult(doc, Position.create(0, 1), undefined, CancellationToken.None)).toEqual({ help: { signatures: [{ label: 'fn()' }] } })
      expect(await getDocumentSymbolResult(doc, undefined, CancellationToken.None)).toEqual({ symbols: [] })
      let query: any = {
        provider: ProviderName.Definition,
        label: 'Definition',
        cacheKey: 'helper-location',
        fetch: vi.fn().mockResolvedValue([{ uri: 'file:///target', range: Range.create(0, 0, 0, 1) }]),
        serviceMethod: 'textDocument/definition',
        buildParams: vi.fn()
      }
      expect(await getLocationResult(doc, Position.create(0, 2), undefined, query, CancellationToken.None)).toMatchObject({
        locations: [{ uri: 'file:///target' }]
      })
    } finally {
      provider.mockRestore()
      hover.mockRestore()
      signature.mockRestore()
      symbols.mockRestore()
    }
  })

  it('turns provider exceptions and missing providers into query errors', async () => {
    let doc: any = { uri: 'file:///errors.ts', version: 2, languageId: 'typescript', textDocument: {} }
    let provider = vi.spyOn(languages, 'hasProvider').mockReturnValue(false)
    try {
      expect(await getHoverResult(doc, Position.create(0, 0), undefined, CancellationToken.None)).toHaveProperty('error')
      expect(await getSignatureResult(doc, Position.create(0, 1), undefined, CancellationToken.None)).toHaveProperty('error')
      expect(await getDocumentSymbolResult(doc, undefined, CancellationToken.None)).toHaveProperty('error')
    } finally {
      provider.mockRestore()
    }
    provider = vi.spyOn(languages, 'hasProvider').mockReturnValue(true)
    let hover = vi.spyOn(languages, 'getHover').mockRejectedValueOnce('hover failed').mockRejectedValueOnce(new Error('hover error'))
    let signature = vi.spyOn(languages, 'getSignatureHelp').mockRejectedValueOnce(new Error('signature failed')).mockRejectedValueOnce('signature string')
    let symbols = vi.spyOn(languages, 'getDocumentSymbol').mockRejectedValueOnce('symbols failed').mockRejectedValueOnce(new Error('symbols error'))
    try {
      expect((await getHoverResult(doc, Position.create(1, 0), undefined, CancellationToken.None) as any).error).toContain('hover failed')
      expect((await getHoverResult(doc, Position.create(2, 0), undefined, CancellationToken.None) as any).error).toContain('hover error')
      expect((await getSignatureResult(doc, Position.create(1, 1), undefined, CancellationToken.None) as any).error).toContain('signature failed')
      expect((await getSignatureResult(doc, Position.create(2, 1), undefined, CancellationToken.None) as any).error).toContain('signature string')
      expect((await getDocumentSymbolResult({ ...doc, version: 3 }, undefined, CancellationToken.None) as any).error).toContain('symbols failed')
      expect((await getDocumentSymbolResult({ ...doc, version: 4 }, undefined, CancellationToken.None) as any).error).toContain('symbols error')
      let query: any = {
        provider: ProviderName.Definition,
        label: 'Definition',
        cacheKey: 'helper-location-error',
        fetch: vi.fn().mockRejectedValue('location failed'),
        serviceMethod: 'textDocument/definition',
        buildParams: vi.fn()
      }
      expect((await getLocationResult(doc, Position.create(1, 2), undefined, query, CancellationToken.None) as any).error).toContain('location failed')
      query.cacheKey = 'helper-location-error-object'
      query.fetch = vi.fn().mockRejectedValue(new Error('location error'))
      expect((await getLocationResult(doc, Position.create(2, 2), undefined, query, CancellationToken.None) as any).error).toContain('location error')
    } finally {
      provider.mockRestore()
      hover.mockRestore()
      signature.mockRestore()
      symbols.mockRestore()
    }
  })

  it('hasProvider handles provider manager errors', () => {
    let spy = vi.spyOn(languages, 'hasProvider').mockImplementation(() => { throw new Error('failed') })
    try {
      expect(hasProvider(ProviderName.Hover, { textDocument: {} } as any)).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it('countTextEdits counts changes and documentChanges', () => {
    expect(countTextEdits({
      changes: { 'file:///a.ts': [{}, {}] },
      documentChanges: [{ edits: [{}] }]
    })).toBe(3)
    expect(countTextEdits({})).toBe(0)
    expect(countTextEdits({ changes: { a: null }, documentChanges: [null, {}, { edits: 'invalid' }] })).toBe(0)
  })

  it('codeActionSummary extracts action metadata', () => {
    let action = CodeAction.create('title', Command.create('title', 'cmd'))
    let summary = codeActionSummary(action)
    expect(summary.title).toBe('title')
    expect(summary.command).toEqual({ command: 'cmd', title: 'title' })
    expect(summary.hasEdit).toBe(false)
    let withEdit = CodeAction.create('fix')
    withEdit.edit = { changes: {} }
    expect(codeActionSummary(withEdit).hasEdit).toBe(true)
    let disabled = CodeAction.create('disabled')
    disabled.kind = 'quickfix'
    disabled.isPreferred = true
    disabled.disabled = { reason: 'not applicable' }
    expect(codeActionSummary(disabled)).toMatchObject({
      kind: 'quickfix',
      isPreferred: true,
      disabled: { reason: 'not applicable' }
    })
  })

  it('selectCodeAction validates title, index and disabled actions', () => {
    let first = CodeAction.create('first')
    let disabled = CodeAction.create('disabled')
    disabled.disabled = { reason: 'reason' }
    let actions = [first, disabled]
    expect(selectCodeAction(actions, { title: 'first' }).action).toBe(first)
    expect(selectCodeAction(actions, { index: 0 }).action).toBe(first)
    expect(selectCodeAction(actions, { title: 'missing' }).error).toContain('not found')
    expect(selectCodeAction(actions, { index: 9 }).error).toContain('not found')
    expect(selectCodeAction(actions, {}).error).toContain('required')
    expect(selectCodeAction(actions, { index: 1 }).error).toContain('disabled')
  })

  it('summarizes service capabilities with absent optional data', () => {
    let stat = { id: 'test', state: 'running', languageIds: ['vim'] }
    expect(serviceCapabilitySummary(stat)).toMatchObject({ capabilities: null, serverInfo: null })
    expect(serviceCapabilitySummary(stat, { client: { initializeResult: { capabilities: { hoverProvider: true }, serverInfo: { name: 'server' } } } })).toMatchObject({
      capabilities: { hoverProvider: true }, serverInfo: { name: 'server' }
    })
    expect(serviceCapabilitySummary(stat, { client: {} })).toMatchObject({ capabilities: null, serverInfo: null })
  })

  it('symbolKindName maps numeric and string kinds', () => {
    expect(symbolKindName(SymbolKind.Method)).toBe('Method')
    expect(symbolKindName('3')).toBe('Namespace')
    expect(symbolKindName('Method')).toBe('Method')
    expect(symbolKindName(9999)).toBe('9999')
    expect(symbolKindName(undefined)).toBeUndefined()
  })

  it('schemas expose shared properties without serviceId', () => {
    let schema = positionInputSchema()
    expect(schema.properties.uri).toBeDefined()
    expect(schema.properties.position).toBeDefined()
    expect(schema.properties.maxResults).toBeDefined()
    expect(schema.properties.serviceId).toBeUndefined()
    expect(locationOutputSchema().properties.locations).toBeDefined()
    expect(positionInputSchema({ custom: { type: 'boolean' } }).properties.custom).toBeDefined()
    let itemSchema = { type: 'string' }
    expect(locationOutputSchema(itemSchema).properties.locations.items).toBe(itemSchema)
  })

  it('batch method sets are consistent', () => {
    expect(BATCH_METHODS).toContain('hover')
    expect(BATCH_METHODS).toContain('document_symbols')
    expect(BATCH_POSITION_METHODS.has('document_symbols')).toBe(false)
    expect(BATCH_POSITION_METHODS.has('definition')).toBe(true)
  })

  it('renders hover, signature and symbol results', () => {
    expect(hoverResultText([])).toBe('No hover content')
    expect(hoverResultText([{ contents: ['a', 'b'] }, { contents: ['c'] }])).toBe('a\n\nb\n\n---\n\nc')
    expect(signatureResultText({ signatures: [], activeSignature: -1 })).toBe('No signature help')
    expect(signatureResultText({ signatures: [{ label: 'a' }, { label: 'b' }], activeSignature: 1 })).toBe('  a\n* b')
    expect(documentSymbolsText({ items: [], total: 0, truncated: false })).toBe('No document symbols')
    expect(documentSymbolsText({ items: [{ depth: 1, name: 'child', kind: 'Method' }], total: 2, truncated: true })).toContain('Truncated')
    expect(documentSymbolsText({ items: [{ depth: 0, name: 'root', kind: 'Class' }], total: 1, truncated: false })).not.toContain('Truncated')
    expect(workspaceSymbolsText({ items: [], total: 0, truncated: false })).toBe('No workspace symbols')
    expect(workspaceSymbolsText({ items: [{ name: 'a', kind: 'Class', containerName: 'ns' }], total: 2, truncated: true })).toContain('in ns')
    expect(workspaceSymbolsText({ items: [{ name: 'b', kind: 'Method' }], total: 1, truncated: false })).toBe('b (Method)')
  })

  it('renders all batch result variants', () => {
    expect(batchResultText('hover', { error: 'failed' })).toContain('error - failed')
    expect(batchResultText('definition', { locations: [], returned: 1, count: 2, truncated: true })).toContain('(truncated)')
    expect(batchResultText('definition', { locations: [], returned: 1, count: 1, truncated: false })).not.toContain('(truncated)')
    expect(batchResultText('document_symbols', { symbols: [], returned: 1, count: 2, truncated: true })).toContain('symbol(s)')
    expect(batchResultText('document_symbols', { symbols: [], returned: 1, count: 1, truncated: false })).not.toContain('(truncated)')
    expect(batchResultText('hover', { hovers: [], count: 2 })).toContain('2 hover')
    expect(batchResultText('signature_help', { signatures: [{}, {}] })).toContain('2 signature')
    expect(batchResultText('other', {})).toBe('other: done')
  })

  it('renders diagnostics and code actions', () => {
    let plain = Diagnostic.create(Range.create(0, 0, 0, 1), 'plain')
    let numbered = Diagnostic.create(Range.create(1, 1, 1, 2), 'numbered', DiagnosticSeverity.Warning, 7)
    let objectCode = Diagnostic.create(Range.create(2, 0, 2, 1), 'object', 99 as DiagnosticSeverity)
    objectCode.code = { value: 'E1', target: '' } as any
    expect(diagnosticText(plain)).toBe('Error 1:1 plain')
    expect(diagnosticText(numbered)).toContain('Warning 2:2 numbered [7]')
    expect(diagnosticText(objectCode)).toContain('Unknown 3:1 object [E1]')
    expect(diagnosticsText({ items: [], total: 0, truncated: false })).toBe('No diagnostics')
    expect(diagnosticsText({ items: [plain], total: 2, truncated: true })).toContain('Truncated')
    expect(diagnosticsText({ items: [plain], total: 1, truncated: false })).not.toContain('Truncated')
    expect(codeActionsText([], { items: [], total: 0, truncated: false })).toBe('No code actions')
    let actions = [{ title: 'fix' }, { title: 'skip', disabled: { reason: 'disabled' } }]
    expect(codeActionsText(actions, { items: actions, total: 3, truncated: true })).toContain('disabled: disabled')
    expect(codeActionsText(actions, { items: actions, total: 2, truncated: false })).not.toContain('Truncated')
  })
})
