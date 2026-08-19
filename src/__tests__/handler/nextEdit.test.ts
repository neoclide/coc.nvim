import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import commands from '../../commands'
import languages from '../../languages'
import type NextEdit from '../../handler/nextEdit'
import { Disposable } from '../../util/protocol'
import { InlineCompletionTriggerKind, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import window from '../../window'
import workspace from '../../workspace'

let nextEdit: NextEdit
let disposables: Disposable[] = []
let vtextCalls: any[][] = []

before(() => {
  nextEdit = getCurrentPlugin().handler.nextEdit
})

afterEach(async t => {
  await editorReset(t)
  nextEdit.cancel()
  disposables.forEach(d => d.dispose())
  disposables = []
  vtextCalls = []
})

async function setup(t: any, lines = ['one', 'two']): Promise<any> {
  shared.updateConfiguration('nextEdit.autoTrigger', false, disposables)
  let doc = await shared.createDocument(`next-edit-${Date.now()}-${Math.random()}`)
  await workspace.nvim.call('setline', [1, lines])
  await doc.synchronize()
  await workspace.nvim.call('cursor', [1, 1])
  let originalCall = workspace.nvim.call
  t.mock.method(workspace.nvim, 'call', ((method: string, ...args: any[]) => {
    if (method === 'coc#vtext#add') {
      vtextCalls.push(args)
      return Promise.resolve(1)
    }
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

  it('renders the preview at a 1 based byte column of the edit start', async t => {
    let doc = await setup(t, ['中文one', 'two'])
    // Byte column 7 is the character index 2 position (after 中文).
    await workspace.nvim.call('cursor', [1, 7])
    register(doc, version => ({
      textDocument: { uri: doc.uri, version },
      range: Range.create(0, 2, 0, 2),
      newText: 'X'
    }))
    assert.strictEqual(await nextEdit.trigger(doc.bufnr, { autoTrigger: false }), true)
    assert.strictEqual(nextEdit.visible(), true)
    assert.strictEqual(vtextCalls.length, 1)
    // byteIndex('中文one', 2) is 6; the virtual text column must be 7.
    assert.strictEqual(vtextCalls[0][0][4].col, 7)
  })

  it('uses column 1 for an insertion at the start of a line', async t => {
    let doc = await setup(t)
    register(doc, version => ({
      textDocument: { uri: doc.uri, version },
      range: Range.create(0, 0, 0, 0),
      newText: 'X'
    }))
    assert.strictEqual(await nextEdit.trigger(doc.bufnr, { autoTrigger: false }), true)
    assert.strictEqual(nextEdit.visible(), true)
    assert.strictEqual(vtextCalls[0][0][4].col, 1)
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

  it('refuses to apply when the session is replaced during the jump', async t => {
    let doc = await setup(t)
    register(doc, version => ({
      textDocument: { uri: doc.uri, version },
      range: Range.create(1, 0, 1, 3),
      newText: ''
    }))
    // Simulate a buffer switch during jumpTo invalidating the session (e.g.
    // the target buffer closes while the request is in flight).
    t.mock.method(workspace, 'jumpTo', async () => { nextEdit.cancel() })
    assert.strictEqual(await nextEdit.trigger(doc.bufnr, { autoTrigger: false }), true)
    assert.strictEqual(nextEdit.available(), true)
    assert.strictEqual(await nextEdit.accept(), false)
    assert.strictEqual(nextEdit.available(), false)
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

  it('invalidates a preview when the document changes with autoTrigger disabled', async t => {
    let doc = await setup(t)
    register(doc, version => ({ textDocument: { uri: doc.uri, version }, range: Range.create(0, 0, 0, 0), newText: 'x' }))
    assert.strictEqual(await nextEdit.trigger(doc.bufnr, { autoTrigger: false }), true)
    assert.strictEqual(nextEdit.visible(), true)
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'changed')])
    assert.strictEqual(nextEdit.available(), false)
    assert.strictEqual(nextEdit.visible(), false)
  })

  it('aborts when the active buffer changed during the request', async t => {
    let doc = await setup(t)
    register(doc, version => ({ textDocument: { uri: doc.uri, version }, range: Range.create(0, 0, 0, 0), newText: 'x' }))
    let originalEval = workspace.nvim.eval
    t.mock.method(workspace.nvim, 'eval', ((expr: string) => {
      if (typeof expr === 'string' && expr.includes('coc#cursor#position')) {
        return Promise.resolve([doc.bufnr + 1, [0, 0]])
      }
      return originalEval.apply(workspace.nvim, [expr] as any)
    }) as any)
    assert.strictEqual(await nextEdit.trigger(doc.bufnr, { autoTrigger: false }), false)
    assert.strictEqual(nextEdit.available(), false)
  })

  it('drops a render that finishes after cancel without orphan state', async t => {
    let doc = await setup(t)
    register(doc, version => ({ textDocument: { uri: doc.uri, version }, range: Range.create(0, 0, 0, 0), newText: 'x' }))
    let originalCall = workspace.nvim.call
    let resolveAdd: (value?: unknown) => void
    t.mock.method(workspace.nvim, 'call', ((method: string, ...args: any[]) => {
      if (method === 'coc#vtext#add') {
        return new Promise(resolve => { resolveAdd = resolve })
      }
      return originalCall.apply(workspace.nvim, [method, ...args] as any)
    }) as any)
    let pending = nextEdit.trigger(doc.bufnr, { autoTrigger: false })
    await shared.waitValue(() => resolveAdd != null, true)
    nextEdit.cancel()
    resolveAdd(1)
    assert.strictEqual(await pending, true)
    assert.strictEqual(nextEdit.available(), false)
    assert.strictEqual((nextEdit as any).state, 'idle')
    assert.strictEqual((nextEdit as any).renderedBufnrs.size, 0)
  })

  it('drops a render cancelled while creating the namespace', async t => {
    let doc = await setup(t)
    register(doc, version => ({ textDocument: { uri: doc.uri, version }, range: Range.create(0, 0, 0, 0), newText: 'x' }))
    ;(nextEdit as any).namespace = undefined
    let resolveNs: (value?: unknown) => void
    t.mock.method(workspace.nvim, 'createNamespace', () => new Promise(resolve => { resolveNs = resolve }))
    let pending = nextEdit.trigger(doc.bufnr, { autoTrigger: false })
    await shared.waitValue(() => resolveNs != null, true)
    nextEdit.cancel()
    resolveNs(1)
    assert.strictEqual(await pending, true)
    assert.strictEqual(nextEdit.available(), false)
    assert.strictEqual((nextEdit as any).state, 'idle')
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

  it('triggers through the editor.action.triggerNextEdit command', async t => {
    let doc = await setup(t)
    // No provider registered yet: the command resolves to false.
    assert.strictEqual(await commands.executeCommand('editor.action.triggerNextEdit', { autoTrigger: true }), false)
    let kinds: number[] = []
    disposables.push(languages.registerNextEditProvider([{ language: '*' }], {
      provideNextEdits: (_doc, _position, option: any) => {
        kinds.push(option.triggerKind)
        return [{ textDocument: { uri: doc.uri, version: doc.version }, range: Range.create(0, 0, 0, 0), newText: 'x' }]
      }
    }))
    // The command forces autoTrigger to false regardless of the passed option.
    assert.strictEqual(await commands.executeCommand('editor.action.triggerNextEdit', { autoTrigger: true }), true)
    assert.strictEqual(nextEdit.available(), true)
    assert.deepStrictEqual(kinds, [InlineCompletionTriggerKind.Invoked])
  })

  it('reports final visibility state and disposes subscriptions', () => {
    assert.strictEqual(nextEdit.visible(), false)
    assert.strictEqual(nextEdit.available(), false)
    nextEdit.dispose()
  })
})
