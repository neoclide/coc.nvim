import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import { CompletionItem, CompletionList, CompletionItemKind, InsertTextFormat, InsertTextMode, Position, Range, TextEdit, InsertReplaceEdit } from 'vscode-languageserver-types'
import completion from '../../completion'
import languages from '../../languages'
import { CompletionItemProvider } from '../../provider'
import snippetManager from '../../snippets/manager'
import { ItemDefaults, getRange, getStartColumn, getKindString } from '../../sources/source-language'
import { disposeAll } from '../../util'
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

describe('getKindString()', () => {
  it('should get kind text', async () => {
    let map = new Map()
    map.set(CompletionItemKind.Enum, 'E')
    let res = getKindString(CompletionItemKind.Enum, map, '')
    expect(res).toBe('E')
  })

  it('should get default value', async () => {
    let map = new Map()
    let res = getKindString(CompletionItemKind.Enum, map, 'D')
    expect(res).toBe('D')
  })
})

describe('getStartColumn()', () => {
  it('should get start col', async () => {
    expect(getStartColumn('', [{ label: 'foo' }])).toBe(undefined)
    expect(getStartColumn('', [{ label: 'foo' }], { editRange: Range.create(0, 0, 0, 3) })).toBe(0)
    expect(getStartColumn('', [
      { label: 'foo', textEdit: TextEdit.insert(Position.create(0, 0), 'a') },
      { label: 'bar' }])).toBe(undefined)
    expect(getStartColumn('foo', [
      { label: 'foo', textEdit: TextEdit.insert(Position.create(0, 0), 'a') },
      { label: 'bar', textEdit: TextEdit.insert(Position.create(0, 1), 'b') }])).toBe(undefined)
    expect(getStartColumn('foo', [
      { label: 'foo', textEdit: TextEdit.insert(Position.create(0, 2), 'a') },
      { label: 'bar', textEdit: TextEdit.insert(Position.create(0, 2), 'b') }])).toBe(2)
  })
})

describe('getRange()', () => {
  it('should use range from textEdit', async () => {
    let item = { label: 'foo', textEdit: TextEdit.replace(Range.create(0, 1, 0, 3), 'foo') }
    let res = getRange(item, { editRange: Range.create(0, 0, 0, 0) })
    expect(res).toEqual(Range.create(0, 1, 0, 3))
  })

  it('should use range from itemDefaults', async () => {
    let item = { label: 'foo' }
    expect(getRange(item, { editRange: Range.create(0, 0, 0, 1) })).toEqual(Range.create(0, 0, 0, 1))
    expect(getRange(item, { editRange: InsertReplaceEdit.create('', Range.create(0, 0, 0, 0), Range.create(0, 0, 0, 1)) })).toEqual(Range.create(0, 0, 0, 1))
  })
})

describe('language source', () => {
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
        winid = await nvim.call('coc#float#get_float_by_kind', ['pumdetail'])
        return winid > 0
      }, true)
      let lines = await helper.getLines(winid)
      expect(lines[0]).toMatch('foo')
      await nvim.call('coc#pum#next', [1])
      await helper.waitValue(async () => {
        lines = await helper.getLines(winid)
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
      let res = await helper.getItems()
      let idx = res.findIndex(o => o.source == 'edits')
      await helper.confirmCompletion(idx)
      await helper.waitFor('col', ['.'], 8)
    })

    it('should fix cursor position with plain text snippet on additionalTextEdits', async () => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'if',
          insertTextFormat: InsertTextFormat.Snippet,
          textEdit: { range: Range.create(0, 0, 0, 2), newText: 'do$0' },
          additionalTextEdits: [TextEdit.insert(Position.create(0, 0), 'bar ')],
          preselect: true
        }]
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider))
      await nvim.input('iif')
      await helper.waitPopup()
      let items = await helper.getItems()
      let idx = items.findIndex(o => o.word == 'do' && o.source == 'edits')
      await helper.confirmCompletion(idx)
      await helper.waitFor('getline', ['.'], 'bar do')
      await helper.waitFor('col', ['.'], 7)
    })

    it('should fix cursor position with nested snippet on additionalTextEdits', async () => {
      let res = await snippetManager.insertSnippet('func($1)$0')
      expect(res).toBe(true)
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (): Promise<CompletionItem[]> => [{
          label: 'if',
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
      let [, lnum, col] = await nvim.call('getcurpos')
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
      let res = await helper.getItems()
      let idx = res.findIndex(o => o.source == 'edits')
      await helper.confirmCompletion(idx)
      await helper.waitFor('getline', ['.'], 'foo = foo0bar1')
      await helper.wait(50)
      expect(snippetManager.session).toBeDefined()
      let [, lnum, col] = await nvim.call('getcurpos')
      expect(lnum).toBe(1)
      expect(col).toBe(3)
    })

    it('should cancel current snippet session when additionalTextEdits inside snippet', async () => {
      await nvim.input('i')
      await snippetManager.insertSnippet('foo($1, $2)$0', true)
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
      let res = await helper.getItems()
      let idx = res.findIndex(o => o.source == 'edits')
      await helper.confirmCompletion(idx)
      await helper.waitFor('getline', ['.'], '(bar(), )')
      let col = await nvim.call('col', ['.'])
      expect(col).toBe(6)
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
      await helper.selectItem('foo')
      await helper.waitFor('getline', ['.'], 'foo')
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
      await helper.wait(50)
      let res = await helper.getItems()
      expect(res.length).toBe(1)
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
  })
})
