import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-jsonrpc'
import { CompletionItem, CompletionList, InsertTextFormat, Position, Range, TextEdit } from 'vscode-languageserver-types'
import completion from '../../completion'
import languages from '../../languages'
import { CompletionItemProvider } from '../../provider'
import snippetManager from '../../snippets/manager'
import sources from '../../sources'
import { CompleteOption, CompleteResult, ISource, SourceType } from '../../types'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

beforeEach(async () => {
  disposables = []
  helper.updateConfiguration('suggest.triggerCompletionWait', 0)
  await helper.createDocument()
  await nvim.call('feedkeys', [String.fromCharCode(27), 'in'])
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  disposeAll(disposables)
  await helper.reset()
})

describe('completion events', () => {

  it('should load preferences', () => {
    let minTriggerInputLength = completion.config.minTriggerInputLength
    expect(minTriggerInputLength).toBe(1)
  })

  it('should reload preferences onChange', () => {
    let { configurations } = workspace
    configurations.updateUserConfig({ 'suggest.maxCompleteItemCount': 30 })
    let snippetIndicator = completion.config.maxItemCount
    expect(snippetIndicator).toBe(30)
  })
})

describe('completion start', () => {

  it('should deactivate on doComplete error', async () => {
    let c: any = completion
    let fn = c._doComplete
    disposables.push({
      dispose: () => {
        c._doComplete = fn
      }
    })
    c._doComplete = async () => {
      throw new Error('fake')
    }
    let option: CompleteOption = await nvim.call('coc#util#get_complete_option')
    await completion.startCompletion(option)
    expect(completion.isActivated).toBe(false)
  })

  it('should start completion', async () => {
    await nvim.setLine('foo football')
    await nvim.input('a')
    await nvim.call('cursor', [1, 2])
    let option: CompleteOption = await nvim.call('coc#util#get_complete_option')
    await completion.startCompletion(option)
    expect(completion.isActivated).toBe(true)
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
        }, 300)
      })
    }
    disposables.push(sources.addSource(slowSource))
    await nvim.input('if')
    await helper.waitPopup()
    expect(finished).toBe(false)
    completion.stop()
  })
})

describe('completion resumeCompletion', () => {

  it('should stop if no filtered items', async () => {
    await nvim.setLine('foo ')
    await helper.wait(50)
    await nvim.input('Af')
    await helper.waitPopup()
    expect(completion.isActivated).toBe(true)
    await nvim.input('d')
    await helper.wait(60)
    expect(completion.isActivated).toBe(false)
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
    sources.addSource(source)
    await nvim.input('i.')
    await helper.waitPopup()
    expect(completion.isActivated).toBe(true)
    sources.removeSource(source)
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
    sources.addSource(source)
    await nvim.input('i.')
    await helper.wait(20)
    await nvim.input('f')
    await helper.waitPopup()
    expect(completion.isActivated).toBe(true)
    let items = await helper.items()
    expect(items.length).toBe(1)
    expect(items[0].word).toBe('foo')
    sources.removeSource(source)
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
    await helper.wait(50)
    expect(completion.isActivated).toBe(true)
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
})

describe('completion InsertEnter', () => {
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
    await helper.wait(20)
    expect(completion.isActivated).toBe(false)
  })
})

describe('completion TextChangedP', () => {
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
    await nvim.input('f')
    await helper.wait(50)
    await nvim.input('o')
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
    await helper.wait(200)
    let line = await nvim.line
    expect(line).toBe('?foo')
  })

  it('should fix cursor position with snippet on additionalTextEdits', async () => {
    let provider: CompletionItemProvider = {
      provideCompletionItems: async (): Promise<CompletionItem[]> => [{
        label: 'if',
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: { range: Range.create(0, 0, 0, 2), newText: 'if($1)' },
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
    let line: string
    for (let i = 0; i < 40; i++) {
      await helper.wait(50)
      line = await nvim.line
      if (line == 'bar if()') break
    }
    expect(line).toBe('bar if()')
    let [, lnum, col] = await nvim.call('getcurpos')
    expect(lnum).toBe(1)
    expect(col).toBe(8)
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
    let [, lnum, col] = await nvim.call('getcurpos')
    expect(lnum).toBe(1)
    expect(col).toBe(7)
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
    await helper.wait(200)
    let line = await nvim.line
    let [, lnum, col] = await nvim.call('getcurpos')
    expect(line).toBe('bar func(do)')
    expect(lnum).toBe(1)
    expect(col).toBe(12)
  })

  it('should fix cursor position and keep placeholder with snippet on additionalTextEdits', async () => {
    let doc = await helper.createDocument()
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
    let find = false
    for (let i = 0; i < 20; i++) {
      await helper.wait(i * 50)
      let line = await nvim.line
      if (line == 'foo = foo0bar1') {
        find = true
        break
      }
    }
    expect(find).toBe(true)
    expect(snippetManager.isActived(doc.bufnr)).toBe(true)
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
    sources.addSource(source)
    disposables.push({
      dispose: () => {
        sources.removeSource(source)
      }
    })
    await nvim.input('i.')
    await helper.waitPopup()
    await helper.selectCompleteItem(0)
    await helper.waitFor('getline', ['.'], '.foo')
    expect(resolved).toBe(true)
  })
})

describe('completion done', () => {
  it('should fix word on CompleteDone', async () => {
    await nvim.setLine('fball football')
    await nvim.input('i')
    await nvim.call('cursor', [1, 2])
    let option: CompleteOption = await nvim.call('coc#util#get_complete_option')
    await completion.startCompletion(option)
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

describe('completion option', () => {
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

describe('completion trigger', () => {
  it('should trigger completion on type trigger character', async () => {
    let source: ISource = {
      priority: 1,
      enable: true,
      name: 'trigger',
      sourceType: SourceType.Service,
      triggerCharacters: ['.'],
      doComplete: (opt: CompleteOption): Promise<CompleteResult> => {
        if (opt.triggerCharacter == '.') {
          return Promise.resolve({ items: [{ word: 'bar' }] })
        }
        return Promise.resolve({ items: [{ word: 'foo#bar' }] })
      }
    }
    sources.addSource(source)
    await nvim.input('i')
    await helper.wait(30)
    await nvim.input('.')
    await helper.waitPopup()
    let items = await helper.items()
    expect(items.length).toBeGreaterThan(0)
    sources.removeSource(source)
  })

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

  it('should trigger complete when pumvisible and triggerPatterns match', async () => {
    await nvim.setLine('EnumMember')
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
            { word: 'a', filterText: 'EMa' },
            { word: 'b', filterText: 'EMb' }
          ]
        })
      },
    }
    disposables.push(sources.addSource(source))
    await nvim.input('o')
    await helper.wait(10)
    await nvim.input('E')
    await helper.wait(30)
    await nvim.input('M')
    await helper.waitPopup()
    let items = await helper.getItems()
    expect(items.length).toBeGreaterThan(2)
  })
})

describe('completion TextChangedI', () => {
  it('should respect commitCharacter on TextChangedI', async () => {
    let source: ISource = {
      priority: 0,
      enable: true,
      name: 'slow',
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
    sources.addSource(source)
    await nvim.input('if')
    await helper.pumvisible()
    await helper.wait(50)
    await nvim.input('.')
    await helper.wait(50)
    sources.removeSource(source)
  })

  it('should cancel completion with same pretext', async () => {
    await nvim.setLine('foo')
    await nvim.input('of')
    await helper.pumvisible()
    await helper.wait(30)
    await nvim.call('coc#_cancel', [])
    let line = await nvim.line
    let visible = await nvim.call('pumvisible')
    expect(line).toBe('f')
    expect(visible).toBe(0)
  })
})
