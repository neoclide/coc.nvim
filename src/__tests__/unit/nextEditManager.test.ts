import { CancellationToken, CancellationTokenSource, InlineCompletionTriggerKind, Position, Range } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { CancellationError } from '../../util/errors'
import '../../workspace'
import NextEditManager from '../../provider/nextEditManager'

const document = TextDocument.create('file:///tmp/next-edit.ts', 'typescript', 3, 'const value = 1\n')
const context = { triggerKind: InlineCompletionTriggerKind.Automatic }
const item = (newText: string, line = 0) => ({
  textDocument: { uri: document.uri, version: document.version },
  range: Range.create(line, 0, line, 0),
  newText
})

describe('NextEditManager', () => {
  it('reports provider availability and empty results', async () => {
    let manager = new NextEditManager()
    assert.strictEqual(manager.isEmpty, true)
    let disposable = manager.register([{ language: '*' }], { provideNextEdits: () => undefined })
    assert.strictEqual(manager.isEmpty, false)
    assert.deepStrictEqual(await manager.provideNextEdits(document, Position.create(0, 0), context, CancellationToken.None), [])
    disposable.dispose()
    assert.strictEqual(manager.isEmpty, true)
  })

  it('returns empty for an unknown provider filter and ignores malformed items', async () => {
    let manager = new NextEditManager()
    manager.register([{ language: '*' }], {
      provideNextEdits: () => [null as any, 1 as any, item('valid')]
    })
    assert.deepStrictEqual(await manager.provideNextEdits(document, Position.create(0, 0), { ...context, provider: 'missing' }, CancellationToken.None), [])
    let result = await manager.provideNextEdits(document, Position.create(0, 0), context, CancellationToken.None)
    assert.deepStrictEqual(result.map(o => o.newText), ['valid'])
  })

  it('skips items without a textDocument instead of failing the request', async () => {
    let manager = new NextEditManager()
    manager.register([{ language: '*' }], {
      provideNextEdits: () => [{ newText: 'missing' } as any, { textDocument: null, range: Range.create(0, 0, 0, 0), newText: 'null' } as any, item('valid')]
    })
    let result = await manager.provideNextEdits(document, Position.create(0, 0), context, CancellationToken.None)
    assert.deepStrictEqual(result.map(o => o.newText), ['valid'])
  })

  it('keeps other provider results when one provider fails with a cancellation error', async () => {
    let manager = new NextEditManager()
    manager.register([{ language: '*' }], {
      provideNextEdits: () => { throw new CancellationError() }
    })
    manager.register([{ language: '*' }], { provideNextEdits: () => [item('survivor')] })
    let result = await manager.provideNextEdits(document, Position.create(0, 0), context, CancellationToken.None)
    assert.deepStrictEqual(result.map(o => o.newText), ['survivor'])
  })

  it('contains synchronous handleDidShowNextEdit exceptions', async () => {
    let manager = new NextEditManager()
    manager.register([{ language: '*' }], {
      provideNextEdits: () => [item('owned')],
      handleDidShowNextEdit: () => { throw new Error('sync failure') }
    })
    let result = await manager.provideNextEdits(document, Position.create(0, 0), context, CancellationToken.None)
    assert.doesNotThrow(() => manager.handleDidShow(result[0]))
  })

  it('normalizes results in registration order and deduplicates candidates', async () => {
    let manager = new NextEditManager()
    let first = item('first')
    let second = item('second', 1)
    let p1 = { provideNextEdits: async () => {
      await new Promise(resolve => setTimeout(resolve, 20))
      return { items: [first, second] }
    } }
    let p2 = { provideNextEdits: () => [second, item('third', 2)] }
    manager.register([{ language: '*' }], p1)
    manager.register([{ language: '*' }], p2)
    let result = await manager.provideNextEdits(document, Position.create(0, 0), context, CancellationToken.None)
    assert.deepStrictEqual(result.map(o => o.newText), ['first', 'second', 'third'])
  })

  it('returns no late results after cancellation', async () => {
    let manager = new NextEditManager()
    let resolve: (value: any) => void
    manager.register([{ language: '*' }], {
      provideNextEdits: () => new Promise(r => { resolve = r })
    })
    let source = new CancellationTokenSource()
    let promise = manager.provideNextEdits(document, Position.create(0, 0), context, source.token)
    source.cancel()
    resolve([item('late')])
    assert.deepStrictEqual(await promise, [])
  })

  it('returns promptly when a provider ignores cancellation', async () => {
    let manager = new NextEditManager()
    manager.register([{ language: '*' }], { provideNextEdits: () => new Promise(() => {}) })
    let source = new CancellationTokenSource()
    let promise = manager.provideNextEdits(document, Position.create(0, 0), context, source.token)
    source.cancel()
    assert.deepStrictEqual(await Promise.race([
      promise,
      new Promise(resolve => setTimeout(() => resolve('timed out'), 50))
    ]), [])
  })

  it('does not invoke a named provider outside its document selector', async () => {
    let manager = new NextEditManager()
    let called = 0
    let wrong = { provideNextEdits: () => { called++; return [item('wrong language')] } }
    let matching = { provideNextEdits: () => [item('matching language')] }
    Object.defineProperty(wrong, '__extensionName', { value: 'selected' })
    Object.defineProperty(matching, '__extensionName', { value: 'selected' })
    manager.register([{ language: 'javascript' }], wrong)
    manager.register([{ language: 'typescript' }], matching)
    let result = await manager.provideNextEdits(document, Position.create(0, 0), { ...context, provider: 'selected' }, CancellationToken.None)
    assert.deepStrictEqual(result.map(o => o.newText), ['matching language'])
    assert.strictEqual(called, 0)
  })

  it('does not call providers for an already cancelled token', async () => {
    let manager = new NextEditManager()
    let called = 0
    manager.register([{ language: '*' }], { provideNextEdits: () => { called++; return [] } })
    let source = new CancellationTokenSource()
    source.cancel()
    assert.deepStrictEqual(await manager.provideNextEdits(document, Position.create(0, 0), context, source.token), [])
    assert.strictEqual(called, 0)
  })

  it('contains provider and shown callback errors', async () => {
    let manager = new NextEditManager()
    let fail = true
    let provider = {
      provideNextEdits: () => fail ? Promise.reject(new Error('provider failure')) : [item('owned')],
      handleDidShowNextEdit: () => Promise.reject(new Error('callback failure'))
    }
    Object.defineProperty(provider, '__extensionName', { value: 'errors' })
    manager.register([{ language: '*' }], provider)
    let result = await manager.provideNextEdits(document, Position.create(0, 0), context, CancellationToken.None)
    assert.deepStrictEqual(result, [])
    manager.handleDidShow({} as any)
    fail = false
    let selected = await manager.provideNextEdits(document, Position.create(0, 0), { ...context, provider: 'errors' }, CancellationToken.None)
    manager.handleDidShow(selected[0])
    await new Promise(resolve => setImmediate(resolve))
  })

  it('filters providers and routes shown callbacks to the owner', async () => {
    let manager = new NextEditManager()
    let shown = 0
    let provider = { provideNextEdits: () => [item('owned')], handleDidShowNextEdit: () => { shown++ } }
    Object.defineProperty(provider, '__extensionName', { value: 'selected' })
    manager.register([{ language: '*' }], provider)
    manager.register([{ language: '*' }], { provideNextEdits: () => [item('other')] })
    let result = await manager.provideNextEdits(document, Position.create(0, 0), { ...context, provider: 'selected' }, CancellationToken.None)
    assert.deepStrictEqual(result.map(o => o.newText), ['owned'])
    manager.handleDidShow(result[0])
    await new Promise(resolve => setImmediate(resolve))
    assert.strictEqual(shown, 1)
  })
})
