import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable } from 'vscode-jsonrpc'
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

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  disposeAll(disposables)
  await helper.reset()
})

describe('completion', () => {

  describe('ascii characters only', () => {
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

  describe('suggest selection', () => {
    it('should not select when selection is none', async () => {
      helper.updateConfiguration('suggest.enablePreselect', true)
      let doc = await helper.createDocument()
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
      let doc = await helper.createDocument()
      await nvim.setLine('result')
      await doc.synchronize()
      await nvim.input('or')
      await helper.visible('result')
      await nvim.call('nvim_select_popupmenu_item', [0, false, false, {}])
      await nvim.input('<C-y>')
      await nvim.input('<esc>')
      await nvim.input('or')
      await helper.visible('result')
      let context = await nvim.getVar('coc#_context') as any
      expect(context.preselect).toBe(0)
    })

    it('should select recent item by prefix', async () => {
      helper.updateConfiguration('suggest.selection', 'recentlyUsedByPrefix')
      helper.updateConfiguration('suggest.enablePreselect', true)
      let doc = await helper.createDocument()
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
      await nvim.input('o')
      await helper.wait(50)
      context = await nvim.getVar('coc#_context') as any
      expect(context.preselect).toBe(0)
    })
  })

  describe('trigger completion', () => {
    it('should not show word of word source on empty input', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('foo bar')
      await doc.synchronize()
      await nvim.input('of')
      let res = await helper.visible('foo', 'around')
      expect(res).toBe(true)
      await nvim.input('<backspace>')
      await helper.waitFor('pumvisible', [], 0)
    })

    it('should trigger on first letter insert', async () => {
      await helper.edit()
      await nvim.setLine('foo bar')
      await helper.wait(30)
      await nvim.input('of')
      let res = await helper.visible('foo', 'around')
      expect(res).toBe(true)
    })

    it('should trigger on force refresh', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('foo f')
      await doc.synchronize()
      await nvim.input('A')
      await nvim.call('coc#start')
      let res = await helper.visible('foo', 'around')
      expect(res).toBe(true)
    })

    it('should filter and sort on increment search', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('forceDocumentSync format  fallback')
      await doc.synchronize()
      await nvim.input('of')
      await helper.waitPopup()
      let items = await helper.getItems()
      let l = items.length
      await nvim.input('oa')
      await helper.wait(100)
      items = await helper.getItems()
      expect(items.findIndex(o => o.word == 'fallback')).toBe(-1)
      expect(items.length).toBeLessThan(l)
    })

    it('should not trigger on insert enter', async () => {
      let doc = await helper.createDocument()
      await nvim.setLine('foo bar')
      await doc.synchronize()
      await nvim.input('o')
      let visible = await nvim.call('pumvisible')
      expect(visible).toBe(0)
    })

    it('should filter on fast input', async () => {
      let doc = await helper.createDocument()
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
      await helper.edit()
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
      await helper.wait(100)
      let res = await helper.pumvisible()
      expect(res).toBe(true)
    })

    it('should trigger on triggerCharacters', async () => {
      await helper.edit()
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
      await nvim.input('i')
      await helper.wait(30)
      await nvim.input('.')
      await helper.waitPopup()
      let res = await helper.visible('foo', 'trigger')
      expect(res).toBe(true)
    })

    it('should fix start column', async () => {
      await helper.edit()
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
      await helper.edit()
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
      await nvim.eval('feedkeys("\\<down>","in")')
      await helper.wait(800)
      let hasFloat = await nvim.call('coc#float#has_float')
      expect(hasFloat).toBe(1)
      let res = await helper.visible('foo', 'float')
      expect(res).toBe(true)
    })

    it('should trigger on triggerPatterns', async () => {
      await helper.edit()
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
      await helper.edit()
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
      await helper.edit()
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
      await helper.wait(200)
      let visible = await nvim.call('pumvisible')
      expect(visible).toBe(0)
    })

    it('should trigger when completion is not completed', async () => {
      await helper.edit()
      let token: CancellationToken
      let source: ISource = {
        name: 'completion',
        priority: 10,
        enable: true,
        sourceType: SourceType.Native,
        triggerCharacters: ['.'],
        doComplete: async (opt, cancellationToken): Promise<CompleteResult> => {
          if (opt.triggerCharacter != '.') {
            token = cancellationToken
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
      await nvim.input('if')
      await helper.wait(50)
      await nvim.input('.')
      await helper.wait(50)
      await helper.visible('bar', 'completion')
      expect(token).toBeDefined()
      expect(token.isCancellationRequested).toBe(true)
    })
  })

  describe('completion results', () => {
    it('should limit results for low priority source', async () => {
      let doc = await helper.createDocument()
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
      await helper.edit()
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
      await nvim.input('i')
      await helper.wait(30)
      await nvim.input('.')
      await helper.waitPopup()
      let items = await helper.getItems()
      expect(items.length).toBeGreaterThan(1)
    })

    it('should truncate label of complete items', async () => {
      helper.updateConfiguration('suggest.labelMaxLength', 10)
      await helper.edit()
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
      await nvim.input('i')
      await helper.wait(30)
      await nvim.input('.')
      await helper.waitPopup()
      let items = await helper.getItems()
      for (let item of items) {
        expect(item.abbr.length).toBeLessThanOrEqual(10)
      }
    })

    it('should delete previous items when complete items is null', async () => {
      await helper.edit()
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
      await helper.wait(30)
      await nvim.input('.f')
      await helper.waitPopup()
      let items = await helper.getItems()
      expect(items.length).toEqual(2)
      await nvim.input('oo')
      await helper.waitPopup()
      items = await helper.getItems()
      expect(items.length).toEqual(1)
      expect(items[0].word).toBe('foo')
    })
  })

  describe('fix indent', () => {
    it('should indent lines on TextChangedP #1', async () => {
      await helper.createDocument()
      await helper.mockFunction('MyIndentExpr', 0)
      await nvim.command('setl indentexpr=MyIndentExpr()')
      await nvim.command('setl indentkeys=\\=~end,0\\=\\\\item')
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
      await helper.wait(10)
      await nvim.input('  END')
      await helper.waitFor('getline', ['.'], 'END')
    })
  })
})
