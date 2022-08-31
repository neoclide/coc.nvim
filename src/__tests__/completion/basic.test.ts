import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable } from 'vscode-languageserver-protocol'
import completion from '../../completion'
import events from '../../events'
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

async function triggerCompletion(source: string): Promise<void> {
  await nvim.call('coc#start', { source })
}

async function create(words: string[], trigger = true): Promise<string> {
  let name = Math.random().toString(16).slice(-6)
  disposables.push(sources.createSource({
    name,
    doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise(resolve => {
      resolve({
        items: words.map(s => { return { word: s } })
      })
    })
  }))
  let mode = await nvim.mode
  if (mode.mode !== 'i') {
    await nvim.input('i')
  }
  if (trigger) {
    await triggerCompletion(name)
    await helper.waitPopup()
  }
  return name
}

describe('completion', () => {
  describe('suggest configurations', () => {
    it('should not select complete item', async () => {
      helper.updateConfiguration('suggest.noselect', true)
      await create(['foobar'])
      let info = await nvim.call('coc#pum#info')
      expect(info.index).toBe(-1)
      await nvim.call('coc#pum#select_confirm', [])
      let line = await nvim.line
      expect(line).toBe('foobar')
    })

    it('should sort items by preselect', async () => {
      helper.updateConfiguration('suggest.noselect', true)
      disposables.push(sources.createSource({
        name: 'p',
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise(resolve => {
          resolve({
            items: [{ word: 'foo' }, { word: 'bar', preselect: true }]
          })
        })
      }))
      await nvim.input('i')
      await triggerCompletion('p')
      await helper.waitPopup()
      await helper.confirmCompletion(0)
      await helper.waitFor('getline', ['.'], 'bar')
    })

    it('should disable preselect feature', async () => {
      helper.updateConfiguration('suggest.enablePreselect', false)
      let source: ISource = {
        enable: true,
        name: 'preselect',
        sourceType: SourceType.Service,
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise(resolve => {
          resolve({ items: [{ word: 'foo' }, { word: 'bar' }, { word: 'foot', preselect: true }] })
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i')
      await triggerCompletion('preselect')
      await helper.waitPopup()
      let info = await nvim.call('coc#pum#info')
      expect(info.index).toBe(0)
    })

    it('should trigger with none ascii characters', async () => {
      helper.updateConfiguration('suggest.asciiCharactersOnly', false)
      await create(['你好'], false)
      await nvim.input('N')
      await helper.waitPopup()
    })

    it('should use ascii match', async () => {
      await create(['\xc1\xc7\xc8'], false)
      await nvim.input('a')
      await helper.waitPopup()
      let items = await helper.items()
      expect(items[0].word).toBe('ÁÇÈ')
    })

    it('should not use ascii match', async () => {
      helper.updateConfiguration('suggest.asciiMatch', false)
      await create(['\xc1\xc7\xc8', 'foo'], false)
      await nvim.input('a')
      await helper.wait(50)
      let visible = await helper.pumvisible()
      expect(visible).toBe(false)
      await nvim.input(' f')
      await helper.waitPopup()
    })

    it('should not trigger with none ascii characters', async () => {
      helper.updateConfiguration('suggest.asciiCharactersOnly', true)
      await create(['你好'], false)
      await nvim.input('你')
      await helper.wait(50)
      let visible = await helper.pumvisible()
      expect(visible).toBe(false)
    })

    it('should not trigger with number input', async () => {
      helper.updateConfiguration('suggest.ignoreRegexps', ['[0-9]+'])
      await create(['1234', '1984'], false)
      await nvim.input('1')
      await helper.wait(50)
      let visible = await helper.pumvisible()
      expect(visible).toBe(false)
    })

    it('should select recent used item', async () => {
      helper.updateConfiguration('suggest.selection', 'recentlyUsed')
      let name = await create(['foo', 'bar', 'foobar'])
      await helper.confirmCompletion(1)
      await nvim.input('<CR>')
      await triggerCompletion(name)
      let info = await nvim.call('coc#pum#info')
      expect(info.index).toBe(1)
    })

    it('should select recent item by prefix', async () => {
      helper.updateConfiguration('suggest.selection', 'recentlyUsedByPrefix')
      let doc = await workspace.document
      await nvim.setLine('world')
      await doc.synchronize()
      await nvim.input('owo')
      await helper.visible('world')
      await nvim.input('<C-y>')
      await nvim.input('<esc>')
      await helper.wait(30)
      await nvim.input('ow')
      await helper.visible('world')
    })

    it('should not resolve timeout sources', async () => {
      helper.updateConfiguration('suggest.timeout', 30)
      disposables.push(sources.createSource({
        name: 'timeout',
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise(resolve => {
          setTimeout(() => {
            resolve({ items: [{ word: 'foo' }, { word: 'bar' }] })
          }, 100)
        })
      }))
      await nvim.input('if')
      await helper.wait(50)
      let names = await nvim.getVar('coc_timeout_sources')
      expect(names).toEqual(['timeout'])
    })

    it('should change default sort method', async () => {
      const assertWords = async (arr: string[]) => {
        await helper.waitPopup()
        let win = await helper.getFloat('pum')
        let words = await win.getVar('words')
        expect(words).toEqual(arr)
      }
      helper.updateConfiguration('suggest.defaultSortMethod', 'none')
      disposables.push(sources.createSource({
        name: 'timeout',
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise(resolve => {
          resolve({ items: [{ word: 'far' }, { word: 'foobar' }, { word: 'foo' }] })
        })
      }))
      await nvim.input('if')
      await assertWords(['far', 'foobar', 'foo'])
      await nvim.input('<esc>')
      helper.updateConfiguration('suggest.defaultSortMethod', 'alphabetical')
      await helper.wait(10)
      await nvim.input('of')
      await assertWords(['far', 'foo', 'foobar'])
    })

    it('should remove duplicated words', async () => {
      helper.updateConfiguration('suggest.removeDuplicateItems', true)
      disposables.push(sources.createSource({
        name: 'dup',
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise(resolve => {
          resolve({ items: [{ word: 'foo', dup: 1 }, { word: 'foo', dup: 1 }] })
        })
      }))
      await nvim.input('if')
      await helper.waitPopup()
      let win = await helper.getFloat('pum')
      let words = await win.getVar('words')
      expect(words).toEqual(['foo'])
    })

    it('should use border with floatConfig', async () => {
      helper.updateConfiguration('suggest.floatConfig', {
        border: true
      })
      disposables.push(sources.createSource({
        name: 'words',
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise(resolve => {
          resolve({ items: [{ word: 'foo', kind: 'w', menu: 'x' }, { word: 'foobar', kind: 'w', menu: 'y' }] })
        })
      }))
      await nvim.input('if')
      await helper.waitPopup()
      let win = await helper.getFloat('pum')
      let id = await nvim.call('coc#float#get_related', [win.id, 'border'])
      expect(id).toBeGreaterThan(1000)
      helper.updateConfiguration('suggest.floatConfig', {
        border: true,
        rounded: true,
        borderhighlight: 'Normal'
      })
      await nvim.input('<esc>')
      await nvim.input('of')
      await helper.waitPopup()
    })

    it('should use pumFloatConfig', async () => {
      helper.updateConfiguration('suggest.floatConfig', {})
      helper.updateConfiguration('suggest.pumFloatConfig', {
        border: true,
        highlight: 'Normal',
        winblend: 15,
        shadow: true,
        rounded: true
      })
      disposables.push(sources.createSource({
        name: 'words',
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise(resolve => {
          resolve({ items: [{ word: 'foo', kind: 'w', menu: 'x' }, { word: 'foobar', kind: 'w', menu: 'y' }] })
        })
      }))
      await nvim.input('if')
      await helper.waitPopup()
      let win = await helper.getFloat('pum')
      let id = await nvim.call('coc#float#get_related', [win.id, 'border'])
      expect(id).toBeGreaterThan(1000)
      let hl = await win.getOption('winhl')
      expect(hl).toMatch('Normal')
    })

    it('should do filter when autoTrigger is none', async () => {
      helper.updateConfiguration('suggest.autoTrigger', 'none')
      disposables.push(sources.createSource({
        name: 'words',
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise(resolve => {
          resolve({ items: [{ word: 'foo' }, { word: 'bar' }] })
        })
      }))
      await nvim.input('i')
      nvim.call('coc#start', [], true)
      await helper.waitPopup()
      expect(completion.activeItems.length).toBe(2)
      await nvim.input('f')
      await helper.wait(50)
      expect(completion.activeItems.length).toBe(1)
    })
  })

  describe('suggest variables', () => {
    beforeEach(() => {
      disposables.push(sources.createSource({
        name: 'foo',
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => Promise.resolve({ items: [{ word: 'foo' }] })
      }))
    })

    it('should be disabled by b:coc_suggest_disable', async () => {
      let doc = await workspace.document
      await doc.buffer.setVar('coc_suggest_disable', 1)
      await nvim.input('if')
      await helper.wait(30)
      let visible = await helper.pumvisible()
      expect(visible).toBe(false)
    })

    it('should be disabled by b:coc_disabled_sources', async () => {
      let doc = await workspace.document
      await doc.buffer.setVar('coc_disabled_sources', ['foo'])
      await nvim.input('if')
      await helper.wait(30)
      let visible = await helper.pumvisible()
      expect(visible).toBe(false)
    })

    it('should be disabled by b:coc_suggest_blacklist', async () => {
      let doc = await workspace.document
      await doc.buffer.setVar('coc_suggest_blacklist', ['end'])
      await nvim.setLine('en')
      await nvim.input('Ad')
      await helper.wait(30)
      let visible = await helper.pumvisible()
      expect(visible).toBe(false)
    })
  })

  describe('doComplete()', () => {
    it('should show slow source', async () => {
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'slow',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise(resolve => {
          setTimeout(() => {
            resolve({ items: [{ word: 'foo', kind: 'w' }, { word: 'bar' }] })
          }, 50)
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i.')
      await helper.waitPopup()
      expect(completion.isActivated).toBe(true)
      let items = await helper.items()
      expect(items.length).toBe(2)
      await nvim.input('foo')
      await helper.wait(50)
      items = await helper.items()
      expect(items.length).toBe(1)
    })

    it('should catch error', async () => {
      disposables.push(sources.createSource({
        name: 'error',
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise((resolve, reject) => {
          reject(new Error('custom error'))
        })
      }))
      await nvim.input('if')
      await helper.wait(50)
      let cmdline = await helper.getCmdline()
      expect(cmdline).toMatch('')
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

    it('should refresh on backspace', async () => {
      await nvim.command('inoremap <silent><expr> <backspace> coc#pum#visible() ? "\\<bs>\\<c-r>=coc#start()\\<CR>" : "\\<bs>"')
      disposables.push(Disposable.create(() => {
        nvim.command(`iunmap <backspace>`, true)
      }))
      let source: ISource = {
        name: 'fast',
        enable: true,
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise(resolve => {
          resolve({ items: [{ word: 'foo' }, { word: 'foot' }] })
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('ifo')
      await helper.waitPopup()
      await nvim.input('<backspace>')
      await helper.wait(50)
      let visible = await helper.pumvisible()
      expect(visible).toBe(true)
    })
  })

  describe('resumeCompletion()', () => {
    it('should stop if no filtered items', async () => {
      let doc = await workspace.document
      await nvim.setLine('foo ')
      await doc.synchronize()
      await nvim.input('Af')
      await helper.waitPopup()
      expect(completion.isActivated).toBe(true)
      await nvim.input('p')
      await helper.waitValue(() => {
        return completion.isActivated
      }, false)
    })

    it('should not resume after text change', async () => {
      let doc = await workspace.document
      await nvim.setLine('foo fat')
      await doc.synchronize()
      await nvim.input('of')
      await nvim.setLine('fo')
      await nvim.call('cursor', [2, 3])
      await helper.wait(50)
      expect(completion.isActivated).toBe(false)
    })

    it('should stop with bad insert on CursorMovedI', async () => {
      await nvim.setLine('foo fat')
      await nvim.input('of')
      await nvim.setLine('f a')
      await nvim.call('cursor', [2, 4])
      await helper.wait(30)
      let visible = await helper.pumvisible()
      expect(visible).toBe(false)
    })

    it('should deactivate without filtered items', async () => {
      let doc = await workspace.document
      await nvim.setLine('foo fbi ')
      await doc.synchronize()
      await nvim.input('Af')
      await helper.waitPopup()
      await nvim.input('c')
      await helper.waitFor('coc#pum#visible', [], 0)
      expect(completion.activeItems).toBeUndefined()
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
      await helper.waitValue((() => {
        return completion.activeItems?.length
      }), 1)
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
      let doc = await workspace.document
      await nvim.setLine('foo fbi ')
      await doc.synchronize()
      await nvim.input('Af')
      await helper.waitPopup()
      await nvim.input('<backspace>')
      await helper.waitFor('getline', ['.'], 'foo fbi ')
      expect(completion.isActivated).toBe(false)
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
  })

  describe('onCompleteResolve', () => {
    beforeEach(() => {
      helper.updateConfiguration('coc.source.resolve.triggerCharacters', ['.'])
    })

    it('should do resolve for complete item', async () => {
      let resolved = false
      disposables.push(sources.createSource({
        name: 'resolve',
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => Promise.resolve({ items: [{ word: 'foo' }] }),
        onCompleteResolve: item => {
          resolved = true
          item.info = 'detail'
        }
      }))
      await nvim.input('i.')
      await helper.waitPopup()
      await helper.confirmCompletion(0)
      await helper.waitFor('getline', ['.'], '.foo')
      expect(resolved).toBe(true)
    })

    it('should cancel resolve request', async () => {
      let called = false
      disposables.push(sources.createSource({
        name: 'resolve',
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => Promise.resolve({ items: [{ word: 'foo' }] }),
        onCompleteResolve: async item => {
          called = true
          await helper.wait(100)
          item.info = 'info'
        }
      }))
      await nvim.input('i.')
      await helper.waitPopup()
      nvim.call('coc#pum#cancel', [], true)
      await helper.wait(30)
      expect(called).toBe(true)
      let floatWin = await helper.getFloat('pumdetail')
      expect(floatWin).toBeUndefined()
    })

    it('should not throw error', async () => {
      let called = false
      disposables.push(sources.createSource({
        name: 'resolve',
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => Promise.resolve({ items: [{ word: 'foo' }] }),
        onCompleteResolve: async item => {
          called = true
          throw new Error('custom error')
        }
      }))
      await nvim.input('i.')
      await helper.waitPopup()
      expect(called).toBe(true)
      let cmdline = await helper.getCmdline()
      expect(cmdline.includes('error')).toBe(false)
    })

    it('should timeout on resolve', async () => {
      let called = false
      disposables.push(sources.createSource({
        name: 'resolve',
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => Promise.resolve({ items: [{ word: 'foo' }] }),
        onCompleteResolve: async item => {
          called = true
          await helper.wait(200)
          item.info = 'info'
        }
      }))
      await nvim.input('i.')
      await helper.waitPopup()
      await helper.wait(200)
      expect(called).toBe(true)
      let floatWin = await helper.getFloat('pumdetail')
      expect(floatWin).toBeUndefined()

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
      await helper.confirmCompletion(0)
      await helper.waitFor('getline', ['.'], 'football football')
    })
  })

  describe('InsertEnter', () => {
    beforeEach(() => {
      helper.updateConfiguration('suggest.triggerAfterInsertEnter', true)
    })

    it('should trigger completion if triggerAfterInsertEnter is true', async () => {
      let doc = await workspace.document
      await nvim.setLine('foo fo')
      await doc.synchronize()
      await nvim.input('A')
      await doc.synchronize()
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

    it('should cancel on backspace', async () => {
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
      await helper.waitPopup()
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
      let doc = await workspace.document
      await nvim.setLine('foo bar')
      await doc.synchronize()
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
      await nvim.input('of')
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
      items = items.filter(o => o.source == 'around')
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
      helper.updateConfiguration('suggest.formatItems', ['abbr'])
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
      let winid = await nvim.call('coc#float#get_float_by_kind', ['pum'])
      let win = nvim.createWindow(winid)
      let buf = await win.buffer
      let lines = await buf.lines
      expect(lines[0].trim().length).toBe(10)
    })

    it('should render labelDetails', async () => {
      helper.updateConfiguration('suggest.formatItems', ['abbr'])
      helper.updateConfiguration('suggest.labelMaxLength', 10)
      disposables.push(sources.createSource({
        name: 'test',
        doComplete: (_opt: CompleteOption): Promise<CompleteResult> => new Promise(resolve => {
          resolve({
            items: [{
              word: 'x',
              labelDetails: {
                detail: 'foo',
                description: 'bar'
              }
            }, {
              word: 'y'.repeat(8),
              labelDetails: {
                detail: 'a'.repeat(20),
                description: 'b'.repeat(20)
              }
            }]
          })
        })
      }))
      await nvim.input('i')
      await triggerCompletion('test')
      await helper.waitPopup()
      let winid = await nvim.call('coc#float#get_float_by_kind', ['pum'])
      let win = nvim.createWindow(winid)
      let buf = await win.buffer
      let lines = await buf.lines
      expect(lines.length).toBe(2)
      expect(lines[0]).toMatch(/xfoo bar/)
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
      await helper.waitValue(() => {
        return completion.activeItems?.length
      }, 1)
      items = await helper.getItems()
      expect(items.length).toEqual(1)
      expect(items[0].word).toBe('foo')
    })
  })

  describe('indent change', () => {
    it('should indent line after completion #1', async () => {
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
      let idx = completion.activeItems.findIndex(o => o.word == 'item')
      await helper.confirmCompletion(idx)
      await helper.waitFor('getline', ['.'], '\\item')
    })

    it('should trigger completion after indent change', async () => {
      await helper.createDocument('t.vim')
      // doc._indentkeys = '=end'
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
      await nvim.input('  endi')
      await helper.waitPopup()
      await nvim.input('f')
      await helper.wait(10)
      await nvim.command('normal! ==')
      await helper.waitFor('getline', ['.'], 'endif')
    })
  })

  describe('Character insert', () => {
    beforeAll(() => {
      let source: ISource = {
        name: 'insert',
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
      await nvim.setLine('f')
      await nvim.input('A')
      await doc.synchronize()
      await triggerCompletion('insert')
      await helper.waitPopup()
      let line = await nvim.line
      expect(line).toBe('f')
      await nvim.exec(`
         noa call setline('.', 'foobar')
         noa call cursor(1, 7)
         `)
      await helper.wait(50)
      let res = await helper.pumvisible()
      expect(res).toBe(false)
      line = await nvim.line
      expect(line).toBe('foobar')
    })

    it('should trigger specific sources by api', async () => {
      let text = 'foo bar f'
      await nvim.setLine(text)
      await nvim.input('A')
      await triggerCompletion('insert')
      await helper.waitPopup()
    })
  })
})
