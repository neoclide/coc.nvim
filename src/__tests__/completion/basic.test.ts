import * as shared from '../sharedUtil'
import commands from '../../commands'
import completion, { Completion } from '../../completion'
import sources from '../../completion/sources'
import { CompleteOption, CompleteResult, ExtendedCompleteItem, ISource, SourceConfig, SourceType, VimCompleteItem } from '../../completion/types'
import { WordDistance } from '../../completion/wordDistance'
import events from '../../events'
import languages from '../../languages'
import { CompletionItemProvider } from '../../provider'
import { disposeAll, waitWithToken } from '../../util'
import { setExtensionId } from '../../util/extensionId'
import { byteLength } from '../../util/string'
import workspace from '../../workspace'
import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable, Position, TextEdit } from 'vscode-languageserver-protocol'


let nvim: Neovim
let disposables: Disposable[] = []
before(async () => {
  nvim = workspace.nvim
})

afterEach(async () => {
  disposeAll(disposables)
  completion.loadConfiguration()
})

function triggerCompletion(source: string): void {
  nvim.call('coc#start', { source }, true)
}
async function pumvisible(): Promise<boolean> {
  let res = await nvim.call('coc#pum#visible', []) as number
  return res == 1
}

async function create(items: string[] | VimCompleteItem[], trigger = true, conf?: Partial<SourceConfig>): Promise<string> {
  let name = crypto.randomUUID()
  disposables.push(sources.createSource({
    ...(conf ?? {}),
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
    await nvim.command('startinsert')
    await shared.waitFor('mode', [], 'i')
  }
  if (trigger) {
    let bufnr = await nvim.call('bufnr', ['%']) as number
    await shared.waitValue(() => workspace.isAttached(bufnr) && events.bufnr == bufnr, true)
    triggerCompletion(name)
    await shared.waitPopup()
  }
  return name
}

afterEach(editorReset)

describe('completion', () => {
  describe('suggest configurations', () => {
    it('should select item by preselect', async t => {
      shared.updateConfiguration('suggest.noselect', true)
      assert.strictEqual(typeof Completion, 'function')
      await create([{ word: 'foo' }, { word: 'foo' }, { word: 'bar', preselect: true }], true)
      assert.strictEqual(events.completing, true)
      await nvim.input('br')
      await shared.waitValue(() => completion.activeItems.length, 1)
      await shared.confirmCompletion(0)
      await shared.waitFor('getline', ['.'], 'bar')
    })

    it('should disable preselect feature', async t => {
      shared.updateConfiguration('suggest.enablePreselect', false)
      await create([{ word: 'foo' }, { word: 'bar' }, { word: 'foot', preselect: true }], true)
      let info = await nvim.call('coc#pum#info') as any
      assert.strictEqual(info.index, 0)
    })

    it('should trigger with none ascii characters', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.asciiCharactersOnly', false)
      await create(['你好'], false)
      await nvim.input('ni')
      await shared.waitPopup()
    })

    it('should use insert range instead of replace', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.insertMode', 'insert')
      await shared.createDocument()
      await nvim.setLine('ffoo')
      let name = await create(['foo'], false)
      await nvim.call('cursor', [1, 2])
      assert.strictEqual(sources.has(name), true)
      await commands.executeCommand('editor.action.triggerSuggest', name)
      await shared.waitPopup()
      await shared.confirmCompletion(0)
      await shared.waitFor('getline', ['.'], 'foofoo')
    })

    it('should use ascii match', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.asciiMatch', true)
      await create(['\xc1\xc7\xc8'], false)
      await nvim.input('a')
      await shared.waitPopup()
      let items = await shared.items()
      assert.strictEqual(items[0].word, 'ÁÇÈ')
    })

    it('should not use ascii match', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.asciiMatch', false)
      await create(['\xc1\xc7\xc8', 'foo'], false)
      await nvim.input('a')
      await shared.wait(50)
      let visible = await pumvisible()
      assert.strictEqual(visible, false)
      await nvim.input('<cr>')
      await nvim.input('f')
      await shared.waitPopup()
    })

    it('should not trigger with none ascii characters', async t => {
      shared.updateConfiguration('suggest.asciiCharactersOnly', true)
      await create(['你好'], false)
      await nvim.input('你')
      await shared.wait(20)
      let visible = await pumvisible()
      assert.strictEqual(visible, false)
    })

    it('should not trigger with number input', async t => {
      shared.updateConfiguration('suggest.ignoreRegexps', ['[0-9]+'])
      await create(['1234', '1984'], false)
      await nvim.input('1')
      await shared.waitFor('getline', ['.'], '1')
      let visible = await pumvisible()
      assert.strictEqual(visible, false)
    })

    it('should disable filter on backspace', async t => {
      shared.updateConfiguration('suggest.filterOnBackspace', false)
      await create(['this', 'thoit'], true)
      await nvim.input('this')
      await shared.waitValue(() => {
        return completion.activeItems.length
      }, 1)
      await nvim.input('<bs>')
      await shared.waitValue(() => {
        return completion.isActivated
      }, false)
    })

    it('should select recent used item', async t => {
      shared.updateConfiguration('suggest.selection', 'recentlyUsed')
      let name = await create(['foo', 'bar', 'foobar'])
      await shared.confirmCompletion(1)
      await nvim.input('<CR>f')
      triggerCompletion(name)
      let info = await nvim.call('coc#pum#info') as any
      assert.strictEqual(info.index, 1)
    })

    it('should not resolve timeout sources', async t => {
      shared.updateConfiguration('suggest.timeout', 30)
      disposables.push(sources.createSource({
        name: 'timeout',
        doComplete: (_opt: CompleteOption, token) => new Promise(resolve => {
          let timer = setTimeout(() => {
            resolve({ items: [{ word: 'foo' }, { word: 'bar' }] })
          }, 200)
          token.onCancellationRequested(() => {
            clearTimeout(timer)
          })
        })
      }))
      await nvim.input('if')
      await shared.waitFor('eval', ["get(g:,'coc_timeout_sources','')"], ['timeout'])
    })

    it('should attribute timeout sources to the owning extension', async t => {
      shared.updateConfiguration('suggest.timeout', 30)
      let provider: CompletionItemProvider = {
        provideCompletionItems: (_doc, _pos, token) => new Promise(resolve => {
          let timer = setTimeout(() => resolve({ items: [{ label: 'foo' }], isIncomplete: false }), 200)
          token.onCancellationRequested(() => clearTimeout(timer))
        })
      }
      setExtensionId(provider, 'coc-timeout-ext')
      disposables.push(languages.registerCompletionItemProvider('foo', 'f', null, provider))
      await nvim.input('if')
      await shared.waitFor('eval', ["get(g:,'coc_timeout_sources','')"], ['foo'])
    })

    it('should recover from a source that throws synchronously', async t => {
      let provider: CompletionItemProvider = {
        provideCompletionItems: () => {
          throw new Error('provider boom')
        }
      }
      setExtensionId(provider, 'coc-err-ext')
      disposables.push(languages.registerCompletionItemProvider('foo', 'f', null, provider))
      await nvim.input('if')
      await shared.waitValue(() => events.completing, false)
      let cmdline = await shared.getCmdline()
      assert.strictEqual(cmdline.includes('error'), false)
    })

    it('should change default sort method', { timeout: 10000 }, async t => {
      const assertWords = async (arr: string[]) => {
        await shared.waitPopup()
        let win = await shared.getFloat('pum')
        let words = await win.getVar('words')
        assert.deepStrictEqual(words, arr)
      }
      shared.updateConfiguration('suggest.defaultSortMethod', 'none')
      await create([{ word: 'far' }, { word: 'foobar' }, { word: 'foo' }], false)
      await nvim.input('f')
      await assertWords(['far', 'foobar', 'foo'])
      await nvim.input('<esc>')
      shared.updateConfiguration('suggest.defaultSortMethod', 'alphabetical')
      await shared.wait(20)
      await nvim.input('of')
      await assertWords(['far', 'foo', 'foobar'])
    })

    it('should remove duplicated words', async t => {
      shared.updateConfiguration('suggest.removeDuplicateItems', true)
      await create([{ word: 'foo', dup: 1 }, { word: 'foo', dup: 1 }], true)
      let win = await shared.getFloat('pum')
      let words = await win.getVar('words')
      assert.deepStrictEqual(words, ['foo'])
    })

    it('should remove current word', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.removeCurrentWord', true)
      let buf = await nvim.buffer
      let doc = workspace.getDocument(buf.id)
      await buf.setLines(['foo bar', ''], { start: 0, end: -1, strictIndexing: false })
      await doc.patchChange()
      await nvim.call('cursor', [2, 1])
      await nvim.input('if')
      await shared.waitPopup()
      await nvim.input('oo')
      await shared.waitFor('coc#pum#visible', [], 0)
    })

    it('should use border with floatConfig', { timeout: 10000 }, async t => {
      let dispose = shared.updateConfiguration('suggest.floatConfig', {
        border: true,
        rounded: true,
        borderhighlight: 'Normal',
        title: 'title'
      })
      await create([{ word: 'foo', kind: 'w', menu: 'x' }, { word: 'foobar', kind: 'w', menu: 'y' }], true)
      await shared.waitPopup()
      let win = await shared.getFloat('pum')
      let id = await nvim.call('coc#float#get_related', [win.id, 'border']) as number
      assert.ok(id > 1000)
      dispose()
    })

    it('should use pumFloatConfig', async t => {
      shared.updateConfiguration('suggest.floatConfig', {})
      shared.updateConfiguration('suggest.pumFloatConfig', {
        border: true,
        highlight: 'Normal',
        winblend: 15,
        shadow: true,
        rounded: true,
        title: 'suggest'
      })
      await create([{ word: 'foo', kind: 'w', menu: 'x' }, { word: 'foobar', kind: 'w', menu: 'y' }], true)
      let win = await shared.getFloat('pum')
      let id = await nvim.call('coc#float#get_related', [win.id, 'border']) as number
      assert.ok(id > 1000)
      let hl = await win.getOption('winhl')
      assert.match(hl, new RegExp('Normal'))
      let border = nvim.createWindow(id)
      let buf = await border.buffer
      let lines = await buf.lines
      assert.match(lines[0], new RegExp('suggest'))
    })

    it('should keep pum position for invalid pumAlign', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.formatItems', ['abbr', 'menu', 'kind', 'shortcut'])
      let buf = await nvim.buffer
      await buf.setLines(['xxxxxxxxxxxx foo ', ''], { start: 0, end: -1, strictIndexing: false })
      let doc = workspace.getDocument(buf.id)
      await doc.patchChange()
      await nvim.call('cursor', [1, 17])
      let name = await create([
        { word: 'foo', menu: 'm', kind: 'w' },
        { word: 'foobar', menu: 'menu2', kind: 'v' }
      ], true)
      let info = await nvim.call('coc#pum#info') as any
      completion.cancelAndClose()
      shared.updateConfiguration('suggest.pumAlign', 'invalid')
      nvim.call('coc#start', { source: name }, true)
      await shared.waitPopup()
      let info2 = await nvim.call('coc#pum#info') as any
      assert.strictEqual(info2.col, info.col)
    })

    it('should do filter when autoTrigger is none', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.autoTrigger', 'none')
      let doc = await workspace.document
      assert.strictEqual(completion.shouldTrigger(doc, ''), false)
      await create(['foo', 'bar'], false)
      await nvim.input('f')
      await shared.wait(20)
      assert.strictEqual(completion.activeItems.length, 0)
      nvim.call('coc#start', [], true)
      await shared.waitPopup()
      assert.strictEqual(completion.activeItems.length, 1)
      await nvim.input('o')
      await shared.wait(20)
      assert.strictEqual(completion.activeItems.length, 1)
    })

    it('should trigger for trigger character when filter failed', { timeout: 10000 }, async t => {
      await nvim.command('edit tmp')
      let doc = await workspace.document
      doc.chars.addKeyword('-')
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
      await shared.waitPopup()
      assert.strictEqual(option.triggerCharacter, undefined)
      await nvim.input('-')
      await shared.waitValue(() => {
        let items = completion.activeItems
        return items && items.length == 1 && items[0].word == '-foo'
      }, true)
    })

    it('should trigger on trigger character', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.autoTrigger', 'none')
      let fn = t.mock.fn()
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
      await shared.wait(20)
      assert.strictEqual(fn.mock.callCount(), 0)
      shared.updateConfiguration('suggest.autoTrigger', 'trigger')
      await nvim.input('f')
      await shared.wait(20)
      await nvim.input('.')
      await shared.waitPopup()
    })

    it('should disable localityBonus', async t => {
      shared.updateConfiguration('suggest.localityBonus', false)
      let doc = await workspace.document
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), '\nfoo\nfoobar')])
      await create(['foo', 'foobar'], true)
      await shared.confirmCompletion(0)
    })

    it('should not show preview window when enableFloat is disabled', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.enableFloat', false)
      let resolved = false
      disposables.push(sources.createSource({
        name: 'info',
        doComplete: () => Promise.resolve({ items: [{ word: 'foo', info: 'detail' }] }),
        onCompleteResolve: () => {
          resolved = true
        }
      }))
      await nvim.command('startinsert')
      triggerCompletion('info')
      await shared.waitPopup()
      let floatWin = await shared.getFloat('pumdetail')
      assert.strictEqual(floatWin, undefined)
      await shared.confirmCompletion(0)
      await shared.waitValue(() => {
        return resolved
      }, true)
    })

    it('should disable graceful filter', async t => {
      shared.updateConfiguration('suggest.filterGraceful', false)
      await create(['this'], true)
      await nvim.input('tih')
      await shared.waitValue(async () => {
        let items = await shared.items()
        return items.length
      }, 0)
    })

    it('should change detailField', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.detailField', 'abbr')
      await create([{ word: 'this', detail: 'detail of this' }], true)
      let floatWin = await shared.getFloat('pum')
      let buf = await floatWin.buffer
      assert.notStrictEqual(buf, undefined)
    })

    it('should change triggerCompletionWait', async t => {
      let doc = await workspace.document
      shared.updateConfiguration('suggest.triggerCompletionWait', 200)
      let name = await create([{ word: 'foo' }, { word: 'bar' }], false)
      triggerCompletion(name)
      let spy
      let p = new Promise<void>(resolve => {
        spy = t.mock.method(doc, 'patchChange', () => {
          resolve()
          return Promise.resolve()
        })
      })
      await p
      await shared.wait(20)
      completion.cancelAndClose()
    })
  })

  describe('suggest variables', () => {
    beforeEach(() => {
      disposables.push(sources.createSource({
        name: 'foo',
        doComplete: (_opt: CompleteOption) => Promise.resolve({ items: [{ word: 'foo' }] })
      }))
    })

    it('should be disabled by b:coc_suggest_disable', async t => {
      let doc = await workspace.document
      await doc.buffer.setVar('coc_suggest_disable', 1)
      await nvim.input('if')
      await shared.wait(20)
      let visible = await pumvisible()
      assert.strictEqual(visible, false)
    })

    it('should be disabled by b:coc_disabled_sources', async t => {
      let doc = await workspace.document
      await doc.buffer.setVar('coc_disabled_sources', ['foo'])
      await nvim.input('if')
      await shared.wait(20)
      let visible = await pumvisible()
      assert.strictEqual(visible, false)
    })

    it('should be disabled by b:coc_suggest_blacklist', async t => {
      let doc = await workspace.document
      await doc.buffer.setVar('coc_suggest_blacklist', ['end'])
      await nvim.setLine('en')
      await nvim.input('Ad')
      await shared.wait(20)
      let visible = await pumvisible()
      assert.strictEqual(visible, false)
    })
  })

  describe('shouldComplete()', () => {
    it('should not complete when shouldComplete return false', { timeout: 10000 }, async t => {
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
      await shared.wait(20)
      assert.strictEqual(called, false)
      shouldRun = true
      triggerCompletion(name)
      await shared.waitPopup()
    })

    it('should not complete with empty sources', async t => {
      nvim.call('coc#start', { source: 'not_exists' }, true)
      await shared.wait(20)
      let visible = await pumvisible()
      assert.strictEqual(visible, false)
    })
  })

  describe('doComplete()', () => {
    it('should create pum', { timeout: 10000 }, async t => {
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
      await shared.waitPopup()
      let info = await nvim.call('coc#pum#info') as any
      assert.strictEqual(info.index, 0)
    })

    it('should show slow source', { timeout: 10000 }, async t => {
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
      await shared.waitPopup()
      assert.strictEqual(completion.isActivated, true)
      let items = await shared.items()
      assert.strictEqual(items.length, 2)
      await nvim.input('foo')
      await shared.waitValue(async () => (await shared.items()).length, 1)
      items = await shared.items()
      assert.strictEqual(items.length, 1)
    })

    it('should catch error', async t => {
      disposables.push(sources.createSource({
        name: 'error',
        doComplete: (_opt: CompleteOption) => new Promise((_resolve, reject) => {
          reject(new Error('custom error'))
        })
      }))
      await nvim.input('if')
      await shared.wait(50)
      let cmdline = await shared.getCmdline()
      assert.match(cmdline, new RegExp(''))
    })

    it('should show items before slow source finished', async t => {
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
      assert.strictEqual(finished, false)
    })

    it('should show items when wordDistance is slow', { timeout: 10000 }, async t => {
      let _resolve
      let spy = t.mock.method(WordDistance, 'create', () => {
        return new Promise(resolve => {
          _resolve = resolve
        })
      })
      await create(['foo', 'foot'], false)
      await nvim.input('f')
      await shared.waitPopup()
      _resolve(undefined)
    })
  })

  describe('resumeCompletion()', () => {
    it('should not cancel when trigger for inComplete', { timeout: 10000 }, async t => {
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
      await shared.waitPopup()
      let items = completion.activeItems
      assert.strictEqual(items.length, 1)
      await nvim.input('o')
      await shared.wait(30)
      fireResolve()
      await shared.waitValue(() => {
        return completion.activeItems.length
      }, 4)
    })

    it('should refresh pum when complete inComplete sources', { timeout: 10000 }, async t => {
      let name = Math.random().toString(16).slice(-6)
      disposables.push(sources.createSource({
        name,
        doComplete: (_opt: CompleteOption) => new Promise(resolve => {
          resolve({ items: [{ word: 'foo' }, { word: 'foot' }] })
        })
      }))
      let timer
      let called = false
      disposables.push(sources.createSource({
        name: 'inComplete',
        doComplete: (opt: CompleteOption, token) => new Promise(resolve => {
          if (opt.input.length == 1) {
            resolve({ items: [{ word: 'fa' }], isIncomplete: true })
          } else {
            token.onCancellationRequested(() => {
              called = true
            })
            timer = setTimeout(() => {
              resolve({ items: [{ word: 'footman' }, { word: 'football' }, { word: 'fa' }], isIncomplete: false })
            }, 1000)
          }
        })
      }))
      await nvim.input('if')
      await shared.waitPopup()
      await nvim.input('t')
      await shared.waitValue((() => {
        let activeItems = completion.activeItems
        return activeItems.length == 1 && activeItems[0].word === 'foot'
      }), true)
      await nvim.input('t')
      await shared.waitValue(() => called, true)
      clearTimeout(timer)
    })

    it('should close pum after pending retry is cancelled by results', async t => {
      shared.updateConfiguration('suggest.autoTrigger', 'trigger')
      let resolveInitial: (result: CompleteResult<ExtendedCompleteItem>) => void
      let resolveIncomplete: (result: CompleteResult<ExtendedCompleteItem>) => void
      let startedResolve: () => void
      let started = new Promise<void>(resolve => {
        startedResolve = resolve
      })
      let incompleteStartedResolve: () => void
      let incompleteStarted = new Promise<void>(resolve => {
        incompleteStartedResolve = resolve
      })
      let name = crypto.randomUUID()
      disposables.push(sources.createSource({
        name,
        doComplete: (opt: CompleteOption) => {
          if (opt.triggerForInComplete) {
            return new Promise<CompleteResult<ExtendedCompleteItem>>(resolve => {
              resolveIncomplete = resolve
              incompleteStartedResolve()
            })
          }
          return new Promise<CompleteResult<ExtendedCompleteItem>>(resolve => {
            resolveInitial = resolve
            startedResolve()
          })
        }
      }))
      await nvim.input('if')
      nvim.call('coc#start', { source: name }, true)
      await started
      let textChanged = events.race(['TextChangedI'])
      let input = nvim.input('o')
      await textChanged
      resolveInitial({ isIncomplete: true, items: [{ word: 'foo' }] })
      await input
      await incompleteStarted
      await shared.waitPopup()

      resolveIncomplete({ items: [] })
      await shared.waitValue(pumvisible, false)
    })

    it('should clear pending retry before trigger returns early', async t => {
      shared.updateConfiguration('suggest.autoTrigger', 'trigger')
      let resolveComplete: (result: CompleteResult<ExtendedCompleteItem>) => void
      let startedResolve: () => void
      let started = new Promise<void>(resolve => {
        startedResolve = resolve
      })
      let name = crypto.randomUUID()
      disposables.push(sources.createSource({
        name,
        doComplete: () => new Promise<CompleteResult<ExtendedCompleteItem>>(resolve => {
          resolveComplete = resolve
          startedResolve()
        })
      }))
      let shouldTrigger = t.mock.method(completion, 'shouldTrigger')
      await nvim.input('i')
      nvim.call('coc#start', { source: name }, true)
      await started

      await nvim.input('f')
      await shared.waitValue(() => shouldTrigger.mock.calls.length > 0, true)
      resolveComplete({ items: [] })

      await shared.waitValue(() => completion.isActivated, false)
    })

    it('should stop if no filtered items', async t => {
      await create(['foo', 'bar'], true)
      assert.strictEqual(completion.isActivated, true)
      await nvim.input('fp')
      await shared.waitValue(() => {
        return completion.isActivated
      }, false)
    })

    it('should stop when selected and no filtered items', async t => {
      shared.updateConfiguration('suggest.noselect', true)
      await create(['foo'], true)
      assert.strictEqual(completion.isActivated, true)
      await nvim.call('coc#pum#_navigate', [1, 1])
      await shared.waitFor('getline', ['.'], 'foo')
      await nvim.input('(')
      await shared.waitValue(() => {
        return completion.isActivated
      }, false)
    })

    it('should not resume after text change', { timeout: 10000 }, async t => {
      await create(['foo'], false)
      await nvim.input('f')
      await shared.waitPopup()
      await nvim.setLine('fo')
      await nvim.call('cursor', [2, 3])
      await shared.waitValue(() => {
        return completion.isActivated
      }, false)
    })

    it('should stop with bad insert on CursorMovedI', async t => {
      await create(['foo', 'fat'], false)
      await nvim.input('f')
      await nvim.setLine('f a')
      await nvim.call('cursor', [2, 4])
      await shared.wait(30)
      let visible = await pumvisible()
      assert.strictEqual(visible, false)
    })

    it('should deactivate without filtered items', async t => {
      await create(['foo', 'foobar'], true)
      await nvim.input('f')
      await nvim.input(' a')
      await shared.waitFor('coc#pum#visible', [], 0)
      assert.strictEqual(completion.isActivated, false)
      completion.cancel()
    })

    it('should deactivate when insert space', { timeout: 10000 }, async t => {
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
      await shared.waitPopup()
      assert.strictEqual(completion.isActivated, true)
      let items = await shared.items()
      assert.strictEqual(items[0].word, 'foo bar')
      await nvim.input(' ')
      await shared.waitValue(async () => {
        return await pumvisible()
      }, false)
    })

    it('should use resume input to filter', { timeout: 10000 }, async t => {
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
      await shared.wait(20)
      await nvim.input('f')
      await shared.waitPopup()
      assert.strictEqual(completion.isActivated, true)
      let items = await shared.items()
      assert.strictEqual(items.length, 1)
      assert.strictEqual(items[0].word, 'foo')
    })

    it('should keep trigger completion after backspace clears input', { timeout: 10000 }, async t => {
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'source',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: () => Promise.resolve({ items: [{ word: 'foo' }, { word: 'bar' }] })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i.')
      await shared.waitPopup()
      await nvim.input('f')
      await shared.waitValue(() => completion.activeItems.length, 1)
      await nvim.input('<backspace>')
      await shared.waitValue(() => completion.activeItems.length, 2)
      assert.strictEqual(await pumvisible(), true)
    })

    it('should stop completion when trigger source is not active', { timeout: 10000 }, async t => {
      await nvim.setLine('x.f')
      await nvim.input('A')
      let name = await create(['foo'], false)
      disposables.push(sources.addSource({
        name: crypto.randomUUID(),
        enable: true,
        triggerCharacters: ['.'],
        doComplete: async () => ({ items: [{ word: 'trigger' }] })
      }))
      triggerCompletion(name)
      await shared.waitPopup()
      await nvim.input('<backspace>')
      await shared.waitValue(() => completion.isActivated, false)
    })

    it('should filter slow source', { timeout: 10000 }, async t => {
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
      await shared.wait(20)
      await nvim.input('f')
      await shared.waitPopup()
      await nvim.input('o')
      await shared.waitValue((() => {
        return completion.activeItems?.length
      }), 1)
    })

    it('should complete inComplete source', { timeout: 10000 }, async t => {
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
          await shared.wait(20)
          return { isIncomplete: false, items: [{ word: 'foo' }, { word: opt.input }] }
        }
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i.')
      await shared.waitPopup()
      assert.strictEqual(completion.isActivated, true)
      await nvim.input('a')
      await shared.wait(20)
      await nvim.input('b')
    })

    it('should not complete inComplete source when isIncomplete is false', { timeout: 10000 }, async t => {
      let source: ISource = {
        priority: 0,
        enable: true,
        name: 'inComplete',
        sourceType: SourceType.Service,
        triggerCharacters: ['.'],
        doComplete: async (opt: CompleteOption) => {
          await shared.wait(30)
          if (opt.input.length <= 1) {
            return { isIncomplete: true, items: [{ word: 'foobar' }] }
          }
          return { isIncomplete: false, items: [{ word: 'foobar' }] }
        }
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i.')
      await shared.waitPopup()
      assert.strictEqual(completion.isActivated, true)
      await nvim.input('fo')
      await shared.waitValue(() => completion.isActivated, true)
      await nvim.input('b')
      await shared.waitValue(() => completion.isActivated, true)
      assert.strictEqual(completion.isActivated, true)
    })

    it('should filter when type character after item selected without handle complete done', { timeout: 10000 }, async t => {
      let input: string
      let fn = t.mock.fn()
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
      await shared.waitPopup()
      await nvim.call('coc#pum#_navigate', [1, 1])
      await shared.wait(20)
      await nvim.input('o')
      await shared.waitPopup()
      assert.strictEqual(fn.mock.callCount(), 0)
    })
  })

  describe('TextChangedI', () => {
    it('should filter on backspace', async t => {
      await create(['foo', 'fbi'], true)
      await nvim.input('fo')
      await shared.waitValue(() => completion.activeItems.length, 1)
      await nvim.input('<backspace>')
      await shared.waitValue(() => completion.activeItems.length, 2)
    })

    it('should start new completion after backspace clears input', async t => {
      let calls: string[] = []
      let name = crypto.randomUUID()
      disposables.push(sources.createSource({
        name,
        doComplete: opt => {
          calls.push(opt.input)
          return { items: [{ word: opt.input == 'f' ? 'foo' : 'bar' }] }
        }
      }))
      await nvim.setLine('foo bar -f')
      await nvim.input('A')
      triggerCompletion(name)
      await shared.waitPopup()

      await nvim.exec(`
        noa call setline('.', 'foo bar -')
        noa call cursor(1, 10)
      `)
      let changedtick = await nvim.eval('b:changedtick')
      await events.fire('TextChangedI', [events.bufnr, {
        lnum: 1,
        col: 10,
        changedtick,
        line: 'foo bar -'
      }])
      assert.strictEqual(completion.isActivated, false)

      await nvim.input('b')
      await shared.waitValue(() => calls.includes('b'), true)
      await shared.waitValue(() => completion.activeItems.some(item => item.word == 'bar'), true)
      assert.strictEqual(await shared.visible('bar'), true)
      assert.deepStrictEqual(calls, ['f', 'b'])
    })

    it('should respect commit character', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.acceptSuggestionOnCommitCharacter', true)
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
      await shared.waitPopup()
      await nvim.input('o.')
      await shared.waitFor('getline', ['.'], 'foo.')
    })

    it('should cancel on CursorMoved', async t => {
      await nvim.setLine('first line')
      await nvim.input('o')
      await create(['foo', 'foot'])
      let [_, line, col] = await nvim.call('getcurpos') as number[]
      completion.onCursorMovedI(events.bufnr, [line, col], false)
      assert.strictEqual(completion.isActivated, true)
      completion.onCursorMovedI(events.bufnr, [line, col - 1], false)
      assert.strictEqual(completion.isActivated, false)
      await events.fire('PumNavigate', [])
    })

    it('should stop completion with invalid input', async t => {
      await nvim.setLine('line ')
      await nvim.input('Af')
      await create(['foo', 'foot'])
      await nvim.setLine('abcd f')
      await shared.waitValue(() => completion.isActivated, false)
      await completion.filterResults()
    })

    it('should check indent change', async t => {
      await create(['foo', 'bar'])
      const linenr = completion.option.linenr
      let changed = completion.hasIndentChange({ lnum: linenr + 1, col: 1, line: '', changedtick: 0, pre: '', })
      assert.strictEqual(changed, false)
    })
  })

  describe('TextChangedP', () => {
    it('should cancel on CursorMoved', { timeout: 10000 }, async t => {
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
      await shared.waitPopup()
      void events.fire('CompleteDone', [{}])
      await shared.wait(20)
      await events.fire('CursorMovedI', [buf.id, [2, 1, '']])
      await shared.waitValue(() => {
        return completion.isActivated
      }, false)
    })
  })

  describe('onCompleteResolve', () => {
    beforeEach(() => {
      shared.updateConfiguration('coc.source.resolve.triggerCharacters', ['.'])
    })

    it('should do resolve for complete item', { timeout: 10000 }, async t => {
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
      await shared.waitPopup()
      await shared.confirmCompletion(0)
      await shared.waitFor('getline', ['.'], '.foo')
      assert.strictEqual(resolved, true)
    })

    it('should cancel resolve request', async t => {
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
      await shared.waitValue(() => {
        return called
      }, true)
      await nvim.call('coc#pum#_navigate', [1, 0])
      await shared.waitValue(() => {
        return cancelled
      }, true)
      nvim.call('coc#pum#cancel', [], true)
      let floatWin = await shared.getFloat('pumdetail')
      assert.strictEqual(floatWin, undefined)
    })

    it('should not throw error', { timeout: 10000 }, async t => {
      let called = false
      disposables.push(sources.createSource({
        name: 'resolve',
        doComplete: (_opt: CompleteOption) => Promise.resolve({ items: [{ word: 'foo' }] }),
        onCompleteResolve: async _item => {
          called = true
          throw new Error('custom error')
        }
      }))
      await nvim.input('i.')
      await shared.waitPopup()
      assert.strictEqual(called, true)
      let cmdline = await shared.getCmdline()
      assert.strictEqual(cmdline.includes('error'), false)
    })

    it('should timeout on resolve', { timeout: 10000 }, async t => {
      let called = false
      let finishResolve: () => void
      disposables.push(sources.createSource({
        name: 'resolve',
        doComplete: (_opt: CompleteOption) => Promise.resolve({ items: [{ word: 'foo' }] }),
        onCompleteResolve: async item => {
          called = true
          await new Promise<void>(resolve => {
            finishResolve = resolve
          })
          item.info = 'info'
        }
      }))
      await nvim.input('i.')
      await shared.waitPopup()
      await shared.waitValue(() => {
        return called
      }, true)
      let floatWin = await shared.getFloat('pumdetail')
      assert.strictEqual(floatWin, undefined)
      finishResolve()
      await Promise.resolve()
    })
  })

  describe('trigger completion', () => {
    it('should trigger completion if triggerAfterInsertEnter is true', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.triggerAfterInsertEnter', true)
      await nvim.command('edit t|setl buftype=nofile')
      await nvim.input('o')
      await shared.wait(20)
      assert.strictEqual(completion.isActivated, false)
      await shared.createDocument()
      await create(['fball', 'football'], false)
      await nvim.input('f')
      await nvim.input('<esc>')
      await nvim.input('A')
      await shared.waitPopup()
      assert.strictEqual(completion.isActivated, true)
    })

    it('should trigger complete when trigger patterns match', { timeout: 10000 }, async t => {
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
      await shared.waitPopup()
      let items = await shared.items()
      assert.strictEqual(items.length, 2)
    })

    it('should filter and sort on increment search', { timeout: 10000 }, async t => {
      await create(['forceDocumentSync', 'format', 'fallback'], false)
      await nvim.input('f')
      await shared.waitPopup()
      await nvim.input('oa')
      await shared.waitPopup()
      let items = await shared.items()
      assert.strictEqual(items.findIndex(o => o.word == 'fallback'), -1)
    })

    it('should not trigger on insert enter', async t => {
      await nvim.setLine('f')
      await create(['foo', 'bar'], false)
      await nvim.input('<esc>')
      await nvim.input('A')
      await shared.wait(20)
      let visible = await pumvisible()
      assert.strictEqual(visible, false)
    })

    it('should filter on fast input', { timeout: 10000 }, async t => {
      await create(['foo', 'bar'], false)
      await nvim.input('br')
      await shared.waitPopup()
      let items = await shared.items()
      let item = items.find(o => o.word == 'foo')
      assert.ok(!item)
      assert.strictEqual(items[0].word, 'bar')
    })

    it('should filter completion when type none trigger character', { timeout: 10000 }, async t => {
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
      await shared.waitPopup()
      await nvim.input('(')
      await shared.waitValue(() => pumvisible(), true)
      let res = await pumvisible()
      assert.strictEqual(res, true)
    })

    it('should trigger on triggerCharacters', { timeout: 10000 }, async t => {
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
      await shared.waitPopup()
      let items = await shared.items()
      assert.strictEqual(items.length, 2)
    })

    it('should fix start column', { timeout: 10000 }, async t => {
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
      await shared.waitPopup()
      await shared.confirmCompletion(0)
      await shared.waitFor('getline', ['.'], 'foo.bar')
    })

    it('should should complete items without input', { timeout: 10000 }, async t => {
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
      await shared.waitFor('mode', [], 'i')
      await nvim.input('<c-space>')
      await shared.waitPopup()
      let items = await shared.items()
      assert.ok(items.length > 1)
    })

    it('should show float window', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.floatConfig', { border: true, title: 'title' })
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
      await nvim.input('if')
      await shared.waitPopup()
      let hasFloat = await nvim.call('coc#float#has_float')
      assert.strictEqual(hasFloat, 1)
      let res = await shared.visible('foo', 'float')
      assert.strictEqual(res, true)
    })

    it('should trigger on triggerPatterns', async t => {
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
      await shared.waitPopup()
      let res = await shared.visible('foo', 'pattern')
      assert.strictEqual(res, true)
    })

    it('should not trigger triggerOnly source', async t => {
      let fn = t.mock.fn()
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
      await shared.wait(20)
      assert.strictEqual(fn.mock.callCount(), 0)
    })

    it('should not trigger when cursor moved', async t => {
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
      await shared.wait(20)
      let visible = await pumvisible()
      assert.strictEqual(visible, false)
    })

    it('should trigger when completion is not completed', { timeout: 10000 }, async t => {
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
      await shared.waitPopup()
      await shared.visible('bar', 'completion')
      assert.notStrictEqual(token, undefined)
      assert.strictEqual(token.isCancellationRequested, true)
    })
  })

  describe('completion results', () => {
    it('should limit results for low priority source', async t => {
      shared.updateConfiguration('suggest.lowPrioritySourceLimit', 2)
      await create(['filename', 'filepath', 'find', 'filter', 'findIndex'], true)
      let items = await shared.items()
      assert.strictEqual(items.length, 2)
    })

    it('should contains duplicated items when dup is 1', async t => {
      await create([{ word: 'foo', dup: 1 }, { word: 'foo', dup: 1 }], true)
      let items = await shared.items()
      assert.strictEqual(items.length, 2)
    })

    it('should limit result for high priority source', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.highPrioritySourceLimit', 2)
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
      await shared.waitPopup()
      let items = await shared.items()
      assert.ok(items.length > 1)
    })

    it('should truncate label of complete items', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.formatItems', ['abbr'])
      shared.updateConfiguration('suggest.labelMaxLength', 10)
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
      await shared.waitPopup()
      let winid = await nvim.call('coc#float#get_float_by_kind', ['pum']) as number
      let win = nvim.createWindow(winid)
      let buf = await win.buffer
      let lines = await buf.lines
      assert.strictEqual(lines[0].trim().length, 10)
    })

    it('should render labelDetails', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.formatItems', ['abbr'])
      shared.updateConfiguration('suggest.labelMaxLength', 10)
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
      await shared.waitPopup()
      let winid = await nvim.call('coc#float#get_float_by_kind', ['pum']) as number
      let win = nvim.createWindow(winid)
      let buf = await win.buffer
      let lines = await buf.lines
      assert.strictEqual(lines.length, 2)
      assert.match(lines[0], /xfoo bar/)
    })

    it('should delete previous items when complete items is null', { timeout: 10000 }, async t => {
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
      await shared.waitPopup()
      let items = await shared.items()
      assert.deepStrictEqual(items.length, 2)
      await nvim.input('oo')
      await shared.waitValue(() => {
        return completion.activeItems?.length
      }, 1)
      items = await shared.items()
      assert.deepStrictEqual(items.length, 1)
      assert.strictEqual(items[0].word, 'foo')
    })

    it('should cancel completion on navigate', { timeout: 10000 }, async t => {
      let source1: ISource = {
        name: 'source1',
        priority: 90,
        enable: true,
        sourceType: SourceType.Native,
        doComplete: async () => Promise.resolve({
          items: [{ word: 'foo' }, { word: 'for' }]
        })
      }
      let cancelled = false
      let source2: ISource = {
        name: 'source2',
        priority: 90,
        enable: true,
        sourceType: SourceType.Native,
        doComplete: async (_opt: CompleteOption, token) => {
          return new Promise(resolve => {
            let timer = setTimeout(() => {
              resolve({ items: [{ word: 'foobar' }] })
            }, 500)
            token.onCancellationRequested(() => {
              cancelled = true
              clearTimeout(timer)
            })
          })
        }
      }
      disposables.push(sources.addSource(source1))
      disposables.push(sources.addSource(source2))

      await nvim.input('i')
      await nvim.input('f')
      await shared.waitPopup()
      await nvim.input('<down>')
      await shared.waitValue(() => {
        return cancelled
      }, true)
    })
  })

  describe('indent change', () => {
    it('should trigger completion after indent change', { timeout: 10000 }, async t => {
      await shared.createDocument('t')
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
      await shared.waitPopup()
      await nvim.input('f')
      await shared.wait(20)
      await nvim.call('setline', ['.', 'endif'])
      await shared.waitValue(() => {
        return completion.option?.col
      }, 0)
    })

    it('should not trigger completion after indent change with reTriggerAfterIndent disabled', { timeout: 10000 }, async t => {
      shared.updateConfiguration('suggest.reTriggerAfterIndent', false)
      await shared.createDocument('t')
      let source: ISource = {
        name: 'source1',
        priority: 90,
        enable: true,
        sourceType: SourceType.Native,
        doComplete: async () => Promise.resolve({
          items: [{ word: 'endif' }]
        })
      }
      disposables.push(sources.addSource(source))
      await nvim.input('i')
      await nvim.input('  endi')
      await shared.waitPopup()
      await nvim.input('f')
      await shared.wait(20)
      await nvim.call('setline', ['.', 'endif'])
      await shared.wait(20)
      let visible = await pumvisible()
      assert.strictEqual(visible, false)
    })
  })

  describe('Navigate list', () => {
    it('should navigate completion list', async t => {
      await workspace.document
      shared.updateConfiguration('suggest.noselect', true)
      await create(['foo', 'foot'], true)
      let items = completion.activeItems
      nvim.call('coc#pum#_navigate', [1, 1], true)
      await shared.waitValue(() => {
        return completion.selectedItem?.word == items[0].word
      }, true)
      nvim.call('coc#pum#_navigate', [0, 1], true)
      await shared.waitValue(() => {
        return completion.selectedItem
      }, undefined)
      completion.cancelAndClose()
      await events.fire('MenuPopupChanged', [{}])
      assert.strictEqual(completion.isActivated, false)
    })

    it('should not cancel when cursor moved to end of inserted word', async t => {
      await workspace.document
      shared.updateConfiguration('suggest.noselect', true)
      await create(['foo', 'foot'], true)
      let items = completion.activeItems
      let { option } = completion
      await nvim.call('coc#pum#_navigate', [1, 1])
      let word = items[0].word
      await shared.waitValue(() => {
        return completion.selectedItem?.word == word
      }, true)
      completion.onCursorMovedI(option.bufnr, [option.linenr, option.col + byteLength(word) + 1], false)
      assert.strictEqual(completion.isActivated, true)
    })
  })

  describe('Character insert', () => {
    before(() => {
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

    after(() => {
      sources.removeSource('insert')
    })

    it('should keep selected text after text change', { timeout: 10000 }, async t => {
      let doc = await workspace.document
      await nvim.setLine('f')
      await nvim.input('A')
      await doc.synchronize()
      triggerCompletion('insert')
      await shared.waitPopup()
      let line = await nvim.line
      assert.strictEqual(line, 'f')
      await nvim.exec(`
         noa call setline('.', 'foobar')
         noa call cursor(1, 7)
         `)
      await shared.waitValue(async () => {
        return await pumvisible()
      }, false)
    })
  })

  describe('pum position', () => {
    it('should place popup menu after concealed text on current line', async t => {
      // Regression for #5582: concealed text before the input shifts the visible
      // screen column. The pum must align with the conceal-aware screen position,
      // not the byte/virtual column.
      await shared.edit()
      await nvim.command('syntax match CocConceal /conceal/ conceal')
      await nvim.command('setl conceallevel=2 concealcursor=i')
      await nvim.setLine('conceal ')
      await nvim.input('A')
      let name = await create(['conceal', 'conclude'], false)
      await nvim.input('conc')
      await shared.visible('conclude', name)
      let win: any
      await shared.waitValue(async () => {
        win = await shared.getFloat('pum')
        return win != null
      }, true)
      let pos = await nvim.call('nvim_win_get_position', [win.id]) as [number, number]
      let wincol = await nvim.call('wincol') as number
      let virtcol = await nvim.call('virtcol', ['.']) as number
      // "conceal" is hidden, so the cursor screen column is far smaller than the
      // virtual column; the pum must follow the conceal-aware column.
      assert.ok(wincol < virtcol)
      // Aligned just left of the conceal-aware cursor column, well away from the
      // virtual position that would place it after the hidden "conceal ".
      assert.ok(pos[1] < wincol)
      assert.ok(pos[1] < virtcol - byteLength('conc'))
    })
  })
})
