import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import commands from '../../commands'
import languages from '../../languages'
import type NextEdit from '../../handler/nextEdit'
import { Disposable } from '../../util/protocol'
import { Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import window from '../../window'
import workspace from '../../workspace'

let nextEdit: NextEdit
let disposables: Disposable[] = []

before(() => {
  nextEdit = getCurrentPlugin().handler.nextEdit
})

afterEach(async t => {
  await editorReset(t)
  nextEdit.cancel()
  disposables.forEach(d => d.dispose())
  disposables = []
})

async function setup(t: any, lines = ['one', 'two']): Promise<any> {
  shared.updateConfiguration('nextEdit.autoTrigger', false, disposables)
  let doc = await shared.createDocument(`next-edit-${Date.now()}-${Math.random()}`)
  await workspace.nvim.call('setline', [1, lines])
  await doc.synchronize()
  await workspace.nvim.call('cursor', [1, 1])
  let originalCall = workspace.nvim.call
  t.mock.method(workspace.nvim, 'call', ((method: string, ...args: any[]) => {
    if (method === 'coc#vtext#add') return Promise.resolve(1)
    return originalCall.apply(workspace.nvim, [method, ...args] as any)
  }) as any)
  return doc
}

function register(doc: any, create: (version: number) => any): void {
  disposables.push(languages.registerNextEditProvider([{ language: '*' }], {
    provideNextEdits: () => [create(doc.version)]
  }))
}

describe('NextEdit handler', () => {
  it('rejects unavailable, disabled and empty requests', async t => {
    let doc = await setup(t)
    assert.strictEqual(await nextEdit.trigger(doc.bufnr, { autoTrigger: false }), false)
    register(doc, () => ({ textDocument: { uri: doc.uri, version: doc.version }, range: Range.create(0, 0, 0, 0), newText: '' }))
    await doc.synchronize()
    await workspace.nvim.createBuffer(doc.bufnr).setVar('coc_next_edit_disable', 1)
    assert.strictEqual(await nextEdit.trigger(doc.bufnr, { autoTrigger: false }), false)
    await workspace.nvim.createBuffer(doc.bufnr).setVar('coc_next_edit_disable', 0)
    assert.strictEqual(await nextEdit.trigger(doc.bufnr, { autoTrigger: false }), false)
    assert.strictEqual(nextEdit.available(), false)
  })

  it('previews an insertion and applies it exactly once', async t => {
    let doc = await setup(t)
    register(doc, version => ({
      textDocument: { uri: doc.uri, version },
      range: Range.create(0, 0, 0, 0),
      newText: 'X'
    }))
    assert.strictEqual(await nextEdit.trigger(doc.bufnr, { autoTrigger: false }), true)
    assert.strictEqual(nextEdit.available(), true)
    assert.strictEqual(nextEdit.visible(), true)
    let before = doc.textDocument.getText()
    assert.strictEqual(await nextEdit.accept(), true)
    assert.notStrictEqual(doc.textDocument.getText(), before)
    assert.strictEqual(doc.getline(0), 'Xone')
    assert.strictEqual(await nextEdit.accept(), false)
  })

  it('jumps before previewing an off-cursor candidate, then applies a deletion', async t => {
    let doc = await setup(t)
    register(doc, version => ({
      textDocument: { uri: doc.uri, version },
      range: Range.create(1, 0, 1, 3),
      newText: ''
    }))
    assert.strictEqual(await nextEdit.trigger(doc.bufnr, { autoTrigger: false }), true)
    assert.strictEqual(nextEdit.visible(), false)
    assert.strictEqual(await nextEdit.accept(), true)
    assert.strictEqual(nextEdit.visible(), true)
    assert.strictEqual(await nextEdit.accept(), true)
    assert.strictEqual(doc.getline(1), '')
  })

  it('switches candidates, wraps, and invokes the shown callback once', async t => {
    let doc = await setup(t)
    let shown = 0
    disposables.push(languages.registerNextEditProvider([{ language: '*' }], {
      provideNextEdits: () => [
        { textDocument: { uri: doc.uri, version: doc.version }, range: Range.create(0, 0, 0, 0), newText: 'a' },
        { textDocument: { uri: doc.uri, version: doc.version }, range: Range.create(0, 0, 0, 0), newText: 'b' },
      ],
      handleDidShowNextEdit: () => { shown++ }
    }))
    await nextEdit.trigger(doc.bufnr, { autoTrigger: false })
    assert.strictEqual(shown, 1)
    await nextEdit.next()
    assert.strictEqual(shown, 2)
    await nextEdit.next()
    await nextEdit.prev()
    assert.strictEqual(shown, 2)
  })

  it('rejects malformed, stale, invalid-range and no-op candidates', async t => {
    let doc = await setup(t)
    disposables.push(languages.registerNextEditProvider([{ language: '*' }], {
      provideNextEdits: () => [
        null as any,
        { textDocument: { uri: doc.uri, version: 'bad' }, range: Range.create(0, 0, 0, 0), newText: 'x' },
        { textDocument: { uri: doc.uri, version: doc.version }, range: Range.create(-1, 0, 0, 0), newText: 'x' },
        { textDocument: { uri: doc.uri, version: doc.version - 1 }, range: Range.create(0, 0, 0, 0), newText: 'x' },
        { textDocument: { uri: doc.uri, version: doc.version }, range: Range.create(0, 0, 0, 3), newText: 'one' },
      ]
    }))
    assert.strictEqual(await nextEdit.trigger(doc.bufnr, { autoTrigger: false }), false)
  })

  it('covers direct validation guards and unattached targets', async t => {
    let handler = nextEdit as any
    assert.strictEqual(handler.validate({}), undefined)
    assert.strictEqual(handler.validCandidate({}), false)
    await nextEdit.next()
    await nextEdit.prev()
    let doc = await setup(t)
    let uri = 'file:///tmp/next-edit-unattached.ts'
    disposables.push(languages.registerNextEditProvider([{ language: '*' }], {
      provideNextEdits: () => [{ textDocument: { uri, version: 1 }, range: Range.create(0, 0, 0, 0), newText: 'external' }]
    }))
    t.mock.method(workspace, 'jumpTo', async () => {})
    assert.strictEqual(await nextEdit.trigger(doc.bufnr, { autoTrigger: false }), true)
    assert.strictEqual(await nextEdit.accept(), false)
  })

  it('normalizes newlines and executes a command after applying', async t => {
    let doc = await setup(t)
    let executed = 0
    t.mock.method(commands, 'execute', async () => { executed++ })
    register(doc, version => ({
      textDocument: { uri: doc.uri, version },
      range: Range.create(0, 3, 0, 3),
      newText: '\r\nnext',
      command: { command: 'nextEdit.test' }
    }))
    await nextEdit.trigger(doc.bufnr, { autoTrigger: false })
    await nextEdit.accept()
    await nextEdit.accept()
    assert.strictEqual(executed, 1)
    assert.ok(doc.textDocument.getText().includes('\nnext'))
  })

  it('cancels pending requests and refuses stale preview application', async t => {
    let doc = await setup(t)
    register(doc, version => ({ textDocument: { uri: doc.uri, version }, range: Range.create(0, 0, 0, 0), newText: 'x' }))
    let pending = nextEdit.trigger(doc.bufnr, { autoTrigger: false }, 100)
    nextEdit.cancel()
    assert.strictEqual(await pending, false)
    await nextEdit.trigger(doc.bufnr, { autoTrigger: false })
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'changed')])
    assert.strictEqual(await nextEdit.accept(), false)
  })

  it('keeps the accept action with inline completion', async t => {
    let doc = await setup(t)
    register(doc, version => ({ textDocument: { uri: doc.uri, version }, range: Range.create(0, 0, 0, 0), newText: 'x' }))
    let inline = getCurrentPlugin().handler.inlineCompletion
    inline.session = {} as any
    assert.strictEqual(await nextEdit.trigger(doc.bufnr, { autoTrigger: false }), true)
    assert.strictEqual(nextEdit.visible(), false)
    assert.strictEqual(await nextEdit.accept(), false)
    inline.session = undefined
    nextEdit.cancel()
  })

  it('reports final visibility state and disposes subscriptions', () => {
    assert.strictEqual(nextEdit.visible(), false)
    assert.strictEqual(nextEdit.available(), false)
    nextEdit.dispose()
  })
})
