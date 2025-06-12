import { Neovim } from '@chemzqm/neovim'
import { FormattingOptions, InlineCompletionItem, Position, Range, TextEdit } from 'vscode-languageserver-types'
import commands from '../../commands'
import sources from '../../completion/sources'
import { CompleteOption, CompleteResult, ExtendedCompleteItem } from '../../completion/types'
import events from '../../events'
import InlineCompletion, { checkInsertedAtBeginning, formatInsertText, getInserted, getInsertText, getPumInserted, InlineSession } from '../../handler/inline'
import languages from '../../languages'
import { Disposable } from '../../util/protocol'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let inlineCompletion: InlineCompletion
let disposables: Disposable[] = []

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  inlineCompletion = helper.plugin.handler.inlineCompletion
})

afterAll(async () => {
  await helper.shutdown()
})

describe('InlineCompletion', () => {
  afterEach(async () => {
    jest.clearAllMocks()
    inlineCompletion['_inserted'] = undefined
    await helper.reset()
    disposables.forEach(d => d.dispose())
    disposables = []
    if (inlineCompletion.session) {
      inlineCompletion.cancel()
    }
  })

  function mockInlineInsert(returnValue: boolean): void {
    // Mock nvim calls
    let fn = nvim.call
    nvim.call = jest.fn().mockImplementation((method, ...args) => {
      if (method === 'coc#inline#_insert') return Promise.resolve(returnValue)
      if (method === 'coc#inline#clear') return Promise.resolve()
      return fn.apply(nvim, [method, ...args] as any)
    })
  }

  describe('events', () => {
    it('should trigger on document change', async () => {
      helper.updateConfiguration('inline.autoTrigger', true, disposables)
      await nvim.command('startinsert')
      let doc = await helper.createDocument()
      let mockProvider = jest.fn()
      let providerDisposable = languages.registerInlineCompletionItemProvider(
        [{ language: '*' }],
        { provideInlineCompletionItems: mockProvider }
      )
      disposables.push(providerDisposable)
      const spy = jest.spyOn(inlineCompletion, 'trigger')
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'test')])
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('should cancel on buffer unload', async () => {
      let doc = await workspace.document
      const item: InlineCompletionItem = {
        insertText: 'completion text',
        range: Range.create(0, 5, 0, 5)
      }
      inlineCompletion['bufnr'] = doc.bufnr
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 5), [item])
      const spy = jest.spyOn(inlineCompletion, 'cancel')
      await nvim.command('bwipeout!')
      workspace.documentsManager.detachBuffer(doc.bufnr)
      expect(spy).toHaveBeenCalledTimes(1)
    })

    it('should not cancel when mode changed from i to ic', async () => {
      let doc = await workspace.document
      const item: InlineCompletionItem = {
        insertText: 'completion text',
        range: Range.create(0, 5, 0, 5)
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 5), [item])
      const spy = jest.spyOn(inlineCompletion, 'cancel')
      await events.fire('ModeChanged', [{ old_mode: 'i', new_mode: 'ic' }])
      expect(spy).not.toHaveBeenCalled()
    })

    it('should trigger on pum navigate', async () => {
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
      await helper.waitPopup()
      await nvim.call('coc#pum#_navigate', [1, 1])
      await helper.waitFor('coc#inline#visible', [], 1)
      await inlineCompletion.accept(doc.bufnr)
      let line = await nvim.line
      expect(line).toBe('bar()')
    })

    it('should accept snippet inlineCompletion on pum navigate', async () => {
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
      await helper.waitPopup()
      // Navigate in popup to trigger inline completion
      await nvim.call('coc#pum#_navigate', [1, 1])
      await helper.waitFor('coc#inline#visible', [], 1)
      // Spy on executeCommand to check if snippet command is executed
      const executeCommandSpy = jest.spyOn(commands, 'executeCommand')
      // Accept the completion
      let res = await inlineCompletion.accept(doc.bufnr)
      // Check result
      expect(res).toBe(true)
      expect(inlineCompletion.session).toBeUndefined() // Session should be cleared
      expect(executeCommandSpy).toHaveBeenCalledWith(
        'editor.action.insertSnippet',
        expect.objectContaining({
          range: expect.any(Object),
          newText: ' ${1:param1} ${2:param2}'
        })
      )
      // Cleanup
      executeCommandSpy.mockRestore()
      await inlineCompletion.accept(doc.bufnr)
      let line = await nvim.line
      expect(line).toBe('prefix snippet param1 param2')
    })

    it('should adjust range based on _inserted in insertVtext', async () => {
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
      mockInlineInsert(true)
      // Call insertVtext
      await inlineCompletion.insertVtext(item)
      // // Verify that vtext starts after "in"
      expect(inlineCompletion.session.vtext).toBe('serted text')
      // Check that the range was adjusted in the call to coc#inline#_insert
      // The col should be 10 (byte index of position after "in" + 1)
      expect(nvim.call).toHaveBeenCalledWith(
        'coc#inline#_insert',
        [doc.bufnr, 0, 10, ['serted text'], '']
      )
      await inlineCompletion.accept(doc.bufnr)
      let line = await nvim.line
      expect(line).toBe('prefix inserted text')
    })
  })

  describe('insertVtext()', () => {
    it('should insert virtual text successfully', async () => {
      let doc = await workspace.document
      await nvim.setLine('fooba')
      await doc.patchChange()
      const item: InlineCompletionItem = {
        insertText: 'completion text',
        range: Range.create(0, 5, 0, 5)
      }
      await inlineCompletion.insertVtext(undefined)
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 5), [item])
      mockInlineInsert(true)
      await inlineCompletion.insertVtext(item)
      expect(nvim.call).toHaveBeenCalledWith(
        'coc#inline#_insert',
        [doc.bufnr, 0, 6, ['completion text'], '']
      )
      expect(inlineCompletion.session.vtext).toBe('completion text')
    })

    it('should show index when multiple items exist', async () => {
      let doc = await workspace.document
      const item1: InlineCompletionItem = { insertText: 'first' }
      const item2: InlineCompletionItem = { insertText: 'second' }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 0), [item1, item2])
      mockInlineInsert(true)
      await inlineCompletion.insertVtext(item1)
      expect(nvim.call).toHaveBeenCalledWith(
        'coc#inline#_insert',
        [doc.bufnr, 0, 1, ['first'], '(1/2)']
      )
    })

    it('should handle item with non-empty range', async () => {
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'complete')])
      const item: InlineCompletionItem = {
        insertText: 'complete method()',
        range: Range.create(0, 0, 0, 8) // Assume "complete" is already typed
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 8), [item])
      mockInlineInsert(true)
      await inlineCompletion.insertVtext(item)
      expect(inlineCompletion.session.vtext).toBe(' method()')
    })

    it('should handle cursor in middle of completion range', async () => {
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'compl()')])
      const item: InlineCompletionItem = {
        insertText: 'completeMethod()',
        range: Range.create(0, 0, 0, 7) // "compl()"
      }
      // Cursor is at "compl|()"
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 5), [item])
      mockInlineInsert(true)
      await inlineCompletion.insertVtext(item)
      expect(inlineCompletion.session.vtext).toBe('eteMethod')
    })

    it('should handle cursor at the end of completion range but text does not match', async () => {
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'initialText')])
      const item: InlineCompletionItem = {
        insertText: 'initialTextReplacement',
        range: Range.create(0, 0, 0, 11) // "initialText"
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 11), [item])
      mockInlineInsert(true)
      await inlineCompletion.insertVtext(item)
      expect(inlineCompletion.session.vtext).toBe('Replacement')
    })

    it('should handle item range where text after cursor does not match end of insertText', async () => {
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'prefixMismatchSuffix')])
      const item: InlineCompletionItem = {
        insertText: 'prefixReplacementSuffix',
        range: Range.create(0, 0, 0, 20) // "prefixMismatchSuffix"
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 6), [item])
      mockInlineInsert(true)
      await inlineCompletion.insertVtext(item)
      expect(inlineCompletion.session.vtext).toBe('ReplacementSuffix')
    })

    it('should clean up when insertion fails', async () => {
      let doc = await workspace.document
      const item: InlineCompletionItem = { insertText: 'text' }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 5), [item])
      mockInlineInsert(false)
      await inlineCompletion.insertVtext(item)
      expect(inlineCompletion.session).toBeUndefined()
      let visible = await inlineCompletion.visible()
      expect(visible).toBe(false)
    })

    it('should handle multiline completions', async () => {
      let doc = await workspace.document
      const item: InlineCompletionItem = {
        insertText: 'line1\nline2\nline3',
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 0), [item])
      mockInlineInsert(true)
      await inlineCompletion.insertVtext(item)
      expect(nvim.call).toHaveBeenCalledWith(
        'coc#inline#_insert',
        [doc.bufnr, 0, 1, 'line1\nline2\nline3'.split('\n'), ""]
      )
      expect(inlineCompletion.session.vtext).toBe('line1\nline2\nline3')
    })
  })

  describe('accept()', () => {
    it('should not accept when no selected item', async () => {
      let doc = await workspace.document
      const item: InlineCompletionItem = {
        insertText: 'bar',
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 3), [item], -1, 'bar')
      let res = await helper.doAction('inlineAccept', doc.bufnr, 'all')
      expect(res).toBe(false)
    })

    it('should accept completion and apply TextEdit', async () => {
      let doc = await workspace.document
      await nvim.setLine('foo')
      await doc.patchChange()
      const item: InlineCompletionItem = {
        insertText: 'bar',
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 3), [item], 0, 'bar')
      const applyEditsSpy = jest.spyOn(doc, 'applyEdits')
      const moveToSpy = jest.spyOn(window, 'moveTo')
      await inlineCompletion.accept(doc.bufnr)

      expect(applyEditsSpy).toHaveBeenCalledWith(
        [TextEdit.replace(Range.create(0, 3, 0, 3), 'bar')],
        false,
        false
      )
      expect(moveToSpy).toHaveBeenCalledWith(Position.create(0, 6)) // 'foo' + 'bar'
      expect(inlineCompletion.session).toBeUndefined() // Session should be cleared
      const content = await doc.buffer.lines
      expect(content[0]).toBe('foobar')
    })

    it('should accept completion with a specific range', async () => {
      let doc = await workspace.document
      await nvim.setLine('prefixsuffix') // prefix|suffix
      await doc.patchChange()
      const item: InlineCompletionItem = {
        insertText: 'replacement',
        range: Range.create(0, 6, 0, 6) // Replacing nothing, just inserting at cursor
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 6), [item], 0, 'replacement')
      const applyEditsSpy = jest.spyOn(doc, 'applyEdits')
      const moveToSpy = jest.spyOn(window, 'moveTo')
      await inlineCompletion.accept(doc.bufnr)
      // The range in item is used for TextEdit.replace
      expect(applyEditsSpy).toHaveBeenCalledWith(
        [TextEdit.replace(Range.create(0, 6, 0, 6), 'replacement')],
        false,
        false
      )
      expect(moveToSpy).toHaveBeenCalledWith(Position.create(0, 17)) // prefixreplacement|suffix
      const content = await doc.buffer.lines
      expect(content[0]).toBe('prefixreplacementsuffix')
    })

    it('should accept snippet completion item', async () => {
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
      expect(inlineCompletion.session).toBeUndefined()
      expect(res).toBe(true)
    })

    it('should accept word as kind', async () => {
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
      doc.isWord = jest.fn(char => /[a-zA-Z]/.test(char))
      await inlineCompletion.accept(doc.bufnr, 'word')
      expect(inlineCompletion.session).toBeUndefined()
      const content = await doc.buffer.lines
      expect(content[0]).toBe('prefix firstWord')
      doc.isWord = originalIsWord // Restore original
    })

    it('should accept word as kind with no clear word boundary', async () => {
      let doc = await workspace.document
      await nvim.setLine('prefix')
      await doc.patchChange()
      const item: InlineCompletionItem = {
        insertText: 'onlyword' // No spaces or punctuation
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 6), [item])
      inlineCompletion.session.vtext = 'onlyword'

      const originalIsWord = doc.isWord
      doc.isWord = jest.fn(char => /[a-zA-Z]/.test(char))

      const applyEditsSpy = jest.spyOn(doc, 'applyEdits')
      await inlineCompletion.accept(doc.bufnr, 'word')

      expect(applyEditsSpy).toHaveBeenCalledWith(
        [TextEdit.replace(Range.create(0, 6, 0, 6), 'onlyword')],
        false,
        false
      )
      const content = await doc.buffer.lines
      expect(content[0]).toBe('prefixonlyword')
      doc.isWord = originalIsWord
    })

    it('should accept line as kind', async () => {
      let doc = await workspace.document
      await nvim.setLine('prefix ')
      await doc.patchChange()
      const item: InlineCompletionItem = {
        insertText: 'firstLine\nsecondLine'
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 7), [item])
      inlineCompletion.session.vtext = 'firstLine\nsecondLine'
      await inlineCompletion.accept(doc.bufnr, 'line')
      expect(inlineCompletion.session).toBeUndefined()
      const content = await doc.buffer.lines
      expect(content[0]).toBe('prefix firstLine')
    })

    it('should accept line as kind with single line insertText', async () => {
      let doc = await workspace.document
      await nvim.setLine('prefix ')
      await doc.patchChange()
      const item: InlineCompletionItem = {
        insertText: 'singleLineText'
      }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 7), [item])
      inlineCompletion.session.vtext = 'singleLineText'

      const applyEditsSpy = jest.spyOn(doc, 'applyEdits')
      await inlineCompletion.accept(doc.bufnr, 'line')

      expect(applyEditsSpy).toHaveBeenCalledWith(
        [TextEdit.replace(Range.create(0, 7, 0, 7), 'singleLineText')],
        false,
        false
      )
      const content = await doc.buffer.lines
      expect(content[0]).toBe('prefix singleLineText')
    })

    it('should not throw when completion command throws error', async () => {
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
      expect(inlineCompletion.session).toBeUndefined() // Session should still be cleared
      expect(res).toBe(true)
    })

    it('should do nothing if bufnr does not match session bufnr', async () => {
      let doc = await workspace.document
      const item: InlineCompletionItem = { insertText: 'text' }
      inlineCompletion.session = new InlineSession(doc.bufnr, Position.create(0, 0), [item])
      inlineCompletion.session.vtext = 'text' // Simulate vtext is shown
      let res = await inlineCompletion.accept(doc.bufnr + 1) // Different bufnr
      expect(res).toBe(false)
      expect(inlineCompletion.session).toBeDefined() // Session should not be cleared
    })
  })

  describe('trigger()', () => {
    let mockProvider: jest.Mock
    let providerDisposable: Disposable

    beforeEach(() => {
      mockProvider = jest.fn()
      providerDisposable = languages.registerInlineCompletionItemProvider(
        [{ language: '*' }],
        { provideInlineCompletionItems: mockProvider }
      )
      disposables.push(providerDisposable)
      // Mock getCurrentState to simulate insert mode
      jest.spyOn(helper.plugin.handler, 'getCurrentState').mockResolvedValue({
        doc: workspace.getDocument(workspace.bufnr),
        position: Position.create(0, 0),
        mode: 'i',
        winid: 1,
      } as any)
      mockInlineInsert(true) // Assume inline insert will succeed for trigger tests
    })

    afterEach(() => {
      if (providerDisposable) providerDisposable.dispose()
    })

    it('should not trigger if no provider is registered for the document', async () => {
      providerDisposable.dispose() // Unregister the provider
      let doc = await workspace.document
      await helper.doAction('inlineTrigger', doc.bufnr)
      expect(mockProvider).not.toHaveBeenCalled()
      expect(inlineCompletion.session).toBeUndefined()
    })

    it('should return false when not supported', async () => {
      let doc = await workspace.document
      let spy = jest.spyOn(workspace, 'has').mockReturnValue(false) // Simulate inline completion not supported
      let res = await inlineCompletion.trigger(doc.bufnr)
      expect(res).toBe(false)
      expect(inlineCompletion.session).toBeUndefined()
      expect(inlineCompletion.selected).toBeUndefined()
      spy.mockRestore()
    })

    it('should not trigger if provider returns no items (autoTrigger: true)', async () => {
      mockProvider.mockResolvedValue([])
      const spy = jest.spyOn(window, 'showWarningMessage')
      await commands.executeCommand('editor.action.triggerInlineCompletion', { autoTrigger: true })
      expect(mockProvider).toHaveBeenCalled()
      expect(inlineCompletion.session).toBeUndefined()
      expect(spy).not.toHaveBeenCalled() // No warning for autoTrigger
    })

    it('should show warning if provider returns no items (autoTrigger: false)', async () => {
      mockProvider.mockResolvedValue([])
      let doc = await workspace.document
      const spy = jest.spyOn(window, 'showWarningMessage')
      await inlineCompletion.trigger(doc.bufnr, { autoTrigger: false })
      expect(mockProvider).toHaveBeenCalled()
      expect(inlineCompletion.session).toBeUndefined()
      expect(spy).toHaveBeenCalledWith('No inline completion items from provider.')
    })

    it('should trigger and create session if provider returns items', async () => {
      const item: InlineCompletionItem = { insertText: 'suggested' }
      mockProvider.mockResolvedValue([item])
      let doc = await workspace.document
      await inlineCompletion.trigger(doc.bufnr)
      expect(mockProvider).toHaveBeenCalled()
      expect(inlineCompletion.session).toBeDefined()
      expect(inlineCompletion.session.items).toEqual([item])
      expect(inlineCompletion.session.selected).toEqual(item)
    })

    it('should filter items based on range', async () => {
      const item1: InlineCompletionItem = { insertText: 'item1', range: Range.create(0, 0, 0, 1) } // Matches cursor at 0,0
      const item2: InlineCompletionItem = { insertText: 'item2', range: Range.create(0, 1, 0, 2) } // Does not match cursor at 0,0
      mockProvider.mockResolvedValue([item1, item2])
      let doc = await workspace.document
      await inlineCompletion.trigger(doc.bufnr)
      expect(inlineCompletion.session).toBeDefined()
      expect(inlineCompletion.session.items).toEqual([item1])
    })

    it('should not trigger if document changed and autoTrigger is false without sync', async () => {
      const item: InlineCompletionItem = { insertText: 'suggested' }
      mockProvider.mockResolvedValue([item])
      let doc = await workspace.document
      await nvim.call('setline', ['.', 'foobar'])
      expect(doc.hasChanged).toBe(true)
      const syncSpy = jest.spyOn(doc, 'synchronize')
      await inlineCompletion.trigger(doc.bufnr, { autoTrigger: false })
      expect(syncSpy).toHaveBeenCalled()
      expect(inlineCompletion.session).toBeDefined() // Should still trigger after sync
    })

    it('should not trigger if token is cancelled before provider call', async () => {
      mockProvider.mockResolvedValue([{ insertText: 'test' }])
      let doc = await workspace.document
      const triggerPromise = inlineCompletion.trigger(doc.bufnr, {}, 10) // With delay
      await helper.doAction('inlineCancel')
      await triggerPromise
      expect(mockProvider).not.toHaveBeenCalled()
      expect(inlineCompletion.session).toBeUndefined()
    })

    it('should not trigger if token is cancelled after provider call but before session creation', async () => {
      const item: InlineCompletionItem = { insertText: 'suggested' }
      mockProvider.mockImplementation(async () => {
        inlineCompletion.cancel() // Cancel while provider is "working"
        return [item]
      })
      let doc = await workspace.document
      await inlineCompletion.trigger(doc.bufnr)
      expect(mockProvider).toHaveBeenCalled()
      expect(inlineCompletion.session).toBeUndefined()
    })

    it('should not trigger if current state bufnr does not match', async () => {
      mockProvider.mockResolvedValue([{ insertText: 'test' }])
      let prev = await helper.createDocument('foo')
      let doc = await helper.createDocument('bar')
      jest.spyOn(helper.plugin.handler, 'getCurrentState').mockResolvedValueOnce({
        doc: prev,
        position: Position.create(0, 0),
        mode: 'i',
        winid: 1,
      } as any)
      await inlineCompletion.trigger(doc.bufnr)
      expect(mockProvider).not.toHaveBeenCalled() // Provider call is guarded by state check
      expect(inlineCompletion.session).toBeUndefined()
    })

    it('should not trigger if current mode is not insert', async () => {
      mockProvider.mockResolvedValue([{ insertText: 'test' }])
      let doc = await workspace.document
      jest.spyOn(helper.plugin.handler, 'getCurrentState').mockResolvedValueOnce({
        doc: workspace.getDocument(doc.bufnr),
        position: Position.create(0, 0),
        mode: 'n', // Not insert mode
        winid: 1,
      } as any)
      await inlineCompletion.trigger(doc.bufnr)
      expect(mockProvider).not.toHaveBeenCalled()
      expect(inlineCompletion.session).toBeUndefined()
    })

    it('should use specified provider if option.provider is given', async () => {
      const specificProviderMock = jest.fn().mockResolvedValue([{ insertText: 'specific' }])
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
      expect(specificProviderMock).toHaveBeenCalled()
      expect(mockProvider).not.toHaveBeenCalled() // Default provider should not be called
      expect(inlineCompletion.session).toBeDefined()
      expect(inlineCompletion.session.selected.insertText).toBe('specific')
      specificProviderDisposable.dispose()
    })
  })

  describe('next and prev', () => {
    const bufnr = 1
    const item1: InlineCompletionItem = { insertText: 'item1' }
    const item2: InlineCompletionItem = { insertText: 'item2' }
    const item3: InlineCompletionItem = { insertText: 'item3' }
    let mockInsertVtext: jest.SpyInstance

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

    beforeEach(() => {
      // Spy on insertVtext to check if it's called correctly without running its full logic
      mockInsertVtext = jest.spyOn(inlineCompletion, 'insertVtext').mockResolvedValue(undefined)
      // Ensure vtextBufnr is reset or managed correctly per test
      if (inlineCompletion.session) inlineCompletion.session.vtext = undefined
    })

    afterEach(() => {
      mockInsertVtext.mockRestore()
      inlineCompletion.session = undefined
    })

    describe('next()', () => {
      it('should do nothing if no session exists', async () => {
        inlineCompletion.session = undefined
        await inlineCompletion.next(bufnr)
        expect(mockInsertVtext).not.toHaveBeenCalled()
      })

      it('should do nothing if bufnr does not match session vtextBufnr', async () => {
        setupSession([item1, item2])
        inlineCompletion.session.vtext = undefined // Ensure vtextBufnr is -1
        await inlineCompletion.next(bufnr)
        expect(mockInsertVtext).not.toHaveBeenCalled()

        setupSession([item1, item2], 0, bufnr) // vtextBufnr will be bufnr
        await inlineCompletion.next(bufnr + 1) // Call with different bufnr
        expect(mockInsertVtext).not.toHaveBeenCalled()
      })

      it('should do nothing if session has no items', async () => {
        const session = setupSession([])
        await inlineCompletion.next(bufnr)
        expect(mockInsertVtext).not.toHaveBeenCalled()
        expect(session.index).toBe(0)
      })

      it('should do nothing if session has only one item', async () => {
        const session = setupSession([item1])
        await inlineCompletion.next(bufnr)
        expect(mockInsertVtext).not.toHaveBeenCalled()
        expect(session.index).toBe(0)
      })

      it('should move to the next item and call insertVtext', async () => {
        const session = setupSession([item1, item2, item3], 0)
        await inlineCompletion.next(bufnr)
        expect(session.index).toBe(1)
        expect(mockInsertVtext).toHaveBeenCalledWith(item2)
      })

      it('should loop to the first item when at the last item', async () => {
        const session = setupSession([item1, item2, item3], 2) // Start at last item
        await helper.doAction('inlineNext', bufnr)
        expect(session.index).toBe(0)
        expect(mockInsertVtext).toHaveBeenCalledWith(item1)
      })
    })

    describe('prev()', () => {
      it('should do nothing if no session exists', async () => {
        inlineCompletion.session = undefined
        await inlineCompletion.prev(bufnr)
        expect(mockInsertVtext).not.toHaveBeenCalled()
      })

      it('should do nothing if bufnr does not match session vtextBufnr', async () => {
        setupSession([item1, item2])
        inlineCompletion.session.vtext = undefined // Ensure vtextBufnr is -1
        await inlineCompletion.prev(bufnr)
        expect(mockInsertVtext).not.toHaveBeenCalled()

        setupSession([item1, item2], 0, bufnr) // vtextBufnr will be bufnr
        await inlineCompletion.prev(bufnr + 1) // Call with different bufnr
        expect(mockInsertVtext).not.toHaveBeenCalled()
      })

      it('should do nothing if session has no items', async () => {
        const session = setupSession([])
        await inlineCompletion.prev(bufnr)
        expect(mockInsertVtext).not.toHaveBeenCalled()
        expect(session.index).toBe(0)
      })

      it('should do nothing if session has only one item', async () => {
        const session = setupSession([item1])
        await inlineCompletion.prev(bufnr)
        expect(mockInsertVtext).not.toHaveBeenCalled()
        expect(session.index).toBe(0)
      })

      it('should move to the previous item and call insertVtext', async () => {
        const session = setupSession([item1, item2, item3], 1)
        await helper.doAction('inlinePrev', bufnr)
        expect(session.index).toBe(0)
        expect(mockInsertVtext).toHaveBeenCalledWith(item1)
      })

      it('should loop to the last item when at the first item', async () => {
        const session = setupSession([item1, item2, item3], 0) // Start at first item
        await inlineCompletion.prev(bufnr)
        expect(session.index).toBe(2)
        expect(mockInsertVtext).toHaveBeenCalledWith(item3)
      })
    })
  })

  describe('commands', () => {
    describe('document.checkInlineCompletion', () => {
      let showWarningMessageSpy: jest.SpyInstance
      let showInformationMessageSpy: jest.SpyInstance
      let getDocumentSpy: jest.SpyInstance
      let getProvidersSpy: jest.SpyInstance

      beforeEach(() => {
        showWarningMessageSpy = jest.spyOn(window, 'showWarningMessage').mockResolvedValue(undefined)
        showInformationMessageSpy = jest.spyOn(window, 'showInformationMessage').mockResolvedValue(undefined)
        getDocumentSpy = jest.spyOn(workspace, 'getDocument')
        getProvidersSpy = jest.spyOn(languages.inlineCompletionItemManager, 'getProviders')
      })

      afterEach(() => {
        jest.restoreAllMocks()
      })

      it('should show warning if inline completion is not supported', async () => {
        jest.spyOn(workspace, 'has').mockReturnValue(false)
        await commands.executeCommand('document.checkInlineCompletion')
        expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('Inline completion is not supported'))
        expect(showInformationMessageSpy).not.toHaveBeenCalled()
      })

      it('should show warning if document is not found', async () => {
        getDocumentSpy.mockReturnValue(null)
        await commands.executeCommand('document.checkInlineCompletion')
        expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining(`not attached`))
        expect(showInformationMessageSpy).not.toHaveBeenCalled()
      })

      it('should show warning if document is not attached', async () => {
        const mockDoc = { bufnr: 1, attached: false, textDocument: {} } as any
        getDocumentSpy.mockReturnValue(mockDoc)
        await commands.executeCommand('document.checkInlineCompletion')
        expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('not attached'))
        expect(showInformationMessageSpy).not.toHaveBeenCalled()
      })

      it('should show warning when disabled by b:coc_inline_disable', async () => {
        let doc = await workspace.document
        await doc.buffer.setVar('coc_inline_disable', true)
        await commands.executeCommand('document.checkInlineCompletion')
        expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('disabled'))
        expect(showInformationMessageSpy).not.toHaveBeenCalled()
        doc.buffer.deleteVar('coc_inline_disable')
      })

      it('should show warning if no providers are found', async () => {
        const mockDoc = { bufnr: 1, attached: true, textDocument: {} } as any
        getDocumentSpy.mockReturnValue(mockDoc)
        getProvidersSpy.mockReturnValue([])
        await commands.executeCommand('document.checkInlineCompletion')
        expect(showWarningMessageSpy).toHaveBeenCalledWith(expect.stringContaining('provider not found'))
        expect(showInformationMessageSpy).not.toHaveBeenCalled()
      })

      it('should show information message if providers are found', async () => {
        const mockDoc = { bufnr: 1, attached: true, textDocument: {} } as any
        getDocumentSpy.mockReturnValue(mockDoc)
        const mockProvider1 = { provider: { __extensionName: 'providerOne' } } as any
        const mockProvider2 = { provider: {} } as any // No __extensionName
        getProvidersSpy.mockReturnValue([mockProvider1, mockProvider2])

        await commands.executeCommand('document.checkInlineCompletion')

        expect(showInformationMessageSpy).toHaveBeenCalledWith('Inline completion is supported by providerOne, unknown.')
        expect(showWarningMessageSpy).not.toHaveBeenCalled()
      })

      it('should show information message with single provider', async () => {
        const mockDoc = { bufnr: 1, attached: true, textDocument: {} } as any
        getDocumentSpy.mockReturnValue(mockDoc)
        const mockProvider = { provider: { __extensionName: 'myProvider' } } as any
        getProvidersSpy.mockReturnValue([mockProvider])

        await commands.executeCommand('document.checkInlineCompletion')

        expect(showInformationMessageSpy).toHaveBeenCalledWith('Inline completion is supported by myProvider.')
        expect(showWarningMessageSpy).not.toHaveBeenCalled()
      })
    })
  })
})

// Tests for standalone functions
describe('Utility functions', () => {
  describe('formatInsertText', () => {
    it('should format text with spaces', () => {
      const text = 'line1\n  line2'
      const options: FormattingOptions = { tabSize: 2, insertSpaces: true }
      const result = formatInsertText(text, options)
      expect(result).toBe('line1\n  line2')
    })

    it('should convert tabs to spaces', () => {
      const text = 'line1\n\tline2'
      const options: FormattingOptions = { tabSize: 2, insertSpaces: true }
      const result = formatInsertText(text, options)
      expect(result).toBe('line1\n  line2')
    })

    it('should convert spaces to tabs', () => {
      const text = 'line1\n  line2'
      const options: FormattingOptions = { tabSize: 2, insertSpaces: false }
      const result = formatInsertText(text, options)
      expect(result).toBe('line1\n\tline2')
    })
  })

  describe('getPumInserted', () => {
    it('should return empty string when current line matches synced line', async () => {
      const doc = await workspace.document
      await nvim.setLine('test line')
      await doc.patchChange() // Synchronize to ensure lines match
      const cursor = Position.create(0, 5)
      const result = getPumInserted(doc, cursor)
      expect(result).toBe('')
    })

    it('should return inserted text when current line differs from synced line', async () => {
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
      expect(result).toBe(' inserted')
    })

    it('should return undefined when no valid insertion is detected', async () => {
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
      expect(result).toBeUndefined()
    })

    it('should handle cursor at beginning of line', async () => {
      const doc = await workspace.document
      await nvim.setLine('prefix original')
      const originalLines = doc.textDocument.lines
      doc.textDocument.lines = ['original']
      const cursor = Position.create(0, 7) // Position after "prefix "
      const result = getPumInserted(doc, cursor)
      doc.textDocument.lines = originalLines
      expect(result).toBe('prefix ')
    })

    it('should handle cursor at end of line', async () => {
      const doc = await workspace.document
      await nvim.setLine('original suffix')
      const originalLines = doc.textDocument.lines
      doc.textDocument.lines = ['original']
      const cursor = Position.create(0, 15) // End of "original suffix"
      const result = getPumInserted(doc, cursor)
      doc.textDocument.lines = originalLines
      expect(result).toBe(' suffix')
    })
  })

  describe('getInsertText', () => {
    it('should handle plain text', () => {
      const item: InlineCompletionItem = {
        insertText: 'plain text'
      }
      const options: FormattingOptions = { tabSize: 2, insertSpaces: true }
      const result = getInsertText(item, options)
      expect(result).toBe('plain text')
    })

    it('should handle snippet text', () => {
      const item: InlineCompletionItem = {
        insertText: {
          value: 'snippet ${1:text}',
          kind: 'snippet'
        },
      }
      const options: FormattingOptions = { tabSize: 2, insertSpaces: true }
      const result = getInsertText(item, options)
      expect(result).toBe('snippet text')
    })
  })

  describe('getInserted', () => {
    it('should return undefined when current string is shorter than synced string', () => {
      const curr = 'foo'
      const synced = 'foobar'
      const character = 3
      const result = getInserted(curr, synced, character)
      expect(result).toBeUndefined()
    })

    it('should return undefined when text after cursor does not match end of synced string', () => {
      const curr = 'fooXYZ'
      const synced = 'foobar'
      const character = 3
      const result = getInserted(curr, synced, character)
      expect(result).toBeUndefined()
    })

    it('should return undefined when beginning of current does not match beginning of synced', () => {
      const curr = 'abcbar'
      const synced = 'foobar'
      const character = 3
      const result = getInserted(curr, synced, character)
      expect(result).toBeUndefined()
    })

    it('should identify simple insertion in the middle', () => {
      const curr = 'fooinsertedbartexthere'
      const synced = 'foobartexthere'
      const character = 11 // Position after "fooinserted"
      const result = getInserted(curr, synced, character)
      expect(result).toEqual({ start: 3, text: 'inserted' })
    })

    it('should identify insertion at the end', () => {
      const curr = 'foobarappended'
      const synced = 'foobar'
      const character = 14 // Position at the end of curr
      const result = getInserted(curr, synced, character)
      expect(result).toEqual({ start: 6, text: 'appended' })
    })

    it('should identify insertion at the beginning', () => {
      const curr = 'prefixfoobar'
      const synced = 'foobar'
      const character = 6 // Position after "prefix"
      const result = getInserted(curr, synced, character)
      expect(result).toEqual({ start: 0, text: 'prefix' })
    })

    it('should handle insertion with special characters', () => {
      const curr = 'foo\t\n🚀bar'
      const synced = 'foobar'
      const character = 7 // After special chars (note emoji is a single character)
      const result = getInserted(curr, synced, character)
      expect(result).toEqual({ start: 3, text: '\t\n🚀' })
    })

    it('should handle empty insertion', () => {
      const curr = 'foobar'
      const synced = 'foobar'
      const character = 3 // Position in the middle, but no change
      const result = getInserted(curr, synced, character)
      expect(result).toEqual({ start: 3, text: '' })
    })
  })

  describe('checkInsertedAtBeginning', () => {
    it('should return true when item has no range and insertText starts with inserted string', () => {
      const currentLine = 'some text'
      const triggerCharacter = 4
      const inserted = 'comp'
      const item: InlineCompletionItem = {
        insertText: 'completion'
      }
      const result = checkInsertedAtBeginning(currentLine, triggerCharacter, inserted, item)
      expect(result).toBe(true)
    })

    it('should return false when item has no range and insertText does not start with inserted string', () => {
      const currentLine = 'some text'
      const triggerCharacter = 4
      const inserted = 'diff'
      const item: InlineCompletionItem = {
        insertText: 'completion'
      }
      const result = checkInsertedAtBeginning(currentLine, triggerCharacter, inserted, item)
      expect(result).toBe(false)
    })

    it('should return true when item has no range and snippet value starts with inserted string', () => {
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
      expect(result).toBe(true)
    })

    it('should return false when item has no range and snippet value does not start with inserted string', () => {
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
      expect(result).toBe(false)
    })

    it('should return true when item has range and current line portion matches start of insertText', () => {
      const currentLine = 'prefix completion suffix'
      const triggerCharacter = 10 // After "prefix com"
      const inserted = 'com'
      const item: InlineCompletionItem = {
        insertText: 'completion',
        range: Range.create(0, 7, 0, 16) // "completion"
      }
      const result = checkInsertedAtBeginning(currentLine, triggerCharacter, inserted, item)
      expect(result).toBe(true)
    })

    it('should return false when item has range and current line portion does not match start of insertText', () => {
      const currentLine = 'prefix different suffix'
      const triggerCharacter = 10 // After "prefix dif"
      const inserted = 'dif'
      const item: InlineCompletionItem = {
        insertText: 'completion',
        range: Range.create(0, 7, 0, 16) // "different"
      }
      const result = checkInsertedAtBeginning(currentLine, triggerCharacter, inserted, item)
      expect(result).toBe(false)
    })

    it('should return true when item has range and current line portion matches start of snippet value', () => {
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
      expect(result).toBe(true)
    })

    it('should handle case with empty inserted string', () => {
      const currentLine = 'prefix'
      const triggerCharacter = 6
      const inserted = ''
      const item: InlineCompletionItem = {
        insertText: 'completion'
      }
      const result = checkInsertedAtBeginning(currentLine, triggerCharacter, inserted, item)
      expect(result).toBe(true) // Empty string is always at beginning
    })

    it('should handle special characters in inserted string', () => {
      const currentLine = 'prefix\t\n🚀completion'
      const triggerCharacter = 6 // After the emoji
      const inserted = '\t\n🚀'
      const item: InlineCompletionItem = {
        insertText: '\t\n🚀suffix',
        range: Range.create(0, 6, 0, 9)
      }
      const result = checkInsertedAtBeginning(currentLine, triggerCharacter, inserted, item)
      expect(result).toBe(true)
    })
  })
})
