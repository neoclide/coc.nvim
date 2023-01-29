import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable, Position, TextEdit } from 'vscode-languageserver-protocol'
import commands from '../../commands'
import completion, { Completion } from '../../completion'
import { sortItems } from '../../completion/complete'
import sources from '../../completion/sources'
import { CompleteFinishKind, CompleteOption, CompleteResult, ExtendedCompleteItem, ISource, SortMethod, SourceType, VimCompleteItem } from '../../completion/types'
import { WordDistance } from '../../completion/wordDistance'
import events from '../../events'
import { disposeAll, waitWithToken } from '../../util'
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

function triggerCompletion(source: string): void {
  nvim.call('coc#start', { source }, true)
}
async function pumvisible(): Promise<boolean> {
  let res = await nvim.call('coc#pum#visible', []) as number
  return res == 1
}

async function create(items: string[] | VimCompleteItem[], trigger = true): Promise<string> {
  let name = Math.random().toString(16).slice(-6)
  disposables.push(sources.createSource({
    name,
    doComplete: (_opt: CompleteOption): Promise<CompleteResult<ExtendedCompleteItem>> => new Promise(resolve => {
      if (items.length == 0 || typeof items[0] === 'string') {
        resolve({
          items: items.map(s => { return { word: s } })
        })
      } else {
        resolve({ items: items as VimCompleteItem[] })
      }
    })
  }))
  let mode = await nvim.mode
  if (mode.mode !== 'i') {
    await nvim.input('i')
  }
  if (trigger) {
    triggerCompletion(name)
    await helper.waitPopup()
  }
  return name
}

describe('completion', () => {
  describe('suggest configurations', () => {
    it('should select item by preselect', async () => {
      helper.updateConfiguration('suggest.noselect', true)
      expect(typeof Completion).toBe('function')
      await create([{ word: 'foo' }, { word: 'foo' }, { word: 'bar', preselect: true }], true)
      expect(events.completing).toBe(true)
      await helper.confirmCompletion(0)
      await helper.waitFor('getline', ['.'], 'bar')
    })

    it('should disable preselect feature', async () => {
      helper.updateConfiguration('suggest.enablePreselect', false)
      await create([{ word: 'foo' }, { word: 'bar' }, { word: 'foot', preselect: true }], true)
      let info = await nvim.call('coc#pum#info') as any
      expect(info.index).toBe(0)
    })

    it('should trigger with none ascii characters', async () => {
      helper.updateConfiguration('suggest.asciiCharactersOnly', false)
      await create(['你好'], false)
      await nvim.input('ni')
      await helper.waitPopup()
    })

    it('should use insert range without replace', async () => {
      helper.updateConfiguration('suggest.insertMode', 'insert')
      await nvim.setLine('ffoo')
      let name = await create(['foo'], false)
      await nvim.input('<right>')
      await commands.executeCommand('editor.action.triggerSuggest', name)
      await helper.waitPopup()
      await helper.confirmCompletion(0)
      let line = await nvim.line
      expect(line).toBe('foofoo')
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
      let visible = await pumvisible()
      expect(visible).toBe(false)
      await nvim.input('<cr>')
      await nvim.input('f')
      await helper.waitPopup()
    })

    it('should not trigger with none ascii characters', async () => {
      helper.updateConfiguration('suggest.asciiCharactersOnly', true)
      await create(['你好'], false)
      await nvim.input('你')
      await helper.wait(10)
      let visible = await pumvisible()
      expect(visible).toBe(false)
    })

    it('should not trigger with number input', async () => {
      helper.updateConfiguration('suggest.ignoreRegexps', ['[0-9]+'])
      await create(['1234', '1984'], false)
      await nvim.input('1')
      await helper.wait(50)
      let visible = await pumvisible()
      expect(visible).toBe(false)
    })

    it('should select recent used item', async () => {
      helper.updateConfiguration('suggest.selection', 'recentlyUsed')
      let name = await create(['foo', 'bar', 'foobar'])
      await helper.confirmCompletion(1)
      await nvim.input('<CR>f')
      triggerCompletion(name)
      let info = await nvim.call('coc#pum#info') as any
      expect(info.index).toBe(1)
    })

    it('should not resolve timeout sources', async () => {
      helper.updateConfiguration('suggest.timeout', 30)
      disposables.push(sources.createSource({
        name: 'timeout',
        doComplete: (_opt: CompleteOption, token) => new Promise(resolve => {
          let timer = setTimeout(() => {
            resolve({ items: [{ word: 'foo' }, { word: 'bar' }] })
          }, 100)
          token.onCancellationRequested(() => {
            clearTimeout(timer)
          })
        })
      }))
      await nvim.input('if')
      await helper.waitFor('eval', ["get(g:,'coc_timeout_sources','')"], ['timeout'])
    })

    it('should change default sort method', async () => {
      const assertWords = async (arr: string[]) => {
        await helper.waitPopup()
        let win = await helper.getFloat('pum')
        let words = await win.getVar('words')
        expect(words).toEqual(arr)
      }
      helper.updateConfiguration('suggest.defaultSortMethod', 'none')
      await create([{ word: 'far' }, { word: 'foobar' }, { word: 'foo' }], false)
      await nvim.input('f')
      await assertWords(['far', 'foobar', 'foo'])
      await nvim.input('<esc>')
      helper.updateConfiguration('suggest.defaultSortMethod', 'alphabetical')
      await helper.wait(10)
      await nvim.input('of')
      await assertWords(['far', 'foo', 'foobar'])
    })

    it('should remove duplicated words', async () => {
      helper.updateConfiguration('suggest.removeDuplicateItems', true)
      await create([{ word: 'foo', dup: 1 }, { word: 'foo', dup: 1 }], true)
      let win = await helper.getFloat('pum')
      let words = await win.getVar('words')
      expect(words).toEqual(['foo'])
    })

    it('should use border with floatConfig', async () => {
      helper.updateConfiguration('suggest.floatConfig', { border: true })
      await create([{ word: 'foo', kind: 'w', menu: 'x' }, { word: 'foobar', kind: 'w', menu: 'y' }], true)
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
      await create([{ word: 'foo', kind: 'w', menu: 'x' }, { word: 'foobar', kind: 'w', menu: 'y' }], true)
      let win = await helper.getFloat('pum')
      let id = await nvim.call('coc#float#get_related', [win.id, 'border'])
      expect(id).toBeGreaterThan(1000)
      let hl = await win.getOption('winhl')
      expect(hl).toMatch('Normal')
    })

    it('should do filter when autoTrigger is none', async () => {
      helper.updateConfiguration('suggest.autoTrigger', 'none')
      let doc = await workspace.document
      expect(completion.shouldTrigger(doc, '')).toBe(false)
      await create(['foo', 'bar'], false)
      await nvim.input('f')
      await helper.wait(10)
      expect(completion.activeItems.length).toBe(0)
      nvim.call('coc#start', [], true)
      await helper.waitPopup()
      expect(completion.activeItems.length).toBe(1)
      await nvim.input('o')
      await helper.wait(10)
      expect(completion.activeItems.length).toBe(1)
    })

    it('should trigger for trigger character when filter failed', async () => {
      await nvim.command('edit t|setl iskeyword=@,-')
      let doc = await workspace.document
      expect(doc.chars.isKeywordChar('-')).toBe(true)
      let option: CompleteOption
      let source: ISource = {
        name: 'dash',
        enable: true,
        sourceType: SourceType.Service,
        triggerCharacters: ['-'],
        doComplete: async (opt: CompleteOption) => {
          option = opt
          if (opt.triggerCharacter == '-') return { items: [{ word: '-foo' }] }
          return { items: [{ word: 'foo' }, { word: 'bar' }, { label: undefined }] }
        }
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i')
      triggerCompletion('dash')
      await helper.waitPopup()
      expect(option.triggerCharacter).toBeUndefined()
      await nvim.input('-')
      await helper.waitValue(() => {
        let items = completion.activeItems
        return items && items.length == 1 && items[0].word == '-foo'
      }, true)
    })

    it('should trigger on trigger character', async () => {
      helper.updateConfiguration('suggest.autoTrigger', 'none')
      let fn = jest.fn()
      let source: ISource = {
        name: 'trigger',
        enable: true,
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: (_opt: CompleteOption) => new Promise(resolve => {
          fn()
          resolve({ items: [{ word: 'foo' }, { word: 'bar' }] })
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('if.')
      await helper.wait(20)
      expect(fn).toBeCalledTimes(0)
      helper.updateConfiguration('suggest.autoTrigger', 'trigger')
      await nvim.input('f')
      await helper.wait(20)
      await nvim.input('.')
      await helper.waitPopup()
    })

    it('should disable localityBonus', async () => {
      helper.updateConfiguration('suggest.localityBonus', false)
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), '\nfoo\nfoobar')])
      await create(['foo', 'foobar'], true)
    })

    it('should not not preview window when enableFloat is disabled', async () => {
      helper.updateConfiguration('suggest.enableFloat', false)
      let resolved = false
      disposables.push(sources.createSource({
        name: 'info',
        doComplete: () => Promise.resolve({ items: [{ word: 'foo', info: 'detail' }] }),
        onCompleteResolve: item => {
          resolved = true
        }
      }))
      await nvim.input('i')
      triggerCompletion('info')
      await helper.waitPopup()
      let floatWin = await helper.getFloat('pumdetail')
      expect(floatWin).toBeUndefined()
      await helper.confirmCompletion(0)
      await helper.waitValue(() => {
        return resolved
      }, true)
    })

    it('should disable graceful filter', async () => {
      helper.updateConfiguration('suggest.filterGraceful', false)
      await create(['this'], true)
      await nvim.input('tih')
      await helper.waitValue(async () => {
        let items = await helper.items()
        return items.length
      }, 0)
    })

    it('should change detailField', async () => {
      helper.updateConfiguration('suggest.detailField', 'abbr')
      await create([{ word: 'this', detail: 'detail of this' }], true)
      let floatWin = await helper.getFloat('pum')
      let buf = await floatWin.buffer
      expect(buf).toBeDefined()
    })

    it('should change triggerCompletionWait', async () => {
      let doc = await workspace.document
      helper.updateConfiguration('suggest.triggerCompletionWait', 200)
      let name = await create([{ word: 'foo' }, { word: 'bar' }], false)
      triggerCompletion(name)
      let spy
      let p = new Promise<void>(resolve => {
        spy = jest.spyOn(doc, 'patchChange').mockImplementation(() => {
          resolve()
          return Promise.resolve()
        })
      })
      await p
      await helper.wait(20)
      completion.stop(true)
      spy.mockRestore()
    })

    it('should disable filter on backspace', async () => {
      helper.updateConfiguration('suggest.filterOnBackspace', false)
      await create(['this', 'thoit'], true)
      await nvim.input('this')
      await helper.waitValue(() => {
        return completion.activeItems.length
      }, 1)
      await nvim.input('<bs>')
      await helper.waitValue(() => {
        return completion.isActivated
      }, false)
    })
  })

  describe('suggest variables', () => {
    beforeEach(() => {
      disposables.push(sources.createSource({
        name: 'foo',
        doComplete: (_opt: CompleteOption) => Promise.resolve({ items: [{ word: 'foo' }] })
      }))
    })

    it('should be disabled by b:coc_suggest_disable', async () => {
      let doc = await workspace.document
      await doc.buffer.setVar('coc_suggest_disable', 1)
      await nvim.input('if')
      await helper.wait(20)
      let visible = await pumvisible()
      expect(visible).toBe(false)
    })

    it('should be disabled by b:coc_disabled_sources', async () => {
      let doc = await workspace.document
      await doc.buffer.setVar('coc_disabled_sources', ['foo'])
      await nvim.input('if')
      await helper.wait(20)
      let visible = await pumvisible()
      expect(visible).toBe(false)
    })

    it('should be disabled by b:coc_suggest_blacklist', async () => {
      let doc = await workspace.document
      await doc.buffer.setVar('coc_suggest_blacklist', ['end'])
      await nvim.setLine('en')
      await nvim.input('Ad')
      await helper.wait(10)
      let visible = await pumvisible()
      expect(visible).toBe(false)
    })
  })

  describe('shouldComplete()', () => {
    it('should not complete when shouldComplete return false', async () => {
      let name = Math.random().toString(16).slice(-6)
      let called = false
      let shouldRun = false
      disposables.push(sources.addSource({
        name,
        shouldComplete: () => {
          return shouldRun
        },
        doComplete: (_opt: CompleteOption): Promise<CompleteResult<ExtendedCompleteItem>> => new Promise(resolve => {
          called = true
          resolve({ items: [{ word: 'foo' }] })
        })
      }))
      await nvim.input('i')
      triggerCompletion(name)
      await helper.wait(20)
      expect(called).toBe(false)
      shouldRun = true
      triggerCompletion(name)
      await helper.waitPopup()
    })

    it('should not complete with empty sources', async () => {
      nvim.call('coc#start', { source: 'not_exists' }, true)
      await helper.wait(10)
      let visible = await pumvisible()
      expect(visible).toBe(false)
    })
  })

  describe('doComplete()', () => {
    it('should create pum', async () => {
      let source: ISource = {
        enable: true,
        name: 'menu',
        shortcut: '',
        sourceType: SourceType.Service,
        doComplete: (_opt: CompleteOption) => new Promise(resolve => {
          resolve({
            items: [{ word: 'foo', deprecated: true, menu: 'm', kind: 'k' }]
          })
        })
      }
      disposables.push(sources.addSource(source))
      disposables.push(sources.addSource({
        enable: true,
        name: 'other',
        shortcut: 's',
        sourceType: SourceType.Service,
        doComplete: (_opt: CompleteOption) => new Promise(resolve => {
          resolve({
            items: [{ word: 'bar', menu: '' }]
          })
        })
      }))
      await nvim.input('i')
      await nvim.call('coc#start', {})
      await helper.waitPopup()
      let info = await nvim.call('coc#pum#info') as any
      expect(info.index).toBe(0)
    })

    it('should show slow source', async () => {
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'slow',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: (_opt: CompleteOption) => new Promise(resolve => {
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
        doComplete: (_opt: CompleteOption) => new Promise((resolve, reject) => {
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
        doComplete: (_opt: CompleteOption) => new Promise(resolve => {
          resolve({ items: [{ word: 'foo' }, { word: 'bar' }] })
        })
      }
      disposables.push(sources.addSource(source))
      let finished = false
      let slowSource: ISource = {
        name: 'slow',
        enable: true,
        doComplete: (_opt: CompleteOption, token) => new Promise(resolve => {
          token.onCancellationRequested(() => {
            clearTimeout(timer)
            resolve(undefined)
          })
          let timer = setTimeout(() => {
            finished = true
            resolve({ items: [{ word: 'world' }] })
          }, 300)
        })
      }
      disposables.push(sources.addSource(slowSource))
      await nvim.input('if')
      await events.race(['MenuPopupChanged'], 200)
      expect(finished).toBe(false)
    })

    it('should show items when wordDistance is slow', async () => {
      let _resolve
      let spy = jest.spyOn(WordDistance, 'create').mockImplementation(() => {
        return new Promise(resolve => {
          _resolve = resolve
        })
      })
      await create(['foo', 'foot'], false)
      await nvim.input('f')
      await helper.waitPopup()
      _resolve(undefined)
      spy.mockRestore()
    })
  })

  describe('resumeCompletion()', () => {
    it('should not cancel when trigger for inComplete', async () => {
      let name = Math.random().toString(16).slice(-6)
      let _resolve
      let fireResolve = () => {
        _resolve({ items: [{ word: 'foo' }, { word: 'foot' }] })
      }
      disposables.push(sources.createSource({
        name,
        doComplete: (_opt: CompleteOption) => new Promise(resolve => {
          _resolve = resolve
        })
      }))
      disposables.push(sources.createSource({
        name: 'inComplete',
        doComplete: (opt: CompleteOption) => new Promise(resolve => {
          if (opt.input.length == 1) {
            resolve({ items: [{ word: 'fa' }], isIncomplete: true })
          } else {
            resolve({ items: [{ word: 'footman' }, { word: 'football' }, { word: 'fa' }], isIncomplete: false })
          }
        })
      }))
      await nvim.input('if')
      await helper.waitPopup()
      let items = completion.activeItems
      expect(items.length).toBe(1)
      await nvim.input('o')
      await helper.wait(3)
      fireResolve()
      await helper.waitValue(() => {
        return completion.activeItems.length
      }, 4)
    })

    it('should stop if no filtered items', async () => {
      await create(['foo', 'bar'], true)
      expect(completion.isActivated).toBe(true)
      await nvim.input('fp')
      await helper.waitValue(() => {
        return completion.isActivated
      }, false)
    })

    it('should stop when selected and no filtered items', async () => {
      helper.updateConfiguration('suggest.noselect', true)
      await create(['foo'], true)
      expect(completion.isActivated).toBe(true)
      await nvim.call('coc#pum#_navigate', [1, 1])
      await helper.waitFor('getline', ['.'], 'foo')
      await nvim.input('(')
      await helper.waitValue(() => {
        return completion.isActivated
      }, false)
    })

    it('should not resume after text change', async () => {
      await create(['foo'], false)
      await nvim.input('f')
      await helper.waitPopup()
      await nvim.setLine('fo')
      await nvim.call('cursor', [2, 3])
      await helper.waitValue(() => {
        return completion.isActivated
      }, false)
    })

    it('should stop with bad insert on CursorMovedI', async () => {
      await create(['foo', 'fat'], false)
      await nvim.input('f')
      await nvim.setLine('f a')
      await nvim.call('cursor', [2, 4])
      await helper.wait(30)
      let visible = await pumvisible()
      expect(visible).toBe(false)
    })

    it('should deactivate without filtered items', async () => {
      await create(['foo', 'foobar'], true)
      await nvim.input('f')
      await nvim.input(' a')
      await helper.waitFor('coc#pum#visible', [], 0)
      expect(completion.isActivated).toBe(false)
      completion.cancel()
    })

    it('should deactivate when insert space', async () => {
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'empty',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: (_opt: CompleteOption) => new Promise(resolve => {
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
      await helper.waitValue(async () => {
        return await pumvisible()
      }, false)
    })

    it('should use resume input to filter', async () => {
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'source',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: () => new Promise(resolve => {
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
      disposables.push(sources.addSource({
        name: 'fast',
        enable: true,
        shortcut: 's',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: (_opt: CompleteOption) => new Promise(resolve => {
          resolve({ items: [{ word: 'xyz', menu: '' }] })
        })
      }))
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'slow',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: () => new Promise(resolve => {
          setTimeout(() => {
            resolve({ items: [{ word: 'foo' }, { word: 'bar' }] })
          }, 100)
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i.')
      await helper.wait(10)
      await nvim.input('f')
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
        doComplete: async (opt: CompleteOption) => {
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
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'inComplete',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: async (opt: CompleteOption) => {
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
        doComplete: opt => {
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
      await nvim.call('coc#pum#next', [1])
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
        doComplete: (opt: CompleteOption) => {
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
      await nvim.input('o')
      await helper.wait(10)
      await nvim.input('.')
      await helper.waitFor('getline', ['.'], 'foo.')
    })

    it('should filter on backspace', async () => {
      await create(['foo', 'fbi'], true)
      await nvim.input('fo')
      await helper.waitValue(() => completion.activeItems.length, 1)
      await helper.wait(10)
      await nvim.input('<backspace>')
      await helper.waitValue(() => completion.activeItems.length, 2)
    })
  })

  describe('TextChangedP', () => {
    it('should stop when input length below option input length', async () => {
      await create(['foo', 'fbi'], false)
      await nvim.input('f')
      await helper.waitPopup()
      await nvim.input('<backspace>')
      await helper.waitValue(async () => {
        return completion.isActivated
      }, false)
    })

    it('should filter on none keyword input', async () => {
      await nvim.setLine('foo')
      await nvim.input('A')
      await create(['foo#abc'], true)
      await nvim.input('#')
      await helper.wait(30)
      let items = await helper.items()
      expect(items[0].word).toBe('foo#abc')
    })

    it('should cancel on CursorMoved', async () => {
      let buf = await nvim.buffer
      await buf.setLines(['', 'bar'], { start: 0, end: -1, strictIndexing: false })
      let source: ISource = {
        priority: 99,
        enable: true,
        name: 'temp',
        sourceType: SourceType.Service,
        doComplete: (_opt: CompleteOption) => Promise.resolve({ items: [{ word: 'foo#abc' }] }),
      }
      disposables.push(sources.addSource(source))
      await nvim.input('if')
      await helper.waitPopup()
      void events.fire('CompleteDone', [{}])
      await helper.wait(10)
      await events.fire('CursorMovedI', [buf.id, [2, 1, '']])
      await helper.waitValue(() => {
        return completion.isActivated
      }, false)
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
        doComplete: (_opt: CompleteOption) => Promise.resolve({ items: [{ word: 'foo' }] }),
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
      let cancelled = false
      let called = false
      disposables.push(sources.createSource({
        name: 'resolve',
        doComplete: (_opt: CompleteOption) => Promise.resolve({ items: [{ word: 'foo' }, { word: 'bar' }] }),
        onCompleteResolve: async (item, _opt, token) => {
          called = true
          let res = await waitWithToken(200, token)
          cancelled = res
          item.info = 'info'
        }
      }))
      await nvim.input('i.')
      await helper.waitValue(() => {
        return called
      }, true)
      await nvim.call('coc#pum#next', [0])
      await helper.waitValue(() => {
        return cancelled
      }, true)
      nvim.call('coc#pum#cancel', [], true)
      let floatWin = await helper.getFloat('pumdetail')
      expect(floatWin).toBeUndefined()
    })

    it('should not throw error', async () => {
      let called = false
      disposables.push(sources.createSource({
        name: 'resolve',
        doComplete: (_opt: CompleteOption) => Promise.resolve({ items: [{ word: 'foo' }] }),
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
        doComplete: (_opt: CompleteOption) => Promise.resolve({ items: [{ word: 'foo' }] }),
        onCompleteResolve: async item => {
          called = true
          await helper.wait(200)
          item.info = 'info'
        }
      }))
      await nvim.input('i.')
      await helper.waitPopup()
      await helper.waitValue(() => {
        return called
      }, true)
      let floatWin = await helper.getFloat('pumdetail')
      expect(floatWin).toBeUndefined()
    })
  })

  describe('InsertEnter', () => {
    beforeEach(() => {
      helper.updateConfiguration('suggest.triggerAfterInsertEnter', true)
    })

    it('should trigger completion if triggerAfterInsertEnter is true', async () => {
      await create(['fball', 'football'], false)
      await nvim.input('f')
      await nvim.input('<esc>')
      await nvim.input('A')
      await helper.waitPopup()
      expect(completion.isActivated).toBe(true)
    })

    it('should not trigger when document not attached', async () => {
      await nvim.command('edit t|setl buftype=nofile')
      await nvim.input('o')
      await helper.wait(10)
      expect(completion.isActivated).toBe(false)
    })
  })

  describe('trigger completion', () => {
    it('should trigger complete when trigger patterns match', async () => {
      let source: ISource = {
        priority: 99,
        enable: true,
        name: 'temp',
        triggerPatterns: [/EM/],
        sourceType: SourceType.Service,
        doComplete: (opt: CompleteOption) => {
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
      let items = await helper.items()
      expect(items.length).toBe(2)
    })

    it('should trigger on triggerSuggest command', async () => {
      await create(['foo', 'bar'], false)
      await commands.executeCommand('editor.action.triggerSuggest')
      await helper.waitPopup()
      let items = await helper.items()
      expect(items.length).toBe(2)
    })

    it('should filter and sort on increment search', async () => {
      await create(['forceDocumentSync', 'format', 'fallback'], false)
      await nvim.input('f')
      await helper.waitPopup()
      await nvim.input('oa')
      await helper.waitPopup()
      let items = await helper.items()
      expect(items.findIndex(o => o.word == 'fallback')).toBe(-1)
    })

    it('should not trigger on insert enter', async () => {
      await nvim.setLine('f')
      await create(['foo', 'bar'], false)
      await nvim.input('<esc>')
      await nvim.input('A')
      await helper.wait(1)
      let visible = await pumvisible()
      expect(visible).toBe(false)
    })

    it('should filter on fast input', async () => {
      await create(['foo', 'bar'], false)
      await nvim.input('br')
      await helper.waitPopup()
      let items = await helper.items()
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
        doComplete: async () => {
          return Promise.resolve({ items: [{ word: 'if(' }] })
        }
      }
      disposables.push(sources.addSource(source))
      await nvim.setLine('')
      await nvim.input('iif')
      await helper.waitPopup()
      await nvim.input('(')
      await helper.wait(50)
      let res = await pumvisible()
      expect(res).toBe(true)
    })

    it('should trigger on triggerCharacters', async () => {
      let source: ISource = {
        name: 'trigger',
        enable: true,
        triggerCharacters: ['.'],
        doComplete: async () => Promise.resolve({
          items: [{ word: 'foo' }]
        })
      }
      disposables.push(sources.addSource(source))
      let source1: ISource = {
        name: 'trigger1',
        enable: true,
        triggerCharacters: ['.'],
        doComplete: async () => Promise.resolve({
          items: [{ word: 'bar' }]
        })
      }
      disposables.push(sources.addSource(source1))
      await nvim.input('i.')
      await helper.waitPopup()
      let items = await helper.items()
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
        doComplete: async () => {
          return Promise.resolve({ startcol: 0, items: [{ word: 'foo.bar' }] })
        }
      }
      disposables.push(sources.addSource(source))
      await nvim.setLine('foo.')
      await nvim.input('Ab')
      await helper.waitPopup()
      await nvim.call('coc#pum#select_confirm')
      let line = await nvim.line
      expect(line).toBe('foo.bar')
    })

    it('should should complete items without input', async () => {
      await workspace.document
      let source: ISource = {
        enable: true,
        name: 'trigger',
        priority: 10,
        sourceType: SourceType.Native,
        doComplete: async () => Promise.resolve({
          items: [{ word: 'foo' }, { word: 'bar' }]
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.command('inoremap <silent><nowait><expr> <c-space> coc#refresh()')
      await nvim.input('i')
      await helper.wait(30)
      await nvim.input('<c-space>')
      await helper.waitPopup()
      let items = await helper.items()
      expect(items.length).toBeGreaterThan(1)
    })

    it('should show float window', async () => {
      let source: ISource = {
        name: 'float',
        priority: 10,
        enable: true,
        sourceType: SourceType.Native,
        doComplete: () => Promise.resolve({
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
        doComplete: async () => Promise.resolve({
          items: [{ word: 'foo' }]
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('ia.')
      await helper.waitPopup()
      let res = await helper.visible('foo', 'pattern')
      expect(res).toBe(true)
    })

    it('should not trigger triggerOnly source', async () => {
      let fn = jest.fn()
      let source: ISource = {
        name: 'pattern',
        triggerOnly: true,
        priority: 10,
        enable: true,
        sourceType: SourceType.Native,
        triggerPatterns: [/^From:\s*/],
        doComplete: () => {
          fn()
          return { items: [{ word: 'foo' }] }
        }
      }
      disposables.push(sources.addSource(source))
      await nvim.input('if')
      await helper.wait(20)
      expect(fn).toBeCalledTimes(0)
    })

    it('should not trigger when cursor moved', async () => {
      let source: ISource = {
        name: 'trigger',
        priority: 10,
        enable: true,
        sourceType: SourceType.Native,
        triggerCharacters: ['.'],
        doComplete: async () => Promise.resolve({
          items: [{ word: 'foo' }]
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.setLine('.a')
      await nvim.input('A')
      await nvim.input('<bs>')
      await nvim.input('<left>')
      await helper.wait(10)
      let visible = await pumvisible()
      expect(visible).toBe(false)
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
          doComplete: async (opt, cancellationToken) => {
            if (opt.triggerCharacter != '.') {
              token = cancellationToken
              resolve(undefined)
              return new Promise<CompleteResult<ExtendedCompleteItem>>((resolve, reject) => {
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
      helper.updateConfiguration('suggest.lowPrioritySourceLimit', 2)
      await create(['filename', 'filepath', 'find', 'filter', 'findIndex'], true)
      let items = await helper.items()
      expect(items.length).toBe(2)
    })

    it('should contains duplicated items when dup is 1', async () => {
      await create([{ word: 'foo', dup: 1 }, { word: 'foo', dup: 1 }], true)
      let items = await helper.items()
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
        doComplete: async () => Promise.resolve({
          items: ['filename', 'filepath', 'filter', 'file'].map(key => ({ word: key }))
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i.')
      await helper.waitPopup()
      let items = await helper.items()
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
        doComplete: async () => Promise.resolve({
          items: ['a', 'b', 'c', 'd'].map(key => ({ word: key.repeat(20) }))
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i.')
      await helper.waitPopup()
      let winid = await nvim.call('coc#float#get_float_by_kind', ['pum']) as number
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
        doComplete: (_opt: CompleteOption) => new Promise(resolve => {
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
      triggerCompletion('test')
      await helper.waitPopup()
      let winid = await nvim.call('coc#float#get_float_by_kind', ['pum']) as number
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
        doComplete: async () => Promise.resolve({
          items: [{ word: 'foo', dup: 1 }]
        })
      }
      let source2: ISource = {
        name: 'source2',
        priority: 90,
        enable: true,
        sourceType: SourceType.Native,
        triggerCharacters: ['.'],
        doComplete: async (opt: CompleteOption) => {
          return opt.input == 'foo' ? null : {
            items: [{ word: 'foo', dup: 1 }], isIncomplete: true
          }
        }
      }
      disposables.push(sources.addSource(source1))
      disposables.push(sources.addSource(source2))
      await nvim.input('i')
      await nvim.input('.f')
      await helper.waitPopup()
      let items = await helper.items()
      expect(items.length).toEqual(2)
      await nvim.input('oo')
      await helper.waitValue(() => {
        return completion.activeItems?.length
      }, 1)
      items = await helper.items()
      expect(items.length).toEqual(1)
      expect(items[0].word).toBe('foo')
    })
  })

  describe('indent change', () => {
    it('should trigger completion after indent change', async () => {
      await helper.createDocument('t')
      let source: ISource = {
        name: 'source1',
        priority: 90,
        enable: true,
        sourceType: SourceType.Native,
        doComplete: async () => Promise.resolve({
          items: [
            { word: 'endif' },
            { word: 'endfunction' }
          ]
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i')
      await nvim.input('  endi')
      await helper.waitPopup()
      await nvim.input('f')
      await helper.wait(10)
      await nvim.call('setline', ['.', 'endif'])
      await helper.waitValue(() => {
        return completion.option?.col
      }, 0)
    })
  })

  describe('sortItems', () => {
    it('should sort items', () => {
      let emptyInput = false
      let defaultSortMethod: SortMethod = SortMethod.None
      let a: any = {
        abbr: 'a', character: 0, filterText: 'a', index: 0, source: '', word: 'a'
      }
      let b: any = {
        abbr: 'b', character: 0, filterText: 'b', index: 0, source: '', word: 'b'
      }
      const check = (ap: any, bp: any, res: number) => {
        let val = sortItems(emptyInput, defaultSortMethod, Object.assign(ap, a), Object.assign(bp, b))
        expect(val).toBe(res)
      }
      check({ score: 1 }, { score: 2 }, 1)
      check({ priority: 1 }, { priority: 2 }, 1)
      check({ sortText: 'b' }, { sortText: 'a' }, 1)
      check({ sortText: 'a' }, { sortText: 'b' }, -1)
      check({ localBonus: 1 }, { localBonus: 2 }, 1)
    })
  })

  describe('Navigate list', () => {
    it('should navigate completion list', async () => {
      helper.updateConfiguration('suggest.noselect', true)
      await create(['foo', 'foot'], true)
      await nvim.call('coc#pum#_navigate', [1, 1])
      await helper.waitValue(() => {
        return completion.selectedItem?.word
      }, 'foo')
      await nvim.call('coc#pum#_navigate', [0, 1])
      await helper.waitValue(() => {
        return completion.selectedItem
      }, undefined)
      completion.stop(true, CompleteFinishKind.Normal)
      await events.fire('MenuPopupChanged', [{}])
      expect(completion.document).toBeNull()
    })
  })

  describe('Character insert', () => {
    beforeAll(() => {
      let source: ISource = {
        name: 'insert',
        firstMatch: false,
        sourceType: SourceType.Native,
        triggerCharacters: ['.'],
        doComplete: async opt => {
          if (opt.word === 'f') return { items: [{ word: 'foo' }] }
          if (!opt.triggerCharacter) return { items: [] }
          let result = {
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
      triggerCompletion('insert')
      await helper.waitPopup()
      let line = await nvim.line
      expect(line).toBe('f')
      await nvim.exec(`
         noa call setline('.', 'foobar')
         noa call cursor(1, 7)
         `)
      await helper.waitValue(async () => {
        return await pumvisible()
      }, false)
    })
  })
})
