import * as shared from '../sharedUtil'
import { nvim } from '../sharedUtil'
import commandManager from '../../commands'
import completion from '../../completion'
import { fixIndent, fixTextEdit, getUltisnipOption } from '../../completion/source-language'
import sources from '../../completion/sources'
import { CompleteOption, InsertMode, ItemDefaults } from '../../completion/types'
import events from '../../events'
import languages from '../../languages'
import { CompletionItemProvider } from '../../provider'
import snippetManager from '../../snippets/manager'
import { disposeAll } from '../../util'
import window from '../../window'
import { CancellationToken, CompletionTriggerKind, Disposable } from 'vscode-languageserver-protocol'
import { ApplyKind, CompletionItem, CompletionItemApplyKinds, CompletionItemKind, CompletionList, InsertReplaceEdit, InsertTextFormat, InsertTextMode, Position, Range, TextEdit } from 'vscode-languageserver-types'
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'


let disposables: Disposable[] = []

afterEach(async () => {
  disposeAll(disposables)
})

function createCompletionItem(word: string): CompletionItem {
  return { label: word, filterText: word }
}

describe('LanguageSource util', () => {
  it('should get ultisnip option', async t => {
    let item: CompletionItem = { label: 'label' }
    assert.strictEqual(getUltisnipOption(item), undefined)
    item.data = {}
    assert.strictEqual(getUltisnipOption(item), undefined)
    item.data.ultisnip = true
    assert.notStrictEqual(getUltisnipOption(item), undefined)
    item.data.ultisnip = {}
    assert.notStrictEqual(getUltisnipOption(item), undefined)
  })

  it('should fix range from indent', async t => {
    let line = '  foo'
    let currline = 'foo'
    let range = Range.create(0, 2, 0, 5)
    assert.strictEqual(fixIndent(line, currline, range), -2)
    assert.deepStrictEqual(range, Range.create(0, 0, 0, 3))
    assert.strictEqual(fixIndent(currline, line, range), 2)
    assert.deepStrictEqual(range, Range.create(0, 2, 0, 5))
  })

  it('should fix textEdit', async t => {
    let edit = TextEdit.insert(Position.create(0, 1), '')
    assert.strictEqual((fixTextEdit(0, edit) as TextEdit).range.start.character, 0)
    let insertReplaceEdit = InsertReplaceEdit.create('text', Range.create(0, 1, 0, 1), Range.create(0, 1, 0, 2))
    fixTextEdit(0, insertReplaceEdit)
    assert.strictEqual(insertReplaceEdit.insert.start.character, 0)
    assert.strictEqual(insertReplaceEdit.replace.start.character, 0)
    fixTextEdit(0, insertReplaceEdit)
    assert.strictEqual(insertReplaceEdit.insert.start.character, 0)
    assert.strictEqual(insertReplaceEdit.replace.start.character, 0)
  })

  it('should select recent item by prefix', async t => {
    t.after(() => editorReset(t))
    shared.updateConfiguration('suggest.selection', 'recentlyUsedByPrefix', disposables)
    let provider: CompletionItemProvider = {
      provideCompletionItems: async (): Promise<CompletionItem[]> => [{
        label: 'fa'
      }, {
        label: 'fb'
      }, {
        label: 'foo',
        kind: CompletionItemKind.Class
      }]
    }
    disposables.push(languages.registerCompletionItemProvider('foo', 'f', null, provider))
    completion.mru.clear()
    completion.mru.add('f', {
      kind: CompletionItemKind.Class,
      filterText: 'foo',
      source: sources.getSource('foo'),
    })
    await nvim.setLine('f')
    await nvim.input('A')
    await nvim.call('coc#start', { source: 'foo' })
    await shared.waitPopup()
    let info = await nvim.call('coc#pum#info') as any
    assert.notStrictEqual(info, undefined)
    assert.strictEqual(info.word, 'foo')
  })
})

describe('language source', () => {
  afterEach(editorReset)

  describe('toggle()', () => {
    it('should toggle source', t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'foo',
          detail: 'detail of foo'
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('foo', 'f', null, provider))
      let source = sources.getSource('foo')
      assert.notStrictEqual(source, undefined)
      source.toggle()
      assert.strictEqual(source.enable, false)
      source.toggle()
      assert.strictEqual(source.enable, true)
    })
  })

  describe('shouldCommit()', () => {
    it('should check commit characters', async t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'foo',
          detail: 'detail of foo'
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('foo', 'f', null, provider, [], 3, ['.']))
      let source = sources.getSource('foo')
      let item = createCompletionItem('foo')
      let res = source.shouldCommit(item, '.')
      assert.strictEqual(res, true)
    })

    it('should not feedkeys when already inserted before', async t => {
      shared.updateConfiguration('suggest.acceptSuggestionOnCommitCharacter', true, disposables)
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (_doc, pos): Promise<CompletionItem[]> => [{
          label: 'foo',
          textEdit: TextEdit.replace(Range.create(pos.line, pos.character, pos.line, pos.character + 1), `foo($1)$0`),
          insertTextFormat: InsertTextFormat.Snippet,
          commitCharacters: ['(']
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('language', 'l', ['*'], provider))
      await nvim.command('startinsert')
      nvim.call('coc#start', [{ source: 'language' }], true)
      await shared.waitPopup()
      assert.notStrictEqual(completion.selectedItem, undefined)
      await nvim.input('(')
      await shared.waitValue(() => completion.isActivated, false)
      await shared.waitFor('getline', ['.'], 'foo()')
      await nvim.input('<esc>')
      await shared.waitFor('mode', [], 'n')
    })

    it('should not feedkeys when have paried characters before', async t => {
      shared.updateConfiguration('suggest.acceptSuggestionOnCommitCharacter', true, disposables)
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (_doc, pos): Promise<CompletionItem[]> => [{
          label: 'foo',
          textEdit: TextEdit.replace(Range.create(pos.line, pos.character, pos.line, pos.character + 1), `foo()$0`),
          insertTextFormat: InsertTextFormat.Snippet,
          commitCharacters: ['(']
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('language', 'l', ['*'], provider))
      await nvim.call('cursor', [1, 1])
      await nvim.command('startinsert')
      await nvim.setLine('')
      nvim.call('coc#start', [{ source: 'language' }], true)
      await shared.waitPopup()
      assert.notStrictEqual(completion.selectedItem, undefined)
      await nvim.input('()<left>')
      await shared.waitFor('getline', ['.'], 'foo()')
      await nvim.input('<esc>')
      await shared.waitFor('mode', [], 'n')
    })
  })

  describe('resolveCompletionItem()', () => {
    async function getDetailContent(): Promise<string | undefined> {
      let winid = await nvim.call('coc#float#get_float_by_kind', ['pumdetail'])
      if (!winid) return
      let bufnr = await nvim.call('winbufnr', [winid]) as number
      let lines = await (nvim.createBuffer(bufnr)).lines
      return lines.join('\n')
    }

    it('should return null when canceled or no items returned', async t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => []
      }
      disposables.push(languages.registerCompletionItemProvider('foo', 'f', null, provider, [], 3, ['.']))
      let source = sources.getSource('foo')
      let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
      let res = await source.doComplete(opt, CancellationToken.Cancelled)
      assert.strictEqual(res, null)
      res = await source.doComplete(opt, CancellationToken.None)
      assert.strictEqual(res, null)
    })

    it('should add detail to preview when no resolve exists', async t => {
      await shared.createDocument('foo.vim')
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'foo',
          detail: 'detail of foo'
        }, {
          label: 'bar',
          detail: 'bar()'
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('foo', 'f', 'vim', provider))
      let mode = await nvim.mode
      if (mode.mode !== 'i') {
        await nvim.input('i')
      }
      nvim.call('coc#start', [{ source: 'foo' }], true)
      await shared.waitPopup()
      await shared.waitValue(async () => {
        let content = await getDetailContent()
        return content && /foo/.test(content)
      }, true)
      await nvim.input('<C-n>')
      await shared.waitValue(async () => {
        let content = await getDetailContent()
        return content && /bar/.test(content)
      }, true)
    })

    it('should add documentation to preview when no resolve exists', async t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'foo',
          labelDetails: {},
          documentation: 'detail of foo'
        }, {
          label: 'bar',
          documentation: {
            kind: 'plaintext',
            value: 'bar'
          }
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('foo', 'f', null, provider))
      await nvim.input('i')
      await nvim.call('coc#start', { source: 'foo' })
      await shared.waitPopup()
      await shared.wait(20)
      let content = await getDetailContent()
      assert.match(content, new RegExp('foo'))
      await nvim.input('<C-n>')
      await shared.waitValue(async () => (await getDetailContent()).includes('bar'), true)
      content = await getDetailContent()
      assert.match(content, new RegExp('bar'))
    })

    it('should resolve again when request cancelled', async t => {
      let count = 0
      let cancelled = false
      let resolved = false
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{ label: 'bar' }],
        resolveCompletionItem: (item, token) => {
          if (count === 0) {
            count++
            return new Promise(resolve => {
              token.onCancellationRequested(() => {
                cancelled = true
                resolve(undefined)
              })
            })
          }
          resolved = true
          return item
        },
      }
      disposables.push(languages.registerCompletionItemProvider('foo', 'f', null, provider))
      await nvim.input('i')
      await nvim.call('coc#start', { source: 'foo' })
      await shared.waitPopup()
      await shared.waitValue(() => {
        return cancelled
      }, true)
      nvim.call('coc#pum#close', ['confirm'], true)
      await shared.waitValue(() => {
        return resolved
      }, true)
    })

    it('should resolve CompletionItem', async t => {
      let res: CompletionItem | Error | undefined
      let n = 0
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'this',
          documentation: 'detail of this'
        }],
        resolveCompletionItem: item => {
          if (res instanceof Error) {
            throw res
          } else {
            n++
            return res
          }
        }
      }
      disposables.push(languages.registerCompletionItemProvider('foo', 'f', null, provider))
      let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
      let source = sources.getSource('foo')
      await source.doComplete(opt, CancellationToken.None)
      let item = createCompletionItem('this')
      await source.onCompleteResolve(item, opt, CancellationToken.None)
      res = { label: 'this', textEdit: TextEdit.insert(Position.create(0, 0), 'this') }
      let p = n
      await source.onCompleteResolve(item, opt, CancellationToken.None)
      await source.onCompleteResolve(item, opt, CancellationToken.None)
      assert.strictEqual(n - p, 1)
      res = new Error('resolve error')
      item = createCompletionItem('this')
      await assert.rejects(Promise.resolve(source.onCompleteResolve(item, opt, CancellationToken.None)), Error)
    })
  })

  describe('command', () => {
    it('should invoke command', async t => {
      let id = 'test.command'
      let item: CompletionItem = {
        label: 'this',
        command: {
          command: id,
          title: id,
          arguments: []
        }
      }
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [item]
      }
      disposables.push(languages.registerCompletionItemProvider('foo', 'f', null, provider))
      let opt = await nvim.call('coc#util#get_complete_option') as any
      opt.snippetsSupport = false
      opt.insertMode = InsertMode.Insert
      let source = sources.getSource('foo')
      await source.doComplete(opt, CancellationToken.None)
      await source.onCompleteDone(item, opt)
      let called = false
      commandManager.registerCommand(id, () => {
        called = true
      })
      await source.onCompleteDone(item, opt)
      assert.strictEqual(called, true)
    })
  })

  describe('labelDetails', () => {
    it('should show labelDetails to documentation window', async t => {
      shared.updateConfiguration('suggest.labelMaxLength', 10, disposables)
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'foo',
          labelDetails: {
            detail: 'foo'.repeat(5)
          }
        }, {
          label: 'bar',
          labelDetails: {
            description: 'bar'.repeat(5)
          }
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider))
      await nvim.input('i')
      await nvim.call('coc#start', { source: 'edits' })
      let winid: number
      await shared.waitValue(async () => {
        winid = await nvim.call('coc#float#get_float_by_kind', ['pumdetail']) as number
        return winid > 0
      }, true)
      let lines = await shared.getWinLines(winid)
      assert.match(lines[0], new RegExp('foo'))
      await nvim.call('coc#pum#_navigate', [1, 1])
      await shared.waitValue(async () => {
        lines = await shared.getWinLines(winid)
        return lines.join(' ').includes('bar')
      }, true)
    })
  })

  describe('additionalTextEdits', () => {
    it('should fix cursor position with plain text on additionalTextEdits', async t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'foo',
          filterText: 'foo',
          additionalTextEdits: [TextEdit.insert(Position.create(0, 0), 'a\nbar')]
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider))
      await nvim.input('if')
      await shared.waitPopup()
      await shared.confirmCompletion(0)
      await shared.waitFor('getline', ['.'], 'barfoo')
      let col = await nvim.call('col', ['.'])
      assert.strictEqual(col, 7)
    })

    it('should fix cursor position with snippet on additionalTextEdits', async t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'if',
          insertTextFormat: InsertTextFormat.Snippet,
          textEdit: { range: Range.create(0, 0, 0, 1), newText: 'if($1)' },
          additionalTextEdits: [TextEdit.insert(Position.create(0, 0), 'bar ')],
          preselect: true
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider))
      await nvim.input('ii')
      await shared.waitPopup()
      let res = await shared.items()
      let idx = res.findIndex(o => o.source?.name == 'edits')
      await shared.confirmCompletion(idx)
      await shared.waitFor('col', ['.'], 8)
    })

    it('should fix cursor position with plain text snippet on additionalTextEdits', async t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'if',
          filterText: 'if',
          insertTextFormat: InsertTextFormat.Snippet,
          textEdit: { range: Range.create(0, 0, 0, 2), newText: 'do$0' },
          additionalTextEdits: [TextEdit.insert(Position.create(0, 0), 'bar ')],
          preselect: true
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider))
      await nvim.input('iif')
      await shared.waitPopup()
      let items = await shared.items()
      let idx = items.findIndex(o => o.word == 'do' && o.source?.name == 'edits')
      await shared.confirmCompletion(idx)
      await shared.waitFor('getline', ['.'], 'bar do')
      await shared.waitFor('col', ['.'], 7)
    })

    it('should fix cursor position with nested snippet on additionalTextEdits', async t => {
      let pos = await window.getCursorPosition()
      let range = Range.create(pos, pos)
      let res = await commandManager.executeCommand('editor.action.insertSnippet', TextEdit.replace(range, 'func($1)$0'))
      assert.strictEqual(res, true)
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'if',
          filterText: 'if',
          insertTextFormat: InsertTextFormat.Snippet,
          insertText: 'do$0',
          additionalTextEdits: [TextEdit.insert(Position.create(0, 0), 'bar ')],
          preselect: true
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider))
      await nvim.input('if')
      await shared.waitPopup()
      await shared.confirmCompletion(0)
      await events.race(['CompleteDone'], 200)
      let [, lnum, col] = await nvim.call('getcurpos') as [number, number, number]
      assert.strictEqual(lnum, 1)
      assert.strictEqual(col, 12)
    })

    it('should fix cursor position and keep placeholder with snippet on additionalTextEdits', async t => {
      let text = 'foo0bar1'
      await nvim.setLine(text)
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'var',
          insertTextFormat: InsertTextFormat.Snippet,
          textEdit: { range: Range.create(0, text.length + 1, 0, text.length + 1), newText: '${1:foo} = foo0bar1' },
          additionalTextEdits: [TextEdit.del(Range.create(0, 0, 0, text.length + 1))],
          preselect: true
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider, ['.']))
      await nvim.input('A.')
      await shared.waitPopup()
      let res = await shared.items()
      let idx = res.findIndex(o => o.source?.name == 'edits')
      await shared.confirmCompletion(idx)
      await shared.waitFor('getline', ['.'], 'foo = foo0bar1')
      await shared.waitValue(async () => {
        let p = await nvim.call('getcurpos') as number[]
        return [p[1], p[2]]
      }, [1, 3])
      assert.notStrictEqual(snippetManager.session, undefined)
      let [, lnum, col] = await nvim.call('getcurpos') as [number, number, number]
      assert.strictEqual(lnum, 1)
      assert.strictEqual(col, 3)
    })

    it('should move cursor to empty placeholder with delete before snippet on additionalTextEdits', async t => {
      // Faithful rust-analyzer postfix payload (#5411): the snippet textEdit
      // replaces the trigger char with `$0`, additionalTextEdits delete the
      // prefix located before the snippet, the cursor must land on `$0`.
      let text = 'Some(2).'
      await nvim.setLine(text)
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'let',
          insertTextFormat: InsertTextFormat.Snippet,
          textEdit: { range: Range.create(0, text.length, 0, text.length + 1), newText: 'let $0 = Some(2);' },
          additionalTextEdits: [TextEdit.del(Range.create(0, 0, 0, text.length))],
          preselect: true
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider))
      await nvim.input('Al')
      await shared.waitPopup()
      let res = await shared.items()
      let idx = res.findIndex(o => o.source?.name == 'edits')
      await shared.confirmCompletion(idx)
      await shared.waitFor('getline', ['.'], 'let  = Some(2);')
      await shared.waitValue(async () => {
        let p = await nvim.call('getcurpos') as number[]
        return [p[1], p[2]]
      }, [1, 5])
      let [, lnum, col] = await nvim.call('getcurpos') as [number, number, number]
      assert.strictEqual(lnum, 1)
      assert.strictEqual(col, 5)
    })

    it('should not cancel current snippet session when additionalTextEdits inside snippet', async t => {
      await nvim.input('i')
      snippetManager.cancel()
      let pos = await window.getCursorPosition()
      let range = Range.create(pos, pos)
      await commandManager.executeCommand('editor.action.insertSnippet', TextEdit.replace(range, 'foo($1, $2)$0'), true)
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'bar',
          insertTextFormat: InsertTextFormat.Snippet,
          textEdit: { range: Range.create(0, 4, 0, 5), newText: 'bar($1)' },
          additionalTextEdits: [TextEdit.del(Range.create(0, 0, 0, 3))]
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider, ['.']))
      await nvim.input('b')
      await shared.waitPopup()
      let res = await shared.items()
      let idx = res.findIndex(o => o.source?.name == 'edits')
      await shared.confirmCompletion(idx)
      await shared.waitFor('getline', ['.'], '(bar(), )')
      await shared.waitFor('col', ['.'], 6)
    })
  })

  describe('filterText', () => {
    it('should fix input for snippet item', async t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'foo',
          filterText: 'foo',
          insertText: '${1:foo}($2)',
          insertTextFormat: InsertTextFormat.Snippet,
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('snippets-test', 'st', null, provider))
      await nvim.input('if')
      await shared.waitPopup()
      await nvim.call('coc#pum#select', [0, 1, 0])
      await shared.waitFor('getline', ['.'], 'foo()')
    })

    it('should fix filterText of complete item', async t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'name',
          sortText: '11',
          textEdit: {
            range: Range.create(0, 1, 0, 2),
            newText: '?.name'
          }
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('name', 'N', null, provider, ['.']))
      await nvim.setLine('t')
      await nvim.input('A.')
      await shared.waitPopup()
      await shared.confirmCompletion(0)
      let line = await nvim.line
      assert.strictEqual(line, 't?.name')
    })
  })

  describe('inComplete result', () => {
    it('should filter in complete request', async t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (doc, pos, token, context): Promise<CompletionList> => {
          let option = (context as any).option
          if (context.triggerCharacter == '.') {
            return {
              isIncomplete: true,
              items: [
                {
                  label: 'foo'
                }, {
                  label: 'bar'
                }
              ]
            }
          }
          if (option.input == 'f') {
            if (token.isCancellationRequested) return
            return {
              isIncomplete: true,
              items: [
                {
                  label: 'foo'
                }
              ]
            }
          }
          if (option.input == 'fo') {
            if (token.isCancellationRequested) return
            return {
              isIncomplete: false,
              items: [
                {
                  label: 'foo'
                }
              ]
            }
          }
        }
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider, ['.']))
      await nvim.input('i.')
      await shared.waitPopup()
      await nvim.input('fo')
      await shared.waitValue(async () => {
        let items = await shared.items()
        return items.length
      }, 1)
    })

    it('should refresh language source after backspace clears input', async t => {
      let requests: [string, CompletionTriggerKind][] = []
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (_doc, _pos, _token, context): Promise<CompletionList> => {
          let option = (context as any).option
          requests.push([option.input, context.triggerKind])
          return {
            isIncomplete: option.input.length === 0,
            items: option.input.length > 0 ? [{ label: 'foo' }] : [{ label: 'foo' }, { label: 'bar' }]
          }
        }
      }
      disposables.push(languages.registerCompletionItemProvider('backspace', 'B', null, provider))
      await nvim.setLine('#include <f')
      await nvim.input('A')
      nvim.call('coc#start', { source: 'backspace' }, true)
      await shared.waitPopup()
      await nvim.input('<backspace>')
      await shared.waitValue(async () => {
        let items = await shared.items()
        return items.length
      }, 2)
      let found = requests.find((r: any[]) => r.length === 2 && r[0] === '' && r[1] === CompletionTriggerKind.Invoked)
      assert.ok(found)
    })
  })

  describe('itemDefaults', () => {
    async function start(item: CompletionItem, itemDefaults: ItemDefaults, triggerCharacters: string[] = [], applyKind?: CompletionItemApplyKinds): Promise<void> {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionList> => {
          return { items: [item], itemDefaults, isIncomplete: false, applyKind }
        }
      }
      disposables.push(languages.registerCompletionItemProvider('test', 't', null, provider, triggerCharacters, undefined, []))
      await nvim.input('i')
      nvim.call('coc#start', [{ source: 'test' }], true)
      await shared.waitPopup()
    }

    it('should use range of editRange from itemDefaults', async t => {
      await nvim.call('setline', ['.', 'bar'])
      await start({ label: 'foo' }, {
        editRange: Range.create(0, 0, 0, 3)
      })
      await shared.confirmCompletion(0)
      await shared.waitFor('getline', ['.'], 'foo')
    })

    it('should use commitCharacters from itemDefaults', async t => {
      let dispose = shared.updateConfiguration('suggest.acceptSuggestionOnCommitCharacter', true)
      await start({ label: 'foo' }, { commitCharacters: ['.'] }, ['.'])
      await nvim.input('.')
      // should trigger after commit
      await shared.waitFor('getline', ['.'], 'foo.')
      assert.strictEqual(events.completing, true)
      completion.cancelAndClose()
      dispose()
    })

    it('should merge commitCharacters by applyKind', async t => {
      let item = { label: 'foo', commitCharacters: [','] }
      await start(item, { commitCharacters: ['.'] }, ['.'], { commitCharacters: ApplyKind.Merge })
      let source = sources.getSource('test')
      assert.strictEqual(source.shouldCommit(item, '.'), true)
      completion.cancelAndClose()
    })

    it('should use replace range of editRange from itemDefaults', async t => {
      await nvim.call('setline', ['.', 'bar'])
      await start({ label: 'foo' }, {
        editRange: {
          insert: Range.create(0, 0, 0, 0),
          replace: Range.create(0, 0, 0, 3),
        }
      })
      await shared.confirmCompletion(0)
      await shared.waitFor('getline', ['.'], 'foo')
    })

    it('should use insertTextFormat from itemDefaults', async t => {
      await nvim.call('cursor', [1, 1])
      await start({ label: 'foo', insertText: 'foo($1)$0' }, {
        insertTextFormat: InsertTextFormat.Snippet,
        insertTextMode: InsertTextMode.asIs,
        data: {}
      })
      await shared.confirmCompletion(0)
      await shared.waitValue(async () => {
        let line = await nvim.call('getline', ['.']) as string
        return line.startsWith('foo()')
      }, true)
    })

    it('should use textEditText when exists with default range', async t => {
      await start({ label: 'foo', insertText: 'bar', textEditText: 'foofoo' }, {
        editRange: Range.create(0, 0, 0, 0)
      })
      await shared.confirmCompletion(0)
      await shared.waitFor('getline', ['.'], 'foofoo')
    })
  })

  describe('textEdit', () => {
    it('should not apply edits when line changed', async t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'foo',
          textEdit: TextEdit.insert(Position.create(0, 0), 'foo($1)'),
          insertTextFormat: InsertTextFormat.Snippet
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('foo', 'f', null, provider))
      let source = sources.getSource('foo')
      assert.notStrictEqual(source, undefined)
      let opt = await nvim.call('coc#util#get_complete_option') as any
      await source.doComplete(opt, CancellationToken.None)
      let item = createCompletionItem('foo')
      await nvim.call('append', [0, ['', '']])
      await nvim.command('normal! G')
      await source.onCompleteDone(item, opt)
      let line = await nvim.line
      assert.strictEqual(line, '')
    })

    it('should use insert range', async t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'foo',
          insertText: 'foo'
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('foo', 'f', null, provider))
      let source = sources.getSource('foo')
      assert.notStrictEqual(source, undefined)
      await nvim.setLine('foo')
      await nvim.input('I')
      let opt = await nvim.call('coc#util#get_complete_option') as any
      opt.insertMode = InsertMode.Insert
      await source.doComplete(opt, CancellationToken.None)
      let item = createCompletionItem('foo')
      await source.onCompleteDone(item, opt)
      let line = await nvim.line
      assert.strictEqual(line, 'foofoo')
    })

    it('should fix replace range for paired characters', async t => {
      // LS may failed to replace paired character at the end
      await nvim.setLine('<>')
      await nvim.input('i<right>')
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: '<foo>',
          filterText: '<foo>',
          // bad range
          textEdit: { range: Range.create(0, 0, 0, 0), newText: '<foo>' },
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider))
      nvim.call('coc#start', [{ source: 'edits' }], true)
      await shared.waitPopup()
      let idx = completion.activeItems.findIndex(o => o.word == '<foo>')
      assert.ok(idx > -1)
      await shared.confirmCompletion(idx)
      await shared.waitFor('getline', ['.'], '<foo>')
    })

    it('should not eat existing paired character on valid range', async t => {
      await nvim.setLine('fn bar() {}')
      await nvim.call('cursor', [1, 7])
      await nvim.input('a')
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (_, position): Promise<CompletionItem[]> => [{
          label: '(x, y): (i32, i32)',
          filterText: '(x, y): (i32, i32)',
          textEdit: { range: Range.create(position.line, position.character, position.line, position.character), newText: '(x, y): (i32, i32)' },
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider))
      let source = sources.getSource('edits')
      assert.notStrictEqual(source, undefined)
      let opt = await nvim.call('coc#util#get_complete_option') as any
      await source.doComplete(opt, CancellationToken.None)
      await source.onCompleteDone({
        label: '(x, y): (i32, i32)',
        filterText: '(x, y): (i32, i32)',
        textEdit: { range: Range.create(0, 7, 0, 7), newText: '(x, y): (i32, i32)' },
      }, opt)
      await shared.waitFor('getline', ['.'], 'fn bar((x, y): (i32, i32)) {}')
    })

    it('should fix bad range', async t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'foo',
          filterText: 'foo',
          textEdit: { range: Range.create(0, 0, 0, 0), newText: 'foo' },
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider))
      await nvim.input('i')
      nvim.call('coc#start', [{ source: 'edits' }], true)
      await shared.waitPopup()
      await shared.confirmCompletion(0)
      await shared.waitFor('getline', ['.'], 'foo')
    })

    it('should applyEdits for empty word', { timeout: 10000 }, async t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: '',
          filterText: '!',
          textEdit: { range: Range.create(0, 0, 0, 1), newText: 'foo' },
          data: { word: '' }
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider, ['!']))
      await nvim.input('i!')
      await shared.waitPopup()
      await shared.confirmCompletion(0)
      await shared.waitFor('getline', ['.'], 'foo')
    })

    it('should provide word when textEdit after startcol', { timeout: 10000 }, async t => {
      // some LS would send textEdit after first character,
      // need fix the word from newText
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (_, position): Promise<CompletionItem[]> => {
          if (position.line != 0) return null
          return [{
            label: 'bar',
            textEdit: {
              range: Range.create(0, 1, 0, 1),
              newText: 'bar'
            }
          }, {
            label: 'bad',
            textEdit: {
              replace: Range.create(0, 1, 0, 1),
              insert: Range.create(0, 1, 0, 1),
              newText: 'bad'
            }
          }]
        }
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider))
      await nvim.input('ib')
      await shared.waitPopup()
      let items = completion.activeItems
      assert.strictEqual(items[0].word, 'bar')
    })

    it('should adjust completion position by textEdit start position', { timeout: 10000 }, async t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (_document, _position, _token, context): Promise<CompletionItem[]> => {
          if (!context.triggerCharacter) return
          return [{
            label: 'foo',
            textEdit: {
              range: Range.create(0, 0, 0, 1),
              newText: '?foo'
            }
          }]
        }
      }
      disposables.push(languages.registerCompletionItemProvider('fix', 'f', null, provider, ['?']))
      await nvim.input('i?')
      await shared.waitPopup()
      await shared.confirmCompletion(0)
      let line = await nvim.line
      assert.strictEqual(line, '?foo')
    })

    it('should fix range of removed text range', { timeout: 10000 }, async t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => {
          return [{
            label: 'React',
            textEdit: {
              range: Range.create(0, 0, 0, 8),
              newText: 'import React$1 from "react"'
            },
            insertTextFormat: InsertTextFormat.Snippet
          }]
        }
      }
      disposables.push(languages.registerCompletionItemProvider('fix', 'f', null, provider, ['?']))
      await nvim.call('setline', ['.', 'import r;'])
      await nvim.call('cursor', [1, 8])
      await nvim.input('a')
      await nvim.call('coc#start', { source: 'fix' })
      await shared.waitPopup()
      await shared.confirmCompletion(0)
      await shared.waitFor('getline', ['.'], 'import React from "react";')
    })
  })
})
