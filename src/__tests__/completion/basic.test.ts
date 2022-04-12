import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable } from 'vscode-jsonrpc'
import sources from '../../sources'
import { CompleteOption, CompleteResult, ISource, SourceType } from '../../types'
import { disposeAll } from '../../util'
import completion from '../../completion'
import workspace from '../../workspace'
import helper from '../helper'
import { CompletionItemProvider } from '../../provider'
import languages from '../../languages'
import { CompletionItem, CompletionList, InsertTextFormat, Position, Range, TextEdit } from 'vscode-languageserver-types'
import events from '../../events'
import snippetManager from '../../snippets/manager'

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

describe('completion', () => {

  describe('preferences', () => {
    describe('disableKind & disableMenu', () => {
      it('should hide kind and menu when configured', async () => {
        helper.updateConfiguration('suggest.disableKind', true)
        helper.updateConfiguration('suggest.disableMenu', true)
        await nvim.setLine('fball football')
        await nvim.input('of')
        await helper.waitPopup()
        let items = await helper.getItems()
        expect(items[0].kind).toBeUndefined()
        expect(items[0].menu).toBeUndefined()
      })
    })

    describe('characters only', () => {
      beforeEach(() => {
        helper.updateConfiguration('suggest.asciiCharactersOnly', true)
      })

      it('should trigger with none ascii characters', async () => {
        await nvim.setLine('world')
        await nvim.input('o')
        await nvim.input('你')
        await nvim.input('w')
        let visible = await helper.visible('world', 'around')
        expect(visible).toBe(true)
      })

      it('should not trigger with none ascii characters', async () => {
        await nvim.setLine('你好')
        await nvim.input('o')
        await nvim.input('你')
        await helper.wait(50)
        let visible = await helper.pumvisible()
        expect(visible).toBe(false)
      })
    })

    describe('ignore by regex', () => {
      it('should trigger with number input', async () => {
        await nvim.setLine('1357')
        await nvim.input('o')
        await nvim.input('1')
        let visible = await helper.visible('1357', 'around')
        expect(visible).toBe(true)
      })

      it('should not trigger with number input', async () => {
        helper.updateConfiguration('suggest.ignoreRegexps', ['[0-9]+'])
        await nvim.setLine('1357')
        await nvim.input('o')
        await nvim.input('1')
        let visible = await helper.pumvisible()
        expect(visible).toBe(false)
      })
    })

    describe('selection', () => {
      it('should not select when selection is none', async () => {
        helper.updateConfiguration('suggest.enablePreselect', true)
        let doc = await workspace.document
        await nvim.setLine('around')
        await doc.synchronize()
        await nvim.input('oa')
        await helper.visible('around')
        await nvim.call('nvim_select_popupmenu_item', [0, false, false, {}])
        await nvim.input('<C-y>')
        await nvim.input('<esc>')
        await nvim.input('oa')
        await helper.visible('around')
        let context = await nvim.getVar('coc#_context') as any
        expect(context.preselect).toBe(-1)
      })

      it('should select recent used item', async () => {
        helper.updateConfiguration('suggest.selection', 'recentlyUsed')
        helper.updateConfiguration('suggest.enablePreselect', true)
        let doc = await workspace.document
        await nvim.setLine('result')
        await doc.synchronize()
        await nvim.input('or')
        await helper.visible('result')
        await nvim.call('nvim_select_popupmenu_item', [0, false, false, {}])
        await nvim.input('<C-y>')
        await nvim.input('<esc>')
        await nvim.input('or')
        await helper.visible('result')
      })

      it('should select recent item by prefix', async () => {
        helper.updateConfiguration('suggest.selection', 'recentlyUsedByPrefix')
        helper.updateConfiguration('suggest.enablePreselect', true)
        let doc = await workspace.document
        await nvim.setLine('world')
        await doc.synchronize()
        await nvim.input('owo')
        await helper.visible('world')
        await nvim.call('nvim_select_popupmenu_item', [0, false, false, {}])
        await nvim.input('<C-y>')
        await nvim.input('<esc>')
        await nvim.input('ow')
        await helper.visible('world')
        let context = await nvim.getVar('coc#_context') as any
        expect(context.preselect).toBe(-1)
      })
    })

  })

  describe('doComplete()', () => {
    it('should start completion', async () => {
      let doc = await workspace.document
      helper.updateConfiguration('suggest.autoTrigger', 'none')
      await nvim.setLine('foo football')
      await doc.synchronize()
      await nvim.input('of')
      let option: CompleteOption = await nvim.call('coc#util#get_complete_option')
      await completion.startCompletion(option)
      await helper.waitPopup()
      expect(completion.isActivated).toBe(true)
    })

    it('should deactivate on doComplete error', async () => {
      await helper.createDocument()
      await nvim.command(`edit +setl\\ buftype=nofile`)
      let option: CompleteOption = await nvim.call('coc#util#get_complete_option')
      await completion.startCompletion(option)
      expect(completion.isActivated).toBe(false)
    })

    it('should show slow source', async () => {
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'slow',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise(resolve => {
          setTimeout(() => {
            resolve({ items: [{ word: 'foo' }, { word: 'bar' }] })
          }, 50)
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i.')
      await helper.waitPopup()
      expect(completion.isActivated).toBe(true)
      let items = await helper.items()
      expect(items.length).toBe(2)
    })

    it('should show items before slow source finished', async () => {
      let source: ISource = {
        name: 'fast',
        enable: true,
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise(resolve => {
          resolve({ items: [{ word: 'foo' }, { word: 'bar' }] })
        })
      }
      disposables.push(sources.addSource(source))
      let finished = false
      let slowSource: ISource = {
        name: 'slow',
        enable: true,
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise(resolve => {
          setTimeout(() => {
            finished = true
            resolve({ items: [{ word: 'world' }] })
          }, 100)
        })
      }
      disposables.push(sources.addSource(slowSource))
      await nvim.input('if')
      await helper.waitPopup()
      expect(finished).toBe(false)
    })
  })

  describe('resumeCompletion()', () => {
    it('should stop if no filtered items', async () => {
      await nvim.setLine('foo ')
      await nvim.input('Af')
      await helper.waitPopup()
      expect(completion.isActivated).toBe(true)
      await nvim.input('d')
      await helper.waitValue(() => {
        return completion.isActivated
      }, false)
    })

    it('should deactivate without filtered items', async () => {
      await nvim.setLine('foo fbi ')
      await nvim.input('Af')
      await helper.waitPopup()
      await nvim.input('c')
      await helper.waitFor('pumvisible', [], 0)
      let items = await helper.items()
      expect(items.length).toBe(0)
      expect(completion.isActivated).toBe(false)
    })

    it('should deactivate when insert space', async () => {
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'empty',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise(resolve => {
          resolve({ items: [{ word: 'foo bar' }] })
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i.')
      await helper.waitPopup()
      expect(completion.isActivated).toBe(true)
      let items = await helper.items()
      expect(items[0].word).toBe('foo bar')
      await nvim.input(' ')
      await helper.waitFor('pumvisible', [], 0)
    })

    it('should use resume input to filter', async () => {
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'source',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: (): Promise<CompleteResult> => new Promise(resolve => {
          setTimeout(() => {
            resolve({ items: [{ word: 'foo' }, { word: 'bar' }] })
          }, 60)
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i.')
      await helper.wait(20)
      await nvim.input('f')
      await helper.waitPopup()
      expect(completion.isActivated).toBe(true)
      let items = await helper.items()
      expect(items.length).toBe(1)
      expect(items[0].word).toBe('foo')
    })

    it('should filter slow source', async () => {
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'slow',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: (): Promise<CompleteResult> => new Promise(resolve => {
          setTimeout(() => {
            resolve({ items: [{ word: 'foo' }, { word: 'bar' }] })
          }, 100)
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i.f')
      await helper.waitPopup()
      await nvim.input('o')
      await helper.waitFor('eval', ['len(coc#_context["candidates"])'], 1)
      let items = await helper.items()
      expect(items.length).toBe(1)
      expect(items[0].word).toBe('foo')
    })

    it('should complete inComplete source', async () => {
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'inComplete',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: async (opt: CompleteOption): Promise<CompleteResult> => {
          if (opt.input.length <= 1) {
            return { isIncomplete: true, items: [{ word: 'foo' }, { word: opt.input }] }
          }
          await helper.wait(10)
          return { isIncomplete: false, items: [{ word: 'foo' }, { word: opt.input }] }
        }
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i.')
      await helper.waitPopup()
      expect(completion.isActivated).toBe(true)
      await nvim.input('a')
      await helper.wait(20)
      await nvim.input('b')
    })

    it('should not complete inComplete source when isIncomplete is false', async () => {
      let lastOption: CompleteOption
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'inComplete',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: async (opt: CompleteOption): Promise<CompleteResult> => {
          lastOption = opt
          await helper.wait(30)
          if (opt.input.length <= 1) {
            return { isIncomplete: true, items: [{ word: 'foobar' }] }
          }
          return { isIncomplete: false, items: [{ word: 'foobar' }] }
        }
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i.')
      await helper.waitPopup()
      expect(completion.isActivated).toBe(true)
      await nvim.input('fo')
      await helper.wait(50)
      await nvim.input('b')
      await helper.wait(50)
      expect(completion.isActivated).toBe(true)
    })

    it('should filter when item has selected with noselect', async () => {
      helper.updateConfiguration('suggest.noselect', false)
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'filter',
        sourceType: SourceType.Service,
        doComplete: (): Promise<CompleteResult> => {
          return Promise.resolve({ items: [{ word: 'foo' }, { word: 'fox' }, { word: 'fat' }] })
        }
      }
      disposables.push(sources.addSource(source))
      await nvim.input('if')
      await helper.waitPopup()
      await nvim.input('o')
      await helper.waitFor('eval', ['len(coc#_context["candidates"])'], 2)
      await nvim.input('o')
      await helper.waitFor('eval', ['len(coc#_context["candidates"])'], 1)
    })

    it('should filter when type character after item selected without handle complete done', async () => {
      let input: string
      let fn = jest.fn()
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'filter',
        sourceType: SourceType.Service,
        doComplete: (opt): Promise<CompleteResult> => {
          input = opt.input
          if (input == 'f') return Promise.resolve({ items: [{ word: 'fo' }] })
          if (input == 'foo') return Promise.resolve({ items: [{ word: 'foobar' }, { word: 'foot' }] })
          return Promise.resolve({ items: [] })
        },
        onCompleteDone: () => {
          fn()
        }
      }
      disposables.push(sources.addSource(source))
      await nvim.input('if')
      await helper.waitPopup()
      await nvim.input('<C-n>')
      await helper.wait(20)
      await nvim.input('o')
      await helper.waitPopup()
      expect(fn).toBeCalledTimes(0)
    })
  })

  describe('TextChangedI', () => {
    it('should respect commitCharacter on TextChangedI', async () => {
      helper.updateConfiguration('suggest.acceptSuggestionOnCommitCharacter', true)
      helper.updateConfiguration('suggest.noselect', false)
      let source: ISource = {
        enable: true,
        name: 'commit',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: (opt: CompleteOption): Promise<CompleteResult> => {
          if (opt.triggerCharacter == '.') {
            return Promise.resolve({ items: [{ word: 'bar' }] })
          }
          return Promise.resolve({ items: [{ word: 'foo' }] })
        },
        shouldCommit: (_item, character) => character == '.'
      }
      disposables.push(sources.addSource(source))
      await nvim.input('if')
      await helper.waitPopup()
      await nvim.input('.')
      await helper.waitFor('getline', ['.'], 'foo.')
    })
  })

  describe('TextChangedP', () => {
    it('should stop when input length below option input length', async () => {
      await nvim.setLine('foo fbi ')
      await nvim.input('Af')
      await helper.waitPopup()
      await nvim.input('<backspace>')
      await helper.waitFor('getline', ['.'], 'foo fbi ')
      expect(completion.isActivated).toBe(false)
    })

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
      await helper.selectCompleteItem(0)
      await helper.waitFor('getline', ['.'], 'barfoo')
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
      await helper.selectCompleteItem(0)
      await helper.waitFor('getline', ['.'], 't?.name')
    })

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

    it('should provide word when textEdit after startcol', async () => {
      // some LS would send textEdit after first character,
      // need fix the word from newText
      let provider: CompletionItemProvider = {
        provideCompletionItems: async (_, position): Promise<CompletionItem[]> => {
          if (position.line != 0) return null
          return [{
            label: 'bar',
            filterText: 'ar',
            textEdit: {
              range: Range.create(0, 1, 0, 1),
              newText: 'ar'
            }
          }]
        }
      }
      disposables.push(languages.registerCompletionItemProvider('edits', 'edit', null, provider))
      await nvim.input('ib')
      await helper.waitPopup()
      let context = await nvim.getVar('coc#_context') as any
      expect(context.start).toBe(1)
      expect(context.candidates[0].word).toBe('ar')
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
      await nvim.eval('feedkeys("\\<C-n>", "in")')
      await helper.waitFor('getline', ['.'], '?foo')
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
      let idx = res.findIndex(o => o.menu == '[edit]')
      await helper.selectCompleteItem(idx)
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
      let idx = items.findIndex(o => o.word == 'do' && o.menu == '[edit]')
      await helper.selectCompleteItem(idx)
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
      await helper.selectCompleteItem(0)
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
      let idx = res.findIndex(o => o.menu == '[edit]')
      await helper.selectCompleteItem(idx)
      await helper.waitFor('getline', ['.'], 'foo = foo0bar1')
      await helper.wait(50)
      expect(snippetManager.session).toBeDefined()
      let [, lnum, col] = await nvim.call('getcurpos')
      expect(lnum).toBe(1)
      expect(col).toBe(3)
    })

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
      await nvim.input('<C-n>')
      await helper.waitFor('getline', ['.'], 'foo')
    })

    it('should filter on none keyword input', async () => {
      let source: ISource = {
        priority: 99,
        enable: true,
        name: 'temp',
        sourceType: SourceType.Service,
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => Promise.resolve({ items: [{ word: 'foo#abc' }] }),
      }
      disposables.push(sources.addSource(source))
      await nvim.input('if')
      await helper.waitPopup()
      await nvim.input('#')
      await helper.wait(50)
      let items = await helper.getItems()
      expect(items[0].word).toBe('foo#abc')
    })

    it('should cancel on InsertLeave', async () => {
      let source: ISource = {
        priority: 99,
        enable: true,
        name: 'temp',
        sourceType: SourceType.Service,
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => Promise.resolve({ items: [{ word: 'foo#abc' }] }),
      }
      disposables.push(sources.addSource(source))
      await nvim.input('if')
      await helper.waitPopup()
      await nvim.input('<esc>')
      await helper.wait(50)
      expect(completion.isActivated).toBe(false)
    })

    it('should cancel on CursorMoved', async () => {
      let buf = await nvim.buffer
      await buf.setLines(['', 'bar'], { start: 0, end: -1, strictIndexing: false })
      let source: ISource = {
        priority: 99,
        enable: true,
        name: 'temp',
        sourceType: SourceType.Service,
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => Promise.resolve({ items: [{ word: 'foo#abc' }] }),
      }
      disposables.push(sources.addSource(source))
      await nvim.input('if')
      await helper.waitPopup()
      void events.fire('CompleteDone', [{}])
      await helper.wait(10)
      await events.fire('CursorMovedI', [buf.id, [2, 1]])
      expect(completion.isActivated).toBe(false)
      await nvim.input('<esc>')
    })

    it('should use source-provided score', async () => {
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'source',
        sourceType: SourceType.Service,
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => Promise.resolve({
          items: [
            { word: 'candidate_a', sourceScore: 0.1 },
            { word: 'candidate_b', sourceScore: 10 },
            { word: 'candidate_c' },
          ]
        }),
      }
      disposables.push(sources.addSource(source))
      await nvim.input('ocand')
      await helper.waitPopup()
      let items = await helper.getItems()
      expect(items[0].word).toBe('candidate_b')
      expect(items[1].word).toBe('candidate_c')
      expect(items[2].word).toBe('candidate_a')
    })

    it('should do resolve for complete item', async () => {
      let resolved = false
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'resolve',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => Promise.resolve({ items: [{ word: 'foo' }] }),
        onCompleteResolve: item => {
          resolved = true
          item.info = 'detail'
        }
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i.')
      await helper.waitPopup()
      await helper.selectCompleteItem(0)
      await helper.waitFor('getline', ['.'], '.foo')
      expect(resolved).toBe(true)
    })
  })

  describe('CompleteDone', () => {
    it('should fix word on CompleteDone', async () => {
      let doc = await workspace.document
      await nvim.setLine('fball football')
      await doc.synchronize()
      await nvim.input('i')
      await nvim.call('cursor', [1, 2])
      let option: CompleteOption = await nvim.call('coc#util#get_complete_option')
      await completion.startCompletion(option)
      await helper.waitPopup()
      let items = await helper.items()
      expect(items.length).toBe(1)
      await nvim.input('<C-n>')
      await helper.wait(30)
      await nvim.call('coc#_select')
      await helper.waitFor('getline', ['.'], 'football football')
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
      await nvim.input('if')
      await helper.waitPopup()
      await helper.selectCompleteItem(0)
      await helper.waitFor('getline', ['.'], 'foo')
    })
  })

  describe('InsertEnter', () => {
    beforeEach(() => {
      helper.updateConfiguration('suggest.triggerAfterInsertEnter', true)
    })

    it('should trigger completion if triggerAfterInsertEnter is true', async () => {
      await nvim.setLine('foo fo')
      await nvim.input('A')
      await helper.waitPopup()
      expect(completion.isActivated).toBe(true)
    })

    it('should not trigger when input length too small', async () => {
      await nvim.setLine('foo ')
      await nvim.input('A')
      await helper.wait(30)
      expect(completion.isActivated).toBe(false)
    })
  })

  describe('trigger completion', () => {
    it('should not trigger if autoTrigger is none', async () => {
      helper.updateConfiguration('suggest.autoTrigger', 'none')
      await nvim.setLine('foo ')
      await nvim.input('Af')
      await helper.wait(50)
      expect(completion.isActivated).toBe(false)
    })

    it('should trigger complete on trigger patterns match', async () => {
      let source: ISource = {
        priority: 99,
        enable: true,
        name: 'temp',
        triggerPatterns: [/EM/],
        sourceType: SourceType.Service,
        doComplete: (opt: CompleteOption): Promise<CompleteResult> => {
          if (!opt.input.startsWith('EM')) return null
          return Promise.resolve({
            items: [
              { word: 'foo', filterText: 'EMfoo' },
              { word: 'bar', filterText: 'EMbar' }
            ]
          })
        },
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i')
      await nvim.input('EM')
      await helper.waitPopup()
      let items = await helper.getItems()
      expect(items.length).toBe(2)
    })
    it('should not show word of word source on empty input', async () => {
      let doc = await workspace.document
      await nvim.setLine('foo bar')
      await doc.synchronize()
      await nvim.input('of')
      let res = await helper.visible('foo', 'around')
      expect(res).toBe(true)
      await nvim.input('<backspace>')
      await helper.waitFor('pumvisible', [], 0)
    })

    it('should trigger on first letter insert', async () => {
      await nvim.setLine('foo bar')
      await helper.wait(30)
      await nvim.input('of')
      let res = await helper.visible('foo', 'around')
      expect(res).toBe(true)
    })

    it('should trigger on force refresh', async () => {
      let doc = await workspace.document
      await nvim.setLine('foo f')
      await doc.synchronize()
      await nvim.input('A')
      await nvim.call('coc#start')
      let res = await helper.visible('foo', 'around')
      expect(res).toBe(true)
    })

    it('should filter and sort on increment search', async () => {
      let doc = await workspace.document
      await nvim.setLine('forceDocumentSync format  fallback')
      await doc.synchronize()
      await nvim.input('of')
      await helper.waitPopup()
      let items = await helper.getItems()
      await nvim.input('oa')
      await helper.waitFor('eval', ['len(coc#_context["candidates"])'], 1)
      items = await helper.getItems()
      expect(items.findIndex(o => o.word == 'fallback')).toBe(-1)
    })

    it('should not trigger on insert enter', async () => {
      let doc = await workspace.document
      await nvim.setLine('foo bar')
      await doc.synchronize()
      await nvim.input('o')
      let visible = await nvim.call('pumvisible')
      expect(visible).toBe(0)
    })

    it('should filter on fast input', async () => {
      let doc = await workspace.document
      await nvim.setLine('foo bar')
      await doc.synchronize()
      await nvim.input('oba')
      await helper.waitPopup()
      let items = await helper.getItems()
      let item = items.find(o => o.word == 'foo')
      expect(item).toBeFalsy()
      expect(items[0].word).toBe('bar')
    })

    it('should filter completion when type none trigger character', async () => {
      let source: ISource = {
        name: 'test',
        priority: 10,
        enable: true,
        firstMatch: false,
        sourceType: SourceType.Native,
        triggerCharacters: [],
        doComplete: async (): Promise<CompleteResult> => {
          let result: CompleteResult = {
            items: [{ word: 'if(' }]
          }
          return Promise.resolve(result)
        }
      }
      disposables.push(sources.addSource(source))
      await nvim.setLine('')
      await nvim.input('iif')
      await helper.waitPopup()
      await nvim.input('(')
      await helper.wait(50)
      let res = await helper.pumvisible()
      expect(res).toBe(true)
    })

    it('should trigger on triggerCharacters', async () => {
      let source: ISource = {
        name: 'trigger',
        enable: true,
        triggerCharacters: ['.'],
        doComplete: async (): Promise<CompleteResult> => Promise.resolve({
          items: [{ word: 'foo' }]
        })
      }
      disposables.push(sources.addSource(source))
      let source1: ISource = {
        name: 'trigger1',
        enable: true,
        triggerCharacters: ['.'],
        doComplete: async (): Promise<CompleteResult> => Promise.resolve({
          items: [{ word: 'bar' }]
        })
      }
      disposables.push(sources.addSource(source1))
      await nvim.input('i.')
      await helper.waitPopup()
      let items = await helper.getItems()
      expect(items.length).toBe(2)
    })

    it('should fix start column', async () => {
      let source: ISource = {
        name: 'test',
        priority: 10,
        enable: true,
        firstMatch: false,
        sourceType: SourceType.Native,
        triggerCharacters: [],
        doComplete: async (): Promise<CompleteResult> => {
          let result: CompleteResult = {
            startcol: 0,
            items: [{ word: 'foo.bar' }]
          }
          return Promise.resolve(result)
        }
      }
      let disposable = sources.addSource(source)
      await nvim.setLine('foo.')
      await nvim.input('Ab')
      await helper.waitPopup()
      let val = await nvim.getVar('coc#_context') as any
      expect(val.start).toBe(0)
      disposable.dispose()
    })

    it('should should complete items without input', async () => {
      await workspace.document
      let source: ISource = {
        enable: true,
        name: 'trigger',
        priority: 10,
        sourceType: SourceType.Native,
        doComplete: async (): Promise<CompleteResult> => Promise.resolve({
          items: [{ word: 'foo' }, { word: 'bar' }]
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.command('inoremap <silent><nowait><expr> <c-space> coc#refresh()')
      await nvim.input('i')
      await helper.wait(30)
      await nvim.input('<c-space>')
      await helper.waitPopup()
      let items = await helper.getItems()
      expect(items.length).toBeGreaterThan(1)
    })

    it('should show float window', async () => {
      let source: ISource = {
        name: 'float',
        priority: 10,
        enable: true,
        sourceType: SourceType.Native,
        doComplete: (): Promise<CompleteResult> => Promise.resolve({
          items: [{ word: 'foo', info: 'bar' }]
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i')
      await helper.wait(30)
      await nvim.input('f')
      await helper.waitPopup()
      await nvim.call('nvim_select_popupmenu_item', [0, false, false, {}])
      await helper.wait(100)
      let hasFloat = await nvim.call('coc#float#has_float')
      expect(hasFloat).toBe(1)
      let res = await helper.visible('foo', 'float')
      expect(res).toBe(true)
    })

    it('should trigger on triggerPatterns', async () => {
      let source: ISource = {
        name: 'pattern',
        priority: 10,
        enable: true,
        sourceType: SourceType.Native,
        triggerPatterns: [/\w+\.$/],
        doComplete: async (): Promise<CompleteResult> => Promise.resolve({
          items: [{ word: 'foo' }]
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i')
      await helper.wait(10)
      await nvim.input('.')
      await helper.wait(30)
      let pumvisible = await nvim.call('pumvisible')
      expect(pumvisible).toBe(0)
      await nvim.input('a')
      await helper.wait(30)
      await nvim.input('.')
      await helper.waitPopup()
      let res = await helper.visible('foo', 'pattern')
      expect(res).toBe(true)
    })

    it('should not trigger triggerOnly source', async () => {
      await nvim.setLine('foo bar')
      let source: ISource = {
        name: 'pattern',
        triggerOnly: true,
        priority: 10,
        enable: true,
        sourceType: SourceType.Native,
        triggerPatterns: [/^From:\s*/],
        doComplete: async (): Promise<CompleteResult> => Promise.resolve({
          items: [{ word: 'foo' }]
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('o')
      await helper.wait(10)
      await nvim.input('f')
      await helper.wait(10)
      let res = await helper.visible('foo', 'around')
      expect(res).toBe(true)
      let items = await helper.items()
      expect(items.length).toBe(1)
    })

    it('should not trigger when cursor moved', async () => {
      let source: ISource = {
        name: 'trigger',
        priority: 10,
        enable: true,
        sourceType: SourceType.Native,
        triggerCharacters: ['.'],
        doComplete: async (): Promise<CompleteResult> => Promise.resolve({
          items: [{ word: 'foo' }]
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.setLine('.a')
      await nvim.input('A')
      await nvim.eval('feedkeys("\\<bs>")')
      await helper.wait(10)
      await nvim.eval('feedkeys("\\<left>")')
      await helper.wait(20)
      let visible = await nvim.call('pumvisible')
      expect(visible).toBe(0)
    })

    it('should trigger when completion is not completed', async () => {
      let token: CancellationToken
      let promise = new Promise(resolve => {
        let source: ISource = {
          name: 'completion',
          priority: 10,
          enable: true,
          sourceType: SourceType.Native,
          triggerCharacters: ['.'],
          doComplete: async (opt, cancellationToken): Promise<CompleteResult> => {
            if (opt.triggerCharacter != '.') {
              token = cancellationToken
              resolve(undefined)
              return new Promise<CompleteResult>((resolve, reject) => {
                let timer = setTimeout(() => {
                  resolve({ items: [{ word: 'foo' }] })
                }, 200)
                if (cancellationToken.isCancellationRequested) {
                  clearTimeout(timer)
                  reject(new Error('Cancelled'))
                }
              })
            }
            return Promise.resolve({
              items: [{ word: 'bar' }]
            })
          }
        }
        disposables.push(sources.addSource(source))
      })
      await nvim.input('if')
      await promise
      await nvim.input('.')
      await helper.waitPopup()
      await helper.visible('bar', 'completion')
      expect(token).toBeDefined()
      expect(token.isCancellationRequested).toBe(true)
    })
  })

  describe('completion results', () => {
    it('should limit results for low priority source', async () => {
      let doc = await workspace.document
      helper.updateConfiguration('suggest.lowPrioritySourceLimit', 2)
      await nvim.setLine('filename filepath find filter findIndex')
      await doc.synchronize()
      await nvim.input('of')
      await helper.waitPopup()
      let items = await helper.getItems()
      items = items.filter(o => o.menu == '[A]')
      expect(items.length).toBe(2)
    })

    it('should limit result for high priority source', async () => {
      helper.updateConfiguration('suggest.highPrioritySourceLimit', 2)
      let source: ISource = {
        name: 'high',
        priority: 90,
        enable: true,
        sourceType: SourceType.Native,
        triggerCharacters: ['.'],
        doComplete: async (): Promise<CompleteResult> => Promise.resolve({
          items: ['filename', 'filepath', 'filter', 'file'].map(key => ({ word: key }))
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i.')
      await helper.waitPopup()
      let items = await helper.getItems()
      expect(items.length).toBeGreaterThan(1)
    })

    it('should truncate label of complete items', async () => {
      helper.updateConfiguration('suggest.labelMaxLength', 10)
      let source: ISource = {
        name: 'high',
        priority: 90,
        enable: true,
        sourceType: SourceType.Native,
        triggerCharacters: ['.'],
        doComplete: async (): Promise<CompleteResult> => Promise.resolve({
          items: ['a', 'b', 'c', 'd'].map(key => ({ word: key.repeat(20) }))
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i.')
      await helper.waitPopup()
      let items = await helper.getItems()
      for (let item of items) {
        if (!item.abbr) continue
        expect(item.abbr.length).toBeLessThanOrEqual(10)
      }
    })

    it('should delete previous items when complete items is null', async () => {
      let source1: ISource = {
        name: 'source1',
        priority: 90,
        enable: true,
        sourceType: SourceType.Native,
        triggerCharacters: ['.'],
        doComplete: async (): Promise<CompleteResult> => Promise.resolve({
          items: [{ word: 'foo', dup: 1 }]
        })
      }
      let source2: ISource = {
        name: 'source2',
        priority: 90,
        enable: true,
        sourceType: SourceType.Native,
        triggerCharacters: ['.'],
        doComplete: async (opt: CompleteOption): Promise<CompleteResult> => {
          let result: CompleteResult = opt.input == 'foo' ? null : {
            items: [{ word: 'foo', dup: 1 }], isIncomplete: true
          }
          return Promise.resolve(result)
        }
      }
      disposables.push(sources.addSource(source1))
      disposables.push(sources.addSource(source2))
      await nvim.input('i')
      await nvim.input('.f')
      await helper.waitPopup()
      let items = await helper.getItems()
      expect(items.length).toEqual(2)
      await nvim.input('oo')
      await helper.waitFor('eval', ['len(coc#_context["candidates"])'], 1)
      items = await helper.getItems()
      expect(items.length).toEqual(1)
      expect(items[0].word).toBe('foo')
    })
  })

  describe('fix indent', () => {
    it('should indent lines on TextChangedP #1', async () => {
      let doc = await workspace.document as any
      doc._indentkeys = '=~end,0=\\item'
      let source: ISource = {
        name: 'source1',
        priority: 90,
        enable: true,
        sourceType: SourceType.Native,
        doComplete: async (): Promise<CompleteResult> => Promise.resolve({
          items: [
            { word: 'item' },
            { word: 'items' },
            { word: 'END' },
            { word: 'ENDIF' }
          ]
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i')
      await helper.wait(10)
      await nvim.input('  \\ite')
      await helper.waitPopup()
      await nvim.input('m')
      await helper.waitFor('getline', ['.'], '\\item')
      await nvim.input('<cr>')
      await helper.wait(30)
      await nvim.input('  END')
      await helper.waitFor('getline', ['.'], 'END')
    })

    it('should trigger completion after indent change', async () => {
      let doc = await workspace.document as any
      doc._indentkeys = '=end'
      let source: ISource = {
        name: 'source1',
        priority: 90,
        enable: true,
        sourceType: SourceType.Native,
        doComplete: async (): Promise<CompleteResult> => Promise.resolve({
          items: [
            { word: 'endif' },
            { word: 'endfunction' }
          ]
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i')
      await helper.wait(10)
      await nvim.input('  en')
      await helper.waitPopup()
      await nvim.input('d')
      await helper.waitFor('getline', ['.'], 'end')
      await helper.waitPopup()
      let items = await helper.getItems()
      expect(items.length).toBeGreaterThan(0)
    })
  })

  describe('Character insert', () => {
    beforeAll(() => {
      let source: ISource = {
        name: 'insert',
        priority: 10,
        enable: true,
        firstMatch: false,
        sourceType: SourceType.Native,
        triggerCharacters: ['.'],
        doComplete: async (opt): Promise<CompleteResult> => {
          if (opt.word === 'f') return { items: [{ word: 'foo' }] }
          if (!opt.triggerCharacter) return { items: [] }
          let result: CompleteResult = {
            items: [{ word: 'one' }, { word: 'two' }]
          }
          return Promise.resolve(result)
        }
      }
      sources.addSource(source)
    })

    afterAll(() => {
      sources.removeSource('insert')
    })

    it('should keep selected text after text change', async () => {
      let doc = await workspace.document
      let text = 'foo bar f'
      await nvim.setLine(text)
      await doc.synchronize()
      await nvim.input('A')
      await helper.triggerCompletion('insert')
      await helper.waitPopup()
      await nvim.call('nvim_select_popupmenu_item', [0, true, false, {}])
      let line = await nvim.line
      expect(line).toBe('foo bar foo')
      await nvim.exec(`
      noa call setline('.', '${text}oobar')
      noa call cursor(1,${text.length + 6})
      `)
      await helper.wait(50)
      let res = await helper.pumvisible()
      expect(res).toBe(false)
      line = await nvim.line
      expect(line).toBe('foo bar foobar')
    })

    it('should trigger specific sources by api', async () => {
      let text = 'foo bar f'
      await nvim.setLine(text)
      await nvim.input('A')
      await helper.triggerCompletion('insert')
      await helper.waitPopup()
    })
  })
})
