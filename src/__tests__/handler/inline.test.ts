import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import commands from '../../commands'
import sources from '../../completion/sources'
import completion from '../../completion'
import { CompleteOption, CompleteResult, ExtendedCompleteItem } from '../../completion/types'
import events from '../../events'
import InlineCompletion, { checkInsertedAtBeginning, formatInsertText, getInserted, getInsertText, getPumInserted, InlineSession } from '../../handler/inline'
import languages from '../../languages'
import { Disposable } from '../../util/protocol'
import window from '../../window'
import workspace from '../../workspace'
import type { Mock } from 'node:test'
import { FormattingOptions, InlineCompletionItem, Position, Range, TextEdit } from 'vscode-languageserver-types'
import { Neovim } from '@chemzqm/neovim'


let nvim: Neovim
let inlineCompletion: InlineCompletion
let disposables: Disposable[] = []

before(async () => {
  nvim = workspace.nvim
  inlineCompletion = getCurrentPlugin().handler.inlineCompletion
})

describe('InlineCompletion', () => {
  afterEach(async t => {
    await editorReset(t)
    inlineCompletion['_inserted'] = undefined
    disposables.forEach(d => d.dispose())
    disposables = []
    if (inlineCompletion.session) {
      inlineCompletion.cancel()
    }
  })

  function mockInlineInsert(returnValue: boolean, t: any): void {
    // Mock nvim calls
    let fn = nvim.call
    t.mock.method(nvim, 'call', ((method, ...args) => {
      if (method === 'coc#inline#_insert') return Promise.resolve(returnValue)
      if (method === 'coc#inline#clear') return Promise.resolve()
      return fn.apply(nvim, [method, ...args] as any)
    }) as any)
  }

  describe('events', () => {
    it('should trigger on document change', async t => {
      shared.updateConfiguration('inline.autoTrigger', true, disposables)
      await nvim.command('startinsert')
      let doc = await shared.createDocument()
      let mockProvider = t.mock.fn()
      let providerDisposable = languages.registerInlineCompletionItemProvider(
        [{ language: '*' }],
        { provideInlineCompletionItems: mockProvider }
      )
      disposables.push(providerDisposable)
      const spy = t.mock.method(inlineCompletion, 'trigger')
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'test')])
      assert.strictEqual(spy.mock.callCount(), 1)
    })

    it('should cancel on buffer unload', async t => {
      let doc = await workspace.document
      const item: InlineCompletionItem = {
        insertText: 'completion text',
        range: Range.create(0, 5, 0, 5)
      }
      inlineCompletion['bufnr'] = doc.bufnr
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 5), [item])
      const spy = t.mock.method(inlineCompletion, 'cancel')
      await nvim.command('bwipeout!')
      workspace.documentsManager.detachBuffer(doc.bufnr)
      assert.strictEqual(spy.mock.callCount(), 1)
    })

    it('should not cancel when mode changed from i to ic', async t => {
      let doc = await workspace.document
      const item: InlineCompletionItem = {
        insertText: 'completion text',
        range: Range.create(0, 5, 0, 5)
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 5), [item])
      const spy = t.mock.method(inlineCompletion, 'cancel')
      await events.fire('ModeChanged', [{ old_mode: 'i', new_mode: 'ic' }])
      assert.strictEqual(spy.mock.callCount(), 0)
    })

    it('should trigger on pum navigate', async t => {
      let doc = await workspace.document
      let providerDisposable = languages.registerInlineCompletionItemProvider(
        [{ language: '*' }],
        {
          provideInlineCompletionItems: () => {
            return Promise.resolve([{ insertText: 'bar()' }])
          }
        }
      )
      disposables.push(providerDisposable)
      disposables.push(sources.createSource({
        name: 'test',
        doComplete: (_opt: CompleteOption): Promise<CompleteResult<ExtendedCompleteItem>> => new Promise(resolve => {
          resolve({ items: [{ word: 'foo' }, { word: 'bar' }] })
        })
      }))
      let mode = await nvim.mode
      if (mode.mode !== 'i') {
        await nvim.command('startinsert')
      }
      nvim.call('coc#start', { source: 'test' }, true)
      await shared.waitPopup()
      await nvim.call('coc#pum#_navigate', [1, 1])
      await shared.waitFor('coc#inline#visible', [], 1)
      await inlineCompletion.accept(doc.bufnr)
      let line = await nvim.line
      assert.strictEqual(line, 'bar()')
      completion.cancelAndClose()
    })

    it('should accept snippet inlineCompletion on pum navigate', async t => {
      let doc = await workspace.document
      // Set up a line to work with
      await nvim.setLine('prefix ')
      await doc.patchChange()
      // Register inline completion provider that returns snippet items
      let providerDisposable = languages.registerInlineCompletionItemProvider(
        [{ language: '*' }],
        {
          provideInlineCompletionItems: () => {
            return Promise.resolve([{
              insertText: {
                value: 'snippet ${1:param1} ${2:param2}',
                kind: 'snippet'
              }
            }])
          }
        }
      )
      disposables.push(providerDisposable)
      // Create a completion source
      disposables.push(sources.createSource({
        name: 'snippet-test',
        doComplete: (_opt: CompleteOption): Promise<CompleteResult<ExtendedCompleteItem>> => new Promise(resolve => {
          resolve({ items: [{ word: 'snip' }, { word: 'snippet' }] })
        })
      }))
      // Start insert mode if not already
      let mode = await nvim.mode
      if (mode.mode !== 'i') {
        await nvim.command('startinsert')
      }
      // Move cursor to end of line
      await nvim.call('cursor', [1, 8]) // After "prefix "
      // Start completion
      nvim.call('coc#start', { source: 'snippet-test' }, true)
      await shared.waitPopup()
      // Navigate in popup to trigger inline completion
      await nvim.call('coc#pum#_navigate', [1, 1])
      await shared.waitFor('coc#inline#visible', [], 1)
      // Spy on executeCommand to check if snippet command is executed
      const executeCommandSpy = t.mock.method(commands, 'executeCommand')
      // Accept the completion
      let res = await inlineCompletion.accept(doc.bufnr)
      // Check result
      assert.strictEqual(res, true)
      // Inserting the snippet changes the document, which re-triggers inline
      // completion asynchronously. Cancel again so the assertion is not
      // racing with a newly created session.
      inlineCompletion.cancel()
      assert.strictEqual(inlineCompletion.session, undefined) // Session should be cleared
      let snippetCall = executeCommandSpy.mock.calls.find(c => c.arguments[0] === 'editor.action.insertSnippet')
      assert.ok(snippetCall)
      let snippetArg = snippetCall.arguments[1] as any
      assert.notStrictEqual(snippetArg.range, undefined)
      assert.strictEqual(snippetArg.newText, ' ${1:param1} ${2:param2}')
      // Cleanup
      await inlineCompletion.accept(doc.bufnr)
      let line = await nvim.line
      assert.strictEqual(line, 'prefix snippet param1 param2')
    })

    it('should adjust range based on _inserted in insertVtext', async t => {
      let doc = await workspace.document
      // Set up document with "prefix in" where "in" is what would be inserted by pum
      await nvim.setLine('prefix in')
      await doc.patchChange()
      // Create a completion item with range covering "in" and insertText that extends it
      const item: InlineCompletionItem = {
        insertText: 'inserted text',
        range: Range.create(0, 7, 0, 7)
      }
      // Create session with cursor at end of "in"
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 9), [item])
      // Set _inserted to simulate pum insertion
      inlineCompletion['_inserted'] = 'in'
      // Mock inline insert
      mockInlineInsert(true, t)
      // Call insertVtext
      await inlineCompletion.insertVtext(item)
      // // Verify that vtext starts after "in"
      assert.strictEqual(inlineCompletion.session.vtext, 'serted text')
      // Check that the range was adjusted in the call to coc#inline#_insert
      // The col should be 10 (byte index of position after "in" + 1)
      assert.deepStrictEqual((nvim.call as any).mock.calls[0].arguments, ['coc#inline#_insert', [doc.bufnr, 0, 10, ['serted text'], '']])
      await inlineCompletion.accept(doc.bufnr)
      let line = await nvim.line
      assert.strictEqual(line, 'prefix inserted text')
    })
  })

  describe('insertVtext()', () => {
    it('should insert virtual text successfully', async t => {
      let doc = await workspace.document
      await nvim.setLine('fooba')
      await doc.patchChange()
      const item: InlineCompletionItem = {
        insertText: 'completion text',
        range: Range.create(0, 5, 0, 5)
      }
      await inlineCompletion.insertVtext(undefined)
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 5), [item])
      mockInlineInsert(true, t)
      await inlineCompletion.insertVtext(item)
      assert.deepStrictEqual((nvim.call as any).mock.calls[0].arguments, ['coc#inline#_insert', [doc.bufnr, 0, 6, ['completion text'], '']])
      assert.strictEqual(inlineCompletion.session.vtext, 'completion text')
    })

    it('should show index when multiple items exist', async t => {
      let doc = await workspace.document
      const item1: InlineCompletionItem = { insertText: 'first' }
      const item2: InlineCompletionItem = { insertText: 'second' }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 0), [item1, item2])
      mockInlineInsert(true, t)
      await inlineCompletion.insertVtext(item1)
      assert.deepStrictEqual((nvim.call as any).mock.calls[0].arguments, ['coc#inline#_insert', [doc.bufnr, 0, 1, ['first'], '(1/2)']])
    })

    it('should handle item with non-empty range', async t => {
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'complete')])
      const item: InlineCompletionItem = {
        insertText: 'complete method()',
        range: Range.create(0, 0, 0, 8) // Assume "complete" is already typed
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 8), [item])
      mockInlineInsert(true, t)
      await inlineCompletion.insertVtext(item)
      assert.strictEqual(inlineCompletion.session.vtext, ' method()')
    })

    it('should handle cursor in middle of completion range', async t => {
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'compl()')])
      const item: InlineCompletionItem = {
        insertText: 'completeMethod()',
        range: Range.create(0, 0, 0, 7) // "compl()"
      }
      // Cursor is at "compl|()"
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 5), [item])
      mockInlineInsert(true, t)
      await inlineCompletion.insertVtext(item)
      assert.strictEqual(inlineCompletion.session.vtext, 'eteMethod')
    })

    it('should handle cursor at the end of completion range but text does not match', async t => {
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'initialText')])
      const item: InlineCompletionItem = {
        insertText: 'initialTextReplacement',
        range: Range.create(0, 0, 0, 11) // "initialText"
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 11), [item])
      mockInlineInsert(true, t)
      await inlineCompletion.insertVtext(item)
      assert.strictEqual(inlineCompletion.session.vtext, 'Replacement')
    })

    it('should handle item range where text after cursor does not match end of insertText', async t => {
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'prefixMismatchSuffix')])
      const item: InlineCompletionItem = {
        insertText: 'prefixReplacementSuffix',
        range: Range.create(0, 0, 0, 20) // "prefixMismatchSuffix"
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 6), [item])
      mockInlineInsert(true, t)
      await inlineCompletion.insertVtext(item)
      assert.strictEqual(inlineCompletion.session.vtext, 'ReplacementSuffix')
    })

    it('should clean up when insertion fails', async t => {
      let doc = await workspace.document
      const item: InlineCompletionItem = { insertText: 'text' }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 5), [item])
      mockInlineInsert(false, t)
      await inlineCompletion.insertVtext(item)
      assert.strictEqual(inlineCompletion.session, undefined)
      let visible = await inlineCompletion.visible()
      assert.strictEqual(visible, false)
    })

    it('should handle multiline completions', async t => {
      let doc = await workspace.document
      const item: InlineCompletionItem = {
        insertText: 'line1\nline2\nline3',
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 0), [item])
      mockInlineInsert(true, t)
      await inlineCompletion.insertVtext(item)
      assert.deepStrictEqual((nvim.call as any).mock.calls[0].arguments, ['coc#inline#_insert', [doc.bufnr, 0, 1, 'line1\nline2\nline3'.split('\n'), '']])
      assert.strictEqual(inlineCompletion.session.vtext, 'line1\nline2\nline3')
    })
  })

  describe('accept()', () => {
    it('should not accept when no selected item', async t => {
      let doc = await workspace.document
      const item: InlineCompletionItem = {
        insertText: 'bar',
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 3), [item], -1, 'bar')
      let res = await shared.doAction('inlineAccept', doc.bufnr, 'all')
      assert.strictEqual(res, false)
    })

    it('should accept completion and apply TextEdit', async t => {
      let doc = await workspace.document
      await nvim.setLine('foo')
      await doc.patchChange()
      const item: InlineCompletionItem = {
        insertText: 'bar',
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 3), [item], 0, 'bar')
      const applyEditsSpy = t.mock.method(doc, 'applyEdits')
      const moveToSpy = t.mock.method(window, 'moveTo')
      await inlineCompletion.accept(doc.bufnr)

      assert.deepStrictEqual(applyEditsSpy.mock.calls[0].arguments, [[TextEdit.replace(Range.create(0, 3, 0, 3), 'bar')], false, false])
      assert.deepStrictEqual(moveToSpy.mock.calls[0].arguments, [Position.create(0, 6)]) // 'foo' + 'bar'
      assert.strictEqual(inlineCompletion.session, undefined) // Session should be cleared
      const content = await doc.buffer.lines
      assert.strictEqual(content[0], 'foobar')
    })

    it('should accept completion with a specific range', async t => {
      let doc = await workspace.document
      await nvim.setLine('prefixsuffix') // prefix|suffix
      await doc.patchChange()
      const item: InlineCompletionItem = {
        insertText: 'replacement',
        range: Range.create(0, 6, 0, 6) // Replacing nothing, just inserting at cursor
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 6), [item], 0, 'replacement')
      const applyEditsSpy = t.mock.method(doc, 'applyEdits')
      const moveToSpy = t.mock.method(window, 'moveTo')
      await inlineCompletion.accept(doc.bufnr)
      // The range in item is used for TextEdit.replace
      assert.deepStrictEqual(applyEditsSpy.mock.calls[0].arguments, [[TextEdit.replace(Range.create(0, 6, 0, 6), 'replacement')], false, false])
      assert.deepStrictEqual(moveToSpy.mock.calls[0].arguments, [Position.create(0, 17)]) // prefixreplacement|suffix
      const content = await doc.buffer.lines
      assert.strictEqual(content[0], 'prefixreplacementsuffix')
    })

    it('should accept snippet completion item', async t => {
      let doc = await workspace.document
      await nvim.setLine('before')
      await doc.patchChange()
      const snippetString = 'snippet ${1:one} then ${2:two}'
      const item: InlineCompletionItem = {
        insertText: {
          kind: 'snippet',
          value: snippetString
        }
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 6), [item])
      inlineCompletion.session.vtext = 'snippet one then two' // What vtext might show
      let res = await inlineCompletion.accept(doc.bufnr)
      assert.strictEqual(inlineCompletion.session, undefined)
      assert.strictEqual(res, true)
    })

    it('should accept word as kind', async t => {
      let doc = await workspace.document
      await nvim.setLine('prefix ')
      await doc.patchChange()
      const item: InlineCompletionItem = {
        insertText: 'firstWord secondWord'
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 7), [item])
      inlineCompletion.session.vtext = 'firstWord secondWord'

      // Mock isWord
      const originalIsWord = doc.isWord
      doc.isWord = t.mock.fn(char => /[a-zA-Z]/.test(char))
      await inlineCompletion.accept(doc.bufnr, 'word')
      assert.strictEqual(inlineCompletion.session, undefined)
      const content = await doc.buffer.lines
      assert.strictEqual(content[0], 'prefix firstWord')
      doc.isWord = originalIsWord // Restore original
    })

    it('should accept word as kind with no clear word boundary', async t => {
      let doc = await workspace.document
      await nvim.setLine('prefix')
      await doc.patchChange()
      const item: InlineCompletionItem = {
        insertText: 'onlyword' // No spaces or punctuation
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 6), [item])
      inlineCompletion.session.vtext = 'onlyword'

      const originalIsWord = doc.isWord
      doc.isWord = t.mock.fn(char => /[a-zA-Z]/.test(char))

      const applyEditsSpy = t.mock.method(doc, 'applyEdits')
      await inlineCompletion.accept(doc.bufnr, 'word')

      assert.deepStrictEqual(applyEditsSpy.mock.calls[0].arguments, [[TextEdit.replace(Range.create(0, 6, 0, 6), 'onlyword')], false, false])
      const content = await doc.buffer.lines
      assert.strictEqual(content[0], 'prefixonlyword')
      doc.isWord = originalIsWord
    })

    it('should accept line as kind', async t => {
      let doc = await workspace.document
      await nvim.setLine('prefix ')
      await doc.patchChange()
      const item: InlineCompletionItem = {
        insertText: 'firstLine\nsecondLine'
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 7), [item])
      inlineCompletion.session.vtext = 'firstLine\nsecondLine'
      await inlineCompletion.accept(doc.bufnr, 'line')
      assert.strictEqual(inlineCompletion.session, undefined)
      const content = await doc.buffer.lines
      assert.strictEqual(content[0], 'prefix firstLine')
    })

    it('should accept line as kind with single line insertText', async t => {
      let doc = await workspace.document
      await nvim.setLine('prefix ')
      await doc.patchChange()
      const item: InlineCompletionItem = {
        insertText: 'singleLineText'
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 7), [item])
      inlineCompletion.session.vtext = 'singleLineText'

      const applyEditsSpy = t.mock.method(doc, 'applyEdits')
      await inlineCompletion.accept(doc.bufnr, 'line')

      assert.deepStrictEqual(applyEditsSpy.mock.calls[0].arguments, [[TextEdit.replace(Range.create(0, 7, 0, 7), 'singleLineText')], false, false])
      const content = await doc.buffer.lines
      assert.strictEqual(content[0], 'prefix singleLineText')
    })

    it('should not throw when completion command throws error', async t => {
      let doc = await workspace.document
      await nvim.setLine('test')
      await doc.patchChange()
      const item: InlineCompletionItem = {
        insertText: 'text',
        command: { command: 'test.command', title: 'Test' }
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 4), [item])
      inlineCompletion.session.vtext = 'text'
      let res = await inlineCompletion.accept(doc.bufnr)
      assert.strictEqual(inlineCompletion.session, undefined) // Session should still be cleared
      assert.strictEqual(res, true)
    })

    it('should do nothing if bufnr does not match session bufnr', async t => {
      let doc = await workspace.document
      const item: InlineCompletionItem = { insertText: 'text' }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 0), [item])
      inlineCompletion.session.vtext = 'text' // Simulate vtext is shown
      let res = await inlineCompletion.accept(doc.bufnr + 1) // Different bufnr
      assert.strictEqual(res, false)
      assert.notStrictEqual(inlineCompletion.session, undefined) // Session should not be cleared
    })
  })

  describe('trigger()', () => {
    let mockProvider: Mock<() => any>
    let providerDisposable: Disposable

    beforeEach(async (t: any) => {
      mockProvider = t.mock.fn()
      providerDisposable = languages.registerInlineCompletionItemProvider(
        [{ language: '*' }],
        { provideInlineCompletionItems: mockProvider }
      )
      disposables.push(providerDisposable)
      // Mock getCurrentState to simulate insert mode
      t.mock.method(getCurrentPlugin().handler, 'getCurrentState', async () => ({
        doc: workspace.getDocument(workspace.bufnr),
        position: Position.create(0, 0),
        mode: 'i',
        winid: 1,
      } as any))
      mockInlineInsert(true, t) // Assume inline insert will succeed for trigger tests
      await nvim.command('startinsert')
    })

    afterEach(() => {
      if (providerDisposable) providerDisposable.dispose()
    })

    it('should not trigger if no provider is registered for the document', async t => {
      providerDisposable.dispose() // Unregister the provider
      let doc = await workspace.document
      await shared.doAction('inlineTrigger', doc.bufnr)
      assert.strictEqual(mockProvider.mock.callCount(), 0)
      assert.strictEqual(inlineCompletion.session, undefined)
    })

    it('should return false when not supported', async t => {
      let doc = await workspace.document
      let spy = t.mock.method(workspace, 'has', () => false) // Simulate inline completion not supported
      let res = await inlineCompletion.trigger(doc.bufnr)
      assert.strictEqual(res, false)
      assert.strictEqual(inlineCompletion.session, undefined)
      assert.strictEqual(inlineCompletion.selected, undefined)
    })

    it('should not trigger if provider returns no items (autoTrigger: true)', async t => {
      await commands.executeCommand('editor.action.triggerInlineCompletion', { autoTrigger: true })
      assert.strictEqual(inlineCompletion.session, undefined)
    })

    it('should show warning if provider returns no items (autoTrigger: false)', async t => {
      let doc = await workspace.document
      await inlineCompletion.trigger(doc.bufnr, { autoTrigger: false })
      assert.strictEqual(inlineCompletion.session, undefined)
    })

    it('should trigger and create session if provider returns items', async t => {
      const item: InlineCompletionItem = { insertText: 'suggested' }
      mockProvider.mock.mockImplementation(async () => [item])
      let doc = await workspace.document
      await inlineCompletion.trigger(doc.bufnr)
      assert.ok(mockProvider.mock.callCount() > 0)
      assert.notStrictEqual(inlineCompletion.session, undefined)
      assert.deepStrictEqual(inlineCompletion.session.items, [item])
      assert.deepStrictEqual(inlineCompletion.session.selected, item)
    })

    it('should filter items based on range', async t => {
      const item1: InlineCompletionItem = { insertText: 'item1', range: Range.create(0, 0, 0, 1) } // Matches cursor at 0,0
      const item2: InlineCompletionItem = { insertText: 'item2', range: Range.create(0, 1, 0, 2) } // Does not match cursor at 0,0
      mockProvider.mock.mockImplementation(async () => [item1, item2])
      let doc = await workspace.document
      await inlineCompletion.trigger(doc.bufnr)
      assert.notStrictEqual(inlineCompletion.session, undefined)
      assert.deepStrictEqual(inlineCompletion.session.items, [item1])
    })

    it('should not trigger if document changed and autoTrigger is false without sync', async t => {
      const item: InlineCompletionItem = { insertText: 'suggested' }
      mockProvider.mock.mockImplementation(async () => [item])
      let doc = await workspace.document
      await nvim.call('setline', ['.', 'foobar'])
      assert.strictEqual(doc.hasChanged, true)
      const syncSpy = t.mock.method(doc, 'synchronize')
      await inlineCompletion.trigger(doc.bufnr, { autoTrigger: false })
      assert.ok(syncSpy.mock.callCount() > 0)
      assert.notStrictEqual(inlineCompletion.session, undefined) // Should still trigger after sync
    })

    it('should not trigger if token is cancelled before provider call', async t => {
      mockProvider.mock.mockImplementation(async () => [{ insertText: 'test' }])
      let doc = await workspace.document
      const triggerPromise = inlineCompletion.trigger(doc.bufnr, {}, 10) // With delay
      await shared.doAction('inlineCancel')
      await triggerPromise
      assert.strictEqual(mockProvider.mock.callCount(), 0)
      assert.strictEqual(inlineCompletion.session, undefined)
    })

    it('should not trigger if token is cancelled after provider call but before session creation', async t => {
      const item: InlineCompletionItem = { insertText: 'suggested' }
      mockProvider.mock.mockImplementation(async () => {
        inlineCompletion.cancel() // Cancel while provider is "working"
        return [item]
      })
      let doc = await workspace.document
      await inlineCompletion.trigger(doc.bufnr)
      assert.ok(mockProvider.mock.callCount() > 0)
      assert.strictEqual(inlineCompletion.session, undefined)
    })

    it('should not trigger if current state bufnr does not match', async t => {
      let doc = await shared.createDocument('foo')
      let promise = nvim.command('edit bar')
      await inlineCompletion.trigger(doc.bufnr)
      await promise
      assert.strictEqual(mockProvider.mock.callCount(), 0)
      assert.strictEqual(inlineCompletion.session, undefined)
    })

    it('should not trigger if current mode is not insert', async t => {
      await nvim.command('stopinsert')
      mockProvider.mock.mockImplementation(async () => [{ insertText: 'test' }])
      let doc = await workspace.document
      await inlineCompletion.trigger(doc.bufnr)
      assert.strictEqual(mockProvider.mock.callCount(), 0)
      assert.strictEqual(inlineCompletion.session, undefined)
    })

    it('should use specified provider if option.provider is given', async t => {
      const specificProviderMock = t.mock.fn(async () => [{ insertText: 'specific' }])
      const specificProviderDisposable = languages.registerInlineCompletionItemProvider(
        [{ language: '*' }],
        {
          provideInlineCompletionItems: specificProviderMock,
          __extensionName: 'mySpecificProvider'
        } as any,
      )
      disposables.push(specificProviderDisposable)

      let doc = await workspace.document
      await inlineCompletion.trigger(doc.bufnr, { provider: 'mySpecificProvider' })
      assert.ok(specificProviderMock.mock.callCount() > 0)
      assert.strictEqual(mockProvider.mock.callCount(), 0) // Default provider should not be called
      assert.notStrictEqual(inlineCompletion.session, undefined)
      assert.strictEqual(inlineCompletion.session.selected.insertText, 'specific')
      specificProviderDisposable.dispose()
    })
  })

  describe('next and prev', () => {
    const bufnr = 1
    const item1: InlineCompletionItem = { insertText: 'item1' }
    const item2: InlineCompletionItem = { insertText: 'item2' }
    const item3: InlineCompletionItem = { insertText: 'item3' }
    let mockInsertVtext: Mock<(...args: any[]) => any>

    const setupSession = (items: InlineCompletionItem[], initialIndex = 0, sessionBufnr = bufnr) => {
      const session = new InlineSession(sessionBufnr, Position.create(0, 0), items)
      session.index = initialIndex
      inlineCompletion.session = session
      // Simulate that a previous insertVtext call set this
      if (items.length > 0 && session.selected) {
        // To make vtextBufnr match, we need to simulate a successful insertVtext
        inlineCompletion.session.vtext = session.selected.insertText as string
      }
      return session
    }

    beforeEach((t: any) => {
      // Spy on insertVtext to check if it's called correctly without running its full logic
      mockInsertVtext = t.mock.method(inlineCompletion, 'insertVtext', async () => {})
      // Ensure vtextBufnr is reset or managed correctly per test
      if (inlineCompletion.session) inlineCompletion.session.vtext = undefined
    })

    afterEach(() => {
      inlineCompletion.session = undefined
    })

    describe('next()', () => {
      it('should do nothing if no session exists', async t => {
        inlineCompletion.session = undefined
        await inlineCompletion.next(bufnr)
        assert.strictEqual(mockInsertVtext.mock.callCount(), 0)
      })

      it('should do nothing if bufnr does not match session vtextBufnr', async t => {
        setupSession([item1, item2])
        inlineCompletion.session.vtext = undefined // Ensure vtextBufnr is -1
        await inlineCompletion.next(bufnr)
        assert.strictEqual(mockInsertVtext.mock.callCount(), 0)

        setupSession([item1, item2], 0, bufnr) // vtextBufnr will be bufnr
        await inlineCompletion.next(bufnr + 1) // Call with different bufnr
        assert.strictEqual(mockInsertVtext.mock.callCount(), 0)
      })

      it('should do nothing if session has no items', async t => {
        const session = setupSession([])
        await inlineCompletion.next(bufnr)
        assert.strictEqual(mockInsertVtext.mock.callCount(), 0)
        assert.strictEqual(session.index, 0)
      })

      it('should do nothing if session has only one item', async t => {
        const session = setupSession([item1])
        await inlineCompletion.next(bufnr)
        assert.strictEqual(mockInsertVtext.mock.callCount(), 0)
        assert.strictEqual(session.index, 0)
      })

      it('should move to the next item and call insertVtext', async t => {
        const session = setupSession([item1, item2, item3], 0)
        await inlineCompletion.next(bufnr)
        assert.strictEqual(session.index, 1)
        assert.deepStrictEqual(mockInsertVtext.mock.calls[0].arguments, [item2])
      })

      it('should loop to the first item when at the last item', async t => {
        const session = setupSession([item1, item2, item3], 2) // Start at last item
        await shared.doAction('inlineNext', bufnr)
        assert.strictEqual(session.index, 0)
        assert.deepStrictEqual(mockInsertVtext.mock.calls[0].arguments, [item1])
      })
    })

    describe('prev()', () => {
      it('should do nothing if no session exists', async t => {
        inlineCompletion.session = undefined
        await inlineCompletion.prev(bufnr)
        assert.strictEqual(mockInsertVtext.mock.callCount(), 0)
      })

      it('should do nothing if bufnr does not match session vtextBufnr', async t => {
        setupSession([item1, item2])
        inlineCompletion.session.vtext = undefined // Ensure vtextBufnr is -1
        await inlineCompletion.prev(bufnr)
        assert.strictEqual(mockInsertVtext.mock.callCount(), 0)

        setupSession([item1, item2], 0, bufnr) // vtextBufnr will be bufnr
        await inlineCompletion.prev(bufnr + 1) // Call with different bufnr
        assert.strictEqual(mockInsertVtext.mock.callCount(), 0)
      })

      it('should do nothing if session has no items', async t => {
        const session = setupSession([])
        await inlineCompletion.prev(bufnr)
        assert.strictEqual(mockInsertVtext.mock.callCount(), 0)
        assert.strictEqual(session.index, 0)
      })

      it('should do nothing if session has only one item', async t => {
        const session = setupSession([item1])
        await inlineCompletion.prev(bufnr)
        assert.strictEqual(mockInsertVtext.mock.callCount(), 0)
        assert.strictEqual(session.index, 0)
      })

      it('should move to the previous item and call insertVtext', async t => {
        const session = setupSession([item1, item2, item3], 1)
        await shared.doAction('inlinePrev', bufnr)
        assert.strictEqual(session.index, 0)
        assert.deepStrictEqual(mockInsertVtext.mock.calls[0].arguments, [item1])
      })

      it('should loop to the last item when at the first item', async t => {
        const session = setupSession([item1, item2, item3], 0) // Start at first item
        await inlineCompletion.prev(bufnr)
        assert.strictEqual(session.index, 2)
        assert.deepStrictEqual(mockInsertVtext.mock.calls[0].arguments, [item3])
      })
    })
  })

  describe('commands', () => {
    describe('document.checkInlineCompletion', () => {
      let showWarningMessageSpy: Mock<(...args: any[]) => any>
      let showInformationMessageSpy: Mock<(...args: any[]) => any>
      let getDocumentSpy: Mock<(...args: any[]) => any>
      let getProvidersSpy: Mock<(...args: any[]) => any>

      beforeEach((t: any) => {
        showWarningMessageSpy = t.mock.method(window, 'showWarningMessage', async () => {})
        showInformationMessageSpy = t.mock.method(window, 'showInformationMessage', async () => {})
        getDocumentSpy = t.mock.method(workspace, 'getDocument')
        getProvidersSpy = t.mock.method(languages.inlineCompletionItemManager, 'getProviders')
      })

      it('should show warning if inline completion is not supported', async t => {
        t.mock.method(workspace, 'has', () => false)
        await commands.executeCommand('document.checkInlineCompletion')
        let warningMsgs = showWarningMessageSpy.mock.calls.map(c => c.arguments[0] as string)
        assert.ok(warningMsgs.some(s => typeof s === 'string' && s.includes('Inline completion is not supported')))
        assert.strictEqual(showInformationMessageSpy.mock.callCount(), 0)
      })

      it('should show warning if document is not found', async t => {
        getDocumentSpy.mock.mockImplementation(() => null)
        await commands.executeCommand('document.checkInlineCompletion')
        let warningMsgs = showWarningMessageSpy.mock.calls.map(c => c.arguments[0] as string)
        assert.ok(warningMsgs.some(s => typeof s === 'string' && s.includes('not attached')))
        assert.strictEqual(showInformationMessageSpy.mock.callCount(), 0)
      })

      it('should show warning if document is not attached', async t => {
        const mockDoc = { bufnr: 1, attached: false, textDocument: {} } as any
        getDocumentSpy.mock.mockImplementation(() => mockDoc)
        await commands.executeCommand('document.checkInlineCompletion')
        let warningMsgs = showWarningMessageSpy.mock.calls.map(c => c.arguments[0] as string)
        assert.ok(warningMsgs.some(s => typeof s === 'string' && s.includes('not attached')))
        assert.strictEqual(showInformationMessageSpy.mock.callCount(), 0)
      })

      it('should show warning when disabled by b:coc_inline_disable', async t => {
        let doc = await workspace.document
        await doc.buffer.setVar('coc_inline_disable', true)
        await commands.executeCommand('document.checkInlineCompletion')
        let warningMsgs = showWarningMessageSpy.mock.calls.map(c => c.arguments[0] as string)
        assert.ok(warningMsgs.some(s => typeof s === 'string' && s.includes('disabled')))
        assert.strictEqual(showInformationMessageSpy.mock.callCount(), 0)
        doc.buffer.deleteVar('coc_inline_disable')
      })

      it('should show warning if no providers are found', async t => {
        const mockDoc = { bufnr: 1, attached: true, textDocument: {} } as any
        getDocumentSpy.mock.mockImplementation(() => mockDoc)
        getProvidersSpy.mock.mockImplementation(() => [])
        await commands.executeCommand('document.checkInlineCompletion')
        let warningMsgs = showWarningMessageSpy.mock.calls.map(c => c.arguments[0] as string)
        assert.ok(warningMsgs.some(s => typeof s === 'string' && s.includes('provider not found')))
        assert.strictEqual(showInformationMessageSpy.mock.callCount(), 0)
      })

      it('should show information message if providers are found', async t => {
        const mockDoc = { bufnr: 1, attached: true, textDocument: {} } as any
        getDocumentSpy.mock.mockImplementation(() => mockDoc)
        const mockProvider1 = { provider: { __extensionName: 'providerOne' } } as any
        const mockProvider2 = { provider: {} } as any // No __extensionName
        getProvidersSpy.mock.mockImplementation(() => [mockProvider1, mockProvider2])

        await commands.executeCommand('document.checkInlineCompletion')

        let infoMsgs = showInformationMessageSpy.mock.calls.map(c => c.arguments[0] as string)
        assert.ok(infoMsgs.includes('Inline completion is supported by providerOne, unknown.'))
        assert.strictEqual(showWarningMessageSpy.mock.callCount(), 0)
      })

      it('should show information message with single provider', async t => {
        const mockDoc = { bufnr: 1, attached: true, textDocument: {} } as any
        getDocumentSpy.mock.mockImplementation(() => mockDoc)
        const mockProvider = { provider: { __extensionName: 'myProvider' } } as any
        getProvidersSpy.mock.mockImplementation(() => [mockProvider])

        await commands.executeCommand('document.checkInlineCompletion')

        let infoMsgs = showInformationMessageSpy.mock.calls.map(c => c.arguments[0] as string)
        assert.ok(infoMsgs.includes('Inline completion is supported by myProvider.'))
        assert.strictEqual(showWarningMessageSpy.mock.callCount(), 0)
      })
    })
  })
})

// Tests for standalone functions
describe('Utility functions', () => {
  describe('formatInsertText', () => {
    it('should format text with spaces', t => {
      const text = 'line1\n  line2'
      const options: FormattingOptions = { tabSize: 2, insertSpaces: true }
      const result = formatInsertText(text, options)
      assert.strictEqual(result, 'line1\n  line2')
    })

    it('should convert tabs to spaces', t => {
      const text = 'line1\n\tline2'
      const options: FormattingOptions = { tabSize: 2, insertSpaces: true }
      const result = formatInsertText(text, options)
      assert.strictEqual(result, 'line1\n  line2')
    })

    it('should convert spaces to tabs', t => {
      const text = 'line1\n  line2'
      const options: FormattingOptions = { tabSize: 2, insertSpaces: false }
      const result = formatInsertText(text, options)
      assert.strictEqual(result, 'line1\n\tline2')
    })
  })

  describe('getPumInserted', () => {
    it('should return empty string when current line matches synced line', async t => {
      const doc = await workspace.document
      await nvim.setLine('test line')
      await doc.patchChange() // Synchronize to ensure lines match
      const cursor = Position.create(0, 5)
      const result = getPumInserted(doc, cursor)
      assert.strictEqual(result, '')
    })

    it('should return inserted text when current line differs from synced line', async t => {
      const doc = await workspace.document
      // Set the line in the buffer but don't sync document
      await nvim.setLine('test inserted line')
      // Mock the textDocument.lines to simulate a synced state that's different
      const originalLines = doc.textDocument.lines
      doc.textDocument.lines = ['test line']
      const cursor = Position.create(0, 13) // Position after "test inserted"
      const result = getPumInserted(doc, cursor)
      // Restore original lines
      doc.textDocument.lines = originalLines
      assert.strictEqual(result, ' inserted')
    })

    it('should return undefined when no valid insertion is detected', async t => {
      const doc = await workspace.document
      // Current line is completely different, not just an insertion
      await nvim.setLine('completely different')
      // Mock the textDocument.lines to simulate a synced state
      const originalLines = doc.textDocument.lines
      doc.textDocument.lines = ['original text']
      const cursor = Position.create(0, 10)
      const result = getPumInserted(doc, cursor)
      // Restore original lines
      doc.textDocument.lines = originalLines
      assert.strictEqual(result, undefined)
    })

    it('should handle cursor at beginning of line', async t => {
      const doc = await workspace.document
      await nvim.setLine('prefix original')
      const originalLines = doc.textDocument.lines
      doc.textDocument.lines = ['original']
      const cursor = Position.create(0, 7) // Position after "prefix "
      const result = getPumInserted(doc, cursor)
      doc.textDocument.lines = originalLines
      assert.strictEqual(result, 'prefix ')
    })

    it('should handle cursor at end of line', async t => {
      const doc = await workspace.document
      await nvim.setLine('original suffix')
      const originalLines = doc.textDocument.lines
      doc.textDocument.lines = ['original']
      const cursor = Position.create(0, 15) // End of "original suffix"
      const result = getPumInserted(doc, cursor)
      doc.textDocument.lines = originalLines
      assert.strictEqual(result, ' suffix')
    })
  })

  describe('getInsertText', () => {
    it('should handle plain text', t => {
      const item: InlineCompletionItem = {
        insertText: 'plain text'
      }
      const options: FormattingOptions = { tabSize: 2, insertSpaces: true }
      const result = getInsertText(item, options)
      assert.strictEqual(result, 'plain text')
    })

    it('should handle snippet text', t => {
      const item: InlineCompletionItem = {
        insertText: {
          value: 'snippet ${1:text}',
          kind: 'snippet'
        },
      }
      const options: FormattingOptions = { tabSize: 2, insertSpaces: true }
      const result = getInsertText(item, options)
      assert.strictEqual(result, 'snippet text')
    })
  })

  describe('getInserted', () => {
    it('should return undefined when current string is shorter than synced string', t => {
      const curr = 'foo'
      const synced = 'foobar'
      const character = 3
      const result = getInserted(curr, synced, character)
      assert.strictEqual(result, undefined)
    })

    it('should return undefined when text after cursor does not match end of synced string', t => {
      const curr = 'fooXYZ'
      const synced = 'foobar'
      const character = 3
      const result = getInserted(curr, synced, character)
      assert.strictEqual(result, undefined)
    })

    it('should return undefined when beginning of current does not match beginning of synced', t => {
      const curr = 'abcbar'
      const synced = 'foobar'
      const character = 3
      const result = getInserted(curr, synced, character)
      assert.strictEqual(result, undefined)
    })

    it('should identify simple insertion in the middle', t => {
      const curr = 'fooinsertedbartexthere'
      const synced = 'foobartexthere'
      const character = 11 // Position after "fooinserted"
      const result = getInserted(curr, synced, character)
      assert.deepStrictEqual(result, { start: 3, text: 'inserted' })
    })

    it('should identify insertion at the end', t => {
      const curr = 'foobarappended'
      const synced = 'foobar'
      const character = 14 // Position at the end of curr
      const result = getInserted(curr, synced, character)
      assert.deepStrictEqual(result, { start: 6, text: 'appended' })
    })

    it('should identify insertion at the beginning', t => {
      const curr = 'prefixfoobar'
      const synced = 'foobar'
      const character = 6 // Position after "prefix"
      const result = getInserted(curr, synced, character)
      assert.deepStrictEqual(result, { start: 0, text: 'prefix' })
    })

    it('should handle insertion with special characters', t => {
      const curr = 'foo\t\n🚀bar'
      const synced = 'foobar'
      const character = 7 // After special chars (note emoji is a single character)
      const result = getInserted(curr, synced, character)
      assert.deepStrictEqual(result, { start: 3, text: '\t\n🚀' })
    })

    it('should handle empty insertion', t => {
      const curr = 'foobar'
      const synced = 'foobar'
      const character = 3 // Position in the middle, but no change
      const result = getInserted(curr, synced, character)
      assert.deepStrictEqual(result, { start: 3, text: '' })
    })
  })

  describe('checkInsertedAtBeginning', () => {
    it('should return true when item has no range and insertText starts with inserted string', t => {
      const currentLine = 'some text'
      const triggerCharacter = 4
      const inserted = 'comp'
      const item: InlineCompletionItem = {
        insertText: 'completion'
      }
      const result = checkInsertedAtBeginning(currentLine, triggerCharacter, inserted, item)
      assert.strictEqual(result, true)
    })

    it('should return false when item has no range and insertText does not start with inserted string', t => {
      const currentLine = 'some text'
      const triggerCharacter = 4
      const inserted = 'diff'
      const item: InlineCompletionItem = {
        insertText: 'completion'
      }
      const result = checkInsertedAtBeginning(currentLine, triggerCharacter, inserted, item)
      assert.strictEqual(result, false)
    })

    it('should return true when item has no range and snippet value starts with inserted string', t => {
      const currentLine = 'some text'
      const triggerCharacter = 4
      const inserted = 'comp'
      const item: InlineCompletionItem = {
        insertText: {
          value: 'completion ${1:param}',
          kind: 'snippet'
        }
      }
      const result = checkInsertedAtBeginning(currentLine, triggerCharacter, inserted, item)
      assert.strictEqual(result, true)
    })

    it('should return false when item has no range and snippet value does not start with inserted string', t => {
      const currentLine = 'some text'
      const triggerCharacter = 4
      const inserted = 'diff'
      const item: InlineCompletionItem = {
        insertText: {
          value: 'completion ${1:param}',
          kind: 'snippet'
        }
      }
      const result = checkInsertedAtBeginning(currentLine, triggerCharacter, inserted, item)
      assert.strictEqual(result, false)
    })

    it('should return true when item has range and current line portion matches start of insertText', t => {
      const currentLine = 'prefix completion suffix'
      const triggerCharacter = 10 // After "prefix com"
      const inserted = 'com'
      const item: InlineCompletionItem = {
        insertText: 'completion',
        range: Range.create(0, 7, 0, 16) // "completion"
      }
      const result = checkInsertedAtBeginning(currentLine, triggerCharacter, inserted, item)
      assert.strictEqual(result, true)
    })

    it('should return false when item has range and current line portion does not match start of insertText', t => {
      const currentLine = 'prefix different suffix'
      const triggerCharacter = 10 // After "prefix dif"
      const inserted = 'dif'
      const item: InlineCompletionItem = {
        insertText: 'completion',
        range: Range.create(0, 7, 0, 16) // "different"
      }
      const result = checkInsertedAtBeginning(currentLine, triggerCharacter, inserted, item)
      assert.strictEqual(result, false)
    })

    it('should return true when item has range and current line portion matches start of snippet value', t => {
      const currentLine = 'prefix completion suffix'
      const triggerCharacter = 10 // After "prefix com"
      const inserted = 'com'
      const item: InlineCompletionItem = {
        insertText: {
          value: 'completion ${1:param}',
          kind: 'snippet'
        },
        range: Range.create(0, 7, 0, 16) // "completion"
      }
      const result = checkInsertedAtBeginning(currentLine, triggerCharacter, inserted, item)
      assert.strictEqual(result, true)
    })

    it('should handle case with empty inserted string', t => {
      const currentLine = 'prefix'
      const triggerCharacter = 6
      const inserted = ''
      const item: InlineCompletionItem = {
        insertText: 'completion'
      }
      const result = checkInsertedAtBeginning(currentLine, triggerCharacter, inserted, item)
      assert.strictEqual(result, true) // Empty string is always at beginning
    })

    it('should handle special characters in inserted string', t => {
      const currentLine = 'prefix\t\n🚀completion'
      const triggerCharacter = 6 // After the emoji
      const inserted = '\t\n🚀'
      const item: InlineCompletionItem = {
        insertText: '\t\n🚀suffix',
        range: Range.create(0, 6, 0, 9)
      }
      const result = checkInsertedAtBeginning(currentLine, triggerCharacter, inserted, item)
      assert.strictEqual(result, true)
    })
  })

  describe('dispose()', () => {
    it('disposes the visibility emitter and subscriptions', () => {
      inlineCompletion.dispose()
    })
  })
})
