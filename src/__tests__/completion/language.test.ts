import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable } from 'vscode-languageserver-protocol'
import { CompletionItem, CompletionItemKind, CompletionList, InsertReplaceEdit, InsertTextFormat, InsertTextMode, Position, Range, TextEdit } from 'vscode-languageserver-types'
import commandManager from '../../commands'
import completion from '../../completion'
import { fixIndent, fixTextEdit, getUltisnipOption } from '../../completion/source-language'
import sources from '../../completion/sources'
import { CompleteOption, InsertMode, ItemDefaults } from '../../completion/types'
import languages from '../../languages'
import { CompletionItemProvider } from '../../provider'
import snippetManager from '../../snippets/manager'
import { disposeAll } from '../../util'
import window from '../../window'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  disposeAll(disposables)
  await helper.reset()
})

function createCompletionItem(word: string): CompletionItem {
  return { label: word, filterText: word }
}

describe('LanguageSource util', () => {
  it('should get ultisnip option', async () => {
    let item: CompletionItem = { label: 'label' }
    expect(getUltisnipOption(item)).toBeUndefined()
    item.data = {}
    expect(getUltisnipOption(item)).toBeUndefined()
    item.data.ultisnip = true
    expect(getUltisnipOption(item)).toBeDefined()
    item.data.ultisnip = {}
    expect(getUltisnipOption(item)).toBeDefined()
  })

  it('should fix range from indent', async () => {
    let line = '  foo'
    let currline = 'foo'
    let range = Range.create(0, 2, 0, 5)
    expect(fixIndent(line, currline, range)).toBe(-2)
    expect(range).toEqual(Range.create(0, 0, 0, 3))
    expect(fixIndent(currline, line, range)).toBe(2)
    expect(range).toEqual(Range.create(0, 2, 0, 5))
  })

  it('should fix textEdit', async () => {
    let edit = TextEdit.insert(Position.create(0, 1), '')
    expect((fixTextEdit(0, edit) as TextEdit).range.start.character).toBe(0)
    let insertReplaceEdit = InsertReplaceEdit.create('text', Range.create(0, 1, 0, 1), Range.create(0, 1, 0, 2))
    fixTextEdit(0, insertReplaceEdit)
    expect(insertReplaceEdit.insert.start.character).toBe(0)
    expect(insertReplaceEdit.replace.start.character).toBe(0)
    fixTextEdit(0, insertReplaceEdit)
    expect(insertReplaceEdit.insert.start.character).toBe(0)
    expect(insertReplaceEdit.replace.start.character).toBe(0)
  })

  it('should select recent item by prefix', async () => {
    helper.updateConfiguration('suggest.selection', 'recentlyUsedByPrefix')
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
    await helper.waitPopup()
    let info = await nvim.call('coc#pum#info') as any
    expect(info).toBeDefined()
    expect(info.word).toBe('foo')
  })
})

describe('language source', () => {
  describe('toggle()', () => {
    it('should toggle source', () => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'foo',
          detail: 'detail of foo'
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('foo', 'f', null, provider))
      let source = sources.getSource('foo')
      expect(source).toBeDefined()
      source.toggle()
      expect(source.enable).toBe(false)
      source.toggle()
      expect(source.enable).toBe(true)
    })
  })

  describe('shouldCommit()', () => {
    it('should check commit characters', async () => {
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
      expect(res).toBe(true)
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

    it('should return null when canceled or no items returned', async () => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => []
      }
      disposables.push(languages.registerCompletionItemProvider('foo', 'f', null, provider, [], 3, ['.']))
      let source = sources.getSource('foo')
      let opt = await nvim.call('coc#util#get_complete_option') as CompleteOption
      let res = await source.doComplete(opt, CancellationToken.Cancelled)
      expect(res).toBeNull()
      res = await source.doComplete(opt, CancellationToken.None)
      expect(res).toBeNull()
    })

    it('should add detail to preview when no resolve exists', async () => {
      await helper.createDocument('foo.vim')
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
      await helper.waitPopup()
      await helper.waitValue(async () => {
        let content = await getDetailContent()
        return content && /foo/.test(content)
      }, true)
      await nvim.input('<C-n>')
      await helper.waitValue(async () => {
        let content = await getDetailContent()
        return content && /bar/.test(content)
      }, true)
    })

    it('should add documentation to preview when no resolve exists', async () => {
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
      await helper.waitPopup()
      await helper.wait(10)
      let content = await getDetailContent()
      expect(content).toMatch('foo')
      await nvim.input('<C-n>')
      await helper.wait(30)
      content = await getDetailContent()
      expect(content).toMatch('bar')
    })

    it('should resolve again when request cancelled', async () => {
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
      await helper.waitPopup()
      await helper.waitValue(() => {
        return cancelled
      }, true)
      nvim.call('coc#pum#close', ['confirm'], true)
      await helper.waitValue(() => {
        return resolved
      }, true)
    })

    it('should resolve CompletionItem', async () => {
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
      expect(n - p).toBe(1)
      res = new Error('resolve error')
      item = createCompletionItem('this')
      await expect(async () => {
        await source.onCompleteResolve(item, opt, CancellationToken.None)
      }).rejects.toThrow(Error)
    })
  })

  describe('command', () => {
    it('should invoke command', async () => {
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
      expect(called).toBe(true)
    })
  })

  describe('labelDetails', () => {
    it('should show labelDetails to documentation window', async () => {
      helper.updateConfiguration('suggest.labelMaxLength', 10)
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
      await helper.waitValue(async () => {
        winid = await nvim.call('coc#float#get_float_by_kind', ['pumdetail']) as number
        return winid > 0
      }, true)
      let lines = await helper.getWinLines(winid)
      expect(lines[0]).toMatch('foo')
      await nvim.call('coc#pum#_navigate', [1, 1])
      await helper.waitValue(async () => {
        lines = await helper.getWinLines(winid)
        return lines.join(' ').includes('bar')
      }, true)
    })
  })

  describe('additionalTextEdits', () => {
    it('should fix cursor position with plain text on additionalTextEdits', async () => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'foo',
          filterText: 'foo',
          additionalTextEdits: [TextEdit.insert(Position.create(0, 0), 'a\nbar')]
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider))
      await nvim.input('if')
      await helper.waitPopup()
      await helper.confirmCompletion(0)
      await helper.waitFor('getline', ['.'], 'barfoo')
    })

    it('should fix cursor position with snippet on additionalTextEdits', async () => {
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
      await helper.waitPopup()
      let res = await helper.items()
      let idx = res.findIndex(o => o.source?.name == 'edits')
      await helper.confirmCompletion(idx)
      await helper.waitFor('col', ['.'], 8)
    })

    it('should fix cursor position with plain text snippet on additionalTextEdits', async () => {
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
      await helper.waitPopup()
      let items = await helper.items()
      let idx = items.findIndex(o => o.word == 'do' && o.source?.name == 'edits')
      await helper.confirmCompletion(idx)
      await helper.waitFor('getline', ['.'], 'bar do')
      await helper.waitFor('col', ['.'], 7)
    })

    it('should fix cursor position with nested snippet on additionalTextEdits', async () => {
      let pos = await window.getCursorPosition()
      let range = Range.create(pos, pos)
      let res = await commandManager.executeCommand('editor.action.insertSnippet', TextEdit.replace(range, 'func($1)$0'))
      expect(res).toBe(true)
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
      await helper.waitPopup()
      await helper.confirmCompletion(0)
      await helper.waitFor('getline', ['.'], 'bar func(do)')
      let [, lnum, col] = await nvim.call('getcurpos') as [number, number, number]
      expect(lnum).toBe(1)
      expect(col).toBe(12)
    })

    it('should fix cursor position and keep placeholder with snippet on additionalTextEdits', async () => {
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
      await helper.waitPopup()
      let res = await helper.items()
      let idx = res.findIndex(o => o.source?.name == 'edits')
      await helper.confirmCompletion(idx)
      await helper.waitFor('getline', ['.'], 'foo = foo0bar1')
      await helper.wait(50)
      expect(snippetManager.session).toBeDefined()
      let [, lnum, col] = await nvim.call('getcurpos') as [number, number, number]
      expect(lnum).toBe(1)
      expect(col).toBe(3)
    })

    it('should cancel current snippet session when additionalTextEdits inside snippet', async () => {
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
      await helper.waitPopup()
      let res = await helper.items()
      let idx = res.findIndex(o => o.source?.name == 'edits')
      await helper.confirmCompletion(idx)
      await helper.waitFor('col', ['.'], 6)
      await helper.waitFor('getline', ['.'], '(bar(), )')
    })
  })

  describe('filterText', () => {
    it('should fix input for snippet item', async () => {
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
      await helper.waitPopup()
      await nvim.call('coc#pum#select', [0, 1, 0])
      await helper.waitFor('getline', ['.'], 'foo()')
    })

    it('should fix filterText of complete item', async () => {
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
      await helper.waitPopup()
      await helper.confirmCompletion(0)
      let line = await nvim.line
      expect(line).toBe('t?.name')
    })
  })

  describe('inComplete result', () => {
    it('should filter in complete request', async () => {
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
      await helper.waitPopup()
      await nvim.input('fo')
      await helper.waitValue(async () => {
        let items = await helper.items()
        return items.length
      }, 1)
    })
  })

  describe('itemDefaults', () => {
    async function start(item: CompletionItem, itemDefaults: ItemDefaults): Promise<void> {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionList> => {
          return { items: [item], itemDefaults, isIncomplete: false }
        }
      }
      disposables.push(languages.registerCompletionItemProvider('test', 't', null, provider))
      await nvim.input('i')
      nvim.call('coc#start', [{ source: 'test' }], true)
      await helper.waitPopup()
    }

    it('should use commitCharacters from itemDefaults', async () => {
      helper.updateConfiguration('suggest.acceptSuggestionOnCommitCharacter', true)
      await start({ label: 'foo' }, { commitCharacters: ['.'] })
      await nvim.input('.')
      await helper.waitFor('getline', ['.'], 'foo.')
    })

    it('should use range of editRange from itemDefaults', async () => {
      await nvim.call('setline', ['.', 'bar'])
      await start({ label: 'foo' }, {
        editRange: Range.create(0, 0, 0, 3)
      })
      await helper.confirmCompletion(0)
      await helper.waitFor('getline', ['.'], 'foo')
    })

    it('should use replace range of editRange from itemDefaults', async () => {
      await nvim.call('setline', ['.', 'bar'])
      await start({ label: 'foo' }, {
        editRange: {
          insert: Range.create(0, 0, 0, 0),
          replace: Range.create(0, 0, 0, 3),
        }
      })
      await helper.confirmCompletion(0)
      await helper.waitFor('getline', ['.'], 'foo')
    })

    it('should use insertTextFormat from itemDefaults', async () => {
      await start({ label: 'foo', insertText: 'foo($1)$0' }, {
        insertTextFormat: InsertTextFormat.Snippet,
        insertTextMode: InsertTextMode.asIs,
        data: {}
      })
      await helper.confirmCompletion(0)
      await helper.waitFor('getline', ['.'], 'foo()')
    })
  })

  describe('textEdit', () => {
    it('should not apply edits when line changed', async () => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'foo',
          textEdit: TextEdit.insert(Position.create(0, 0), 'foo($1)'),
          insertTextFormat: InsertTextFormat.Snippet
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('foo', 'f', null, provider))
      let source = sources.getSource('foo')
      expect(source).toBeDefined()
      let opt = await nvim.call('coc#util#get_complete_option') as any
      await source.doComplete(opt, CancellationToken.None)
      let item = createCompletionItem('foo')
      await nvim.call('append', [0, ['', '']])
      await nvim.command('normal! G')
      await source.onCompleteDone(item, opt)
      let line = await nvim.line
      expect(line).toBe('')
    })

    it('should use insert range', async () => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'foo',
          insertText: 'foo'
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('foo', 'f', null, provider))
      let source = sources.getSource('foo')
      expect(source).toBeDefined()
      await nvim.setLine('foo')
      await nvim.input('I')
      let opt = await nvim.call('coc#util#get_complete_option') as any
      opt.insertMode = InsertMode.Insert
      await source.doComplete(opt, CancellationToken.None)
      let item = createCompletionItem('foo')
      await source.onCompleteDone(item, opt)
      let line = await nvim.line
      expect(line).toBe('foofoo')
    })

    it('should fix replace range for paired characters', async () => {
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
      await helper.waitPopup()
      let idx = completion.activeItems.findIndex(o => o.word == '<foo>')
      expect(idx).toBeGreaterThan(-1)
      await helper.confirmCompletion(idx)
      await helper.waitFor('getline', ['.'], '<foo>')
    })

    it('should fix bad range', async () => {
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
      await helper.waitPopup()
      await helper.confirmCompletion(0)
      await helper.waitFor('getline', ['.'], 'foo')
    })

    it('should applyEdits for empty word', async () => {
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
      await helper.waitPopup()
      await helper.confirmCompletion(0)
      await helper.waitFor('getline', ['.'], 'foo')
    })

    it('should provide word when textEdit after startcol', async () => {
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
      await helper.waitPopup()
      let items = completion.activeItems
      expect(items[0].word).toBe('bar')
    })

    it('should adjust completion position by textEdit start position', async () => {
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
      await helper.waitPopup()
      await helper.confirmCompletion(0)
      let line = await nvim.line
      expect(line).toBe('?foo')
    })

    it('should fix range of removed text range', async () => {
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
      await helper.waitPopup()
      await helper.confirmCompletion(0)
      await helper.waitFor('getline', ['.'], 'import React from "react";')
    })
  })
})
