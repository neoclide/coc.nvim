'use strict'
import { CodeAction, Command, DocumentSymbol, Hover, Position, Range, SignatureHelp, SymbolKind } from 'vscode-languageserver-types'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BATCH_METHODS,
  BATCH_POSITION_METHODS,
  codeActionSummary,
  configuredServiceId,
  countTextEdits,
  flattenSymbols,
  fullRange,
  hoverContents,
  hoverSummary,
  limitResults,
  locationOutputSchema,
  locationText,
  maxResultsFromArgs,
  normalizeLocations,
  positionFromArgs,
  positionInputSchema,
  queryCacheKey,
  rangeFromArgs,
  ServiceLimiter,
  signatureSummary,
  symbolKindName
} from '../../mcp/tools/lsp'
import { CancellationTokenSource } from '../../util/protocol'
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

  it('countTextEdits counts changes and documentChanges', () => {
    expect(countTextEdits({
      changes: { 'file:///a.ts': [{}, {}] },
      documentChanges: [{ edits: [{}] }]
    })).toBe(3)
    expect(countTextEdits({})).toBe(0)
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
  })

  it('batch method sets are consistent', () => {
    expect(BATCH_METHODS).toContain('hover')
    expect(BATCH_METHODS).toContain('document_symbols')
    expect(BATCH_POSITION_METHODS.has('document_symbols')).toBe(false)
    expect(BATCH_POSITION_METHODS.has('definition')).toBe(true)
  })
})
