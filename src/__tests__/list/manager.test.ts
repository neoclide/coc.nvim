import * as shared from '../sharedUtil'
import { nvim } from '../sharedUtil'
import events from '../../events'
import manager, { createConfigurationNode, ListManager } from '../../list/manager'
import { IList } from '../../list/types'
import { QuickfixItem } from '../../types'
import { toArray } from '../../util/array'
import { CancellationError } from '../../util/errors'
import window from '../../window'
import { Window } from '@chemzqm/neovim'
import EventEmitter from 'events'
import path from 'path'
import { Range } from 'vscode-languageserver-types'
import { after, afterEach, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'


const locations: ReadonlyArray<QuickfixItem> = [{
  filename: import.meta.filename,
  col: 2,
  lnum: 1,
  text: 'foo'
}, {
  filename: import.meta.filename,
  col: 1,
  lnum: 2,
  text: 'Bar'
}, {
  filename: import.meta.filename,
  col: 1,
  lnum: 3,
  text: 'option'
}]

async function getFloats(): Promise<Window[]> {
  let ids = await nvim.call('coc#float#get_float_win_list', []) as number[]
  if (!ids) return []
  return ids.map(id => nvim.createWindow(id))
}

async function waitCmdline(text: string): Promise<void> {
  await shared.waitValue(async () => (await shared.getCmdline()).includes(text), true)
}

before(async () => {
  await nvim.setVar('coc_jump_locations', locations)
})

afterEach(async () => {
  await manager.cancel(true)
  manager.reset()
  await nvim.command('windo setl winfixbuf&')
})

after(async () => {
})

afterEach(editorReset)

describe('list', () => {
  describe('createConfigurationNode', () => {
    it('should createConfigurationNode', async t => {
      assert.notStrictEqual(createConfigurationNode('foo', true), undefined)
      assert.notStrictEqual(createConfigurationNode('bar', false), undefined)
      assert.notStrictEqual(createConfigurationNode('foo', false, 'id'), undefined)
    })
  })

  describe('events', () => {
    it('should cancel and enable prompt', async t => {
      let winid = await nvim.call('win_getid')
      await manager.start(['location'])
      await manager.session.ui.ready
      await nvim.call('win_gotoid', [winid])
      await shared.waitValue(async () => {
        return await nvim.call('coc#prompt#activated')
      }, 0)
      await nvim.command('wincmd p')
      await shared.waitPrompt()
    })
  })

  describe('list commands', () => {
    it('should not quit list with --no-quit', async t => {
      let list: IList = {
        name: 'test',
        actions: [{
          name: 'open', execute: _item => {
            // noop
          }
        }],
        defaultAction: 'open',
        loadItems: () => Promise.resolve([{ label: 'foo' }, { label: 'bar' }]),
        resolveItem: item => {
          item.label = item.label.slice(0, 1)
          return Promise.resolve(item)
        }
      }
      global.__TEST__ = false
      let disposable = manager.registerList(list)
      global.__TEST__ = true
      await manager.start(['--normal', '--no-quit', 'test'])
      await manager.session.ui.ready
      let id = await nvim.eval('win_getid()') as number
      await manager.doAction()
      disposable.dispose()
      let wins = await nvim.windows
      let ids = wins.map(o => o.id)
      assert.ok(ids.includes(id))
    })

    it('should do default action for first item', async t => {
      assert.notStrictEqual(ListManager, undefined)
      await manager.start(['--normal', '--first', 'location'])
      let filename = path.basename(import.meta.filename)
      await shared.waitValue(async () => {
        let name = await nvim.eval('bufname("%")') as string
        return name.includes(filename)
      }, true)
      let pos = await nvim.eval('getcurpos()')
      assert.strictEqual(pos[1], 1)
      assert.strictEqual(pos[2], 2)
    })

    it('should goto next & previous', async t => {
      await manager.start(['location'])
      await manager.session?.ui.ready
      await shared.waitPrompt()
      await manager.session?.ui.ready
      await manager.doAction()
      await shared.doAction('listCancel')
      let bufname = await nvim.eval('expand("%:p")') as string
      assert.match(bufname, new RegExp('manager\\.test\\.(?:js|ts)'))
      await shared.doAction('listNext')
      let line = await nvim.call('line', '.')
      assert.strictEqual(line, 2)
      await shared.doAction('listPrev')
      line = await nvim.call('line', '.')
      assert.strictEqual(line, 1)
    })

    it('should parse arguments', async t => {
      await manager.start(['--input=test', '--reverse', '--normal', '--no-sort', '--ignore-case', '--top', '--number-select', '--auto-preview', '--strict', 'location'])
      await manager.session?.ui.ready
      let opts = manager.session?.listOptions
      assert.deepStrictEqual(opts, {
        reverse: true,
        numberSelect: true,
        autoPreview: true,
        first: false,
        height: undefined,
        input: 'test',
        interactive: false,
        matcher: 'strict',
        ignorecase: true,
        position: 'top',
        mode: 'normal',
        noQuit: false,
        sort: false
      })
    })
  })

  describe('list configuration', () => {
    it('should change indicator', async t => {
      shared.updateConfiguration('list.indicator', '>>')
      manager.prompt.input = 'foo'
      await manager.start(['location'])
      await manager.session.ui.ready
      await shared.waitValue(async () => {
        let line = await shared.getCmdline()
        return line.includes('>>')
      }, true)
      await events.fire('FocusGained', [])
    })

    it('should split right for preview window', async t => {
      shared.updateConfiguration('list.previewSplitRight', true)
      await manager.doAction('preview')
      await manager.resume()
      let win = await nvim.window
      await manager.start(['location'])
      await manager.session?.ui.ready
      await manager.doAction('preview')
      await shared.waitValue(async () => {
        let wins = await nvim.windows
        return wins.length
      }, 3)
      manager.prompt.cancel()
      await nvim.call('win_gotoid', [win.id])
      await nvim.command('wincmd l')
      let curr = await nvim.window
      let isPreview = await curr.getVar('previewwindow')
      assert.strictEqual(isPreview, 1)
    })

    it('should use smartcase for strict match', async t => {
      shared.updateConfiguration('list.smartCase', true)
      await manager.start(['--input=Man', '--strict', 'location'])
      await manager.session?.ui.ready
      let items = await manager.session?.ui.getItems()
      assert.strictEqual(items.length, 0)
    })

    it('should use smartcase for fuzzy match', async t => {
      shared.updateConfiguration('list.smartCase', true)
      await manager.start(['--input=Man', 'location'])
      await manager.session?.ui.ready
      let items = await manager.session?.ui.getItems()
      assert.strictEqual(items.length, 0)
    })

    it('should toggle selection mode', async t => {
      await manager.start(['--normal', 'location'])
      await manager.session?.ui.ready
      await shared.waitPrompt()
      await window.selectRange(Range.create(0, 0, 3, 0))
      await manager.session?.ui.toggleSelection()
      let items = await manager.session?.ui.getItems()
      assert.ok(items.length > 0)
    })

    it('should change next and previous keymap', async t => {
      shared.updateConfiguration('list.nextKeymap', '<tab>')
      shared.updateConfiguration('list.previousKeymap', '<s-tab>')
      await manager.start(['location'])
      await manager.session.ui.ready
      await shared.waitPrompt()
      await nvim.eval('feedkeys("\\<tab>", "in")')
      await shared.waitValue(async () => {
        let line = await nvim.line
        return line.includes('Bar')
      }, true)
      await nvim.eval('feedkeys("\\<s-tab>", "in")')
      await shared.waitValue(async () => {
        let line = await nvim.line
        return line.includes('foo')
      }, true)
    })

    it('should respect mouse events', async t => {
      async function setMouseEvent(line: number): Promise<void> {
        let winid = manager.session?.ui.winid
        await nvim.command(`let v:mouse_winid = ${winid}`)
        await nvim.command(`let v:mouse_lnum = ${line}`)
        await nvim.command(`let v:mouse_col = 1`)
      }
      await manager.start(['--normal', 'location'])
      await manager.session.ui.ready
      await setMouseEvent(1)
      await manager.onNormalInput('<LeftMouse>')
      await setMouseEvent(2)
      await manager.onNormalInput('<LeftDrag>')
      await setMouseEvent(3)
      await manager.onNormalInput('<LeftRelease>')
      await shared.waitValue(async () => {
        let items = await manager.session?.ui.getItems()
        return items.length
      }, 3)
    })

    it('should toggle preview', async t => {
      shared.updateConfiguration('list.floatPreview', true)
      await manager.start(['--normal', '--auto-preview', 'location'])
      await manager.session.ui.ready
      await shared.waitValue(async () => {
        let wins = await getFloats()
        return wins.length > 0
      }, true)
      await manager.togglePreview()
      await shared.waitValue(async () => {
        let wins = await getFloats()
        return wins.length > 0
      }, false)
      await manager.togglePreview()
      manager.session.ui.setCursor(2)
      await shared.waitValue(async () => {
        let wins = await getFloats()
        return wins.length > 0
      }, true)
    })

    it('should show help of current list', async t => {
      await manager.start(['--normal', '--auto-preview', 'location'])
      await manager.session.ui.ready
      await manager.session?.showHelp()
      let bufname = await nvim.call('bufname', '%')
      assert.strictEqual(bufname, '[LIST HELP]')
    })

    it('should resolve list item', async t => {
      let list: IList = {
        name: 'test',
        actions: [{
          name: 'open', execute: _item => {
            // noop
          }
        }],
        defaultAction: 'open',
        loadItems: () => Promise.resolve([{ label: 'foo' }, { label: 'foo bar' }]),
        resolveItem: item => {
          item.label = 'foo bar'
          return Promise.resolve(item)
        }
      }
      let disposable = manager.registerList(list, true)
      await manager.start(['--normal', 'test'])
      await manager.session.ui.ready
      await shared.waitFor('getline', ['.'], 'foo bar')
      await manager.session.next()
      await manager.session.resolveItem()
      disposable.dispose()
    })
  })

  describe('descriptions', () => {
    it('should get descriptions', async t => {
      let res = await shared.doAction('listDescriptions')
      assert.notStrictEqual(res, undefined)
      assert.notStrictEqual(res.location, undefined)
    })
  })

  describe('switchMatcher()', () => {
    it('should switch matcher', async t => {
      await manager.switchMatcher()
      await manager.start(['--normal', 'location'])
      manager.session.onInputChange()
      await manager.session.ui.ready
      const assertMatcher = (value: string) => {
        assert.strictEqual(manager.session.listOptions.matcher, value)
      }
      await manager.switchMatcher()
      assertMatcher('strict')
      await manager.switchMatcher()
      assertMatcher('regex')
      await manager.switchMatcher()
      assertMatcher('fuzzy')
      await manager.switchMatcher()
      assertMatcher('strict')
      manager.session.listOptions.interactive = true
      await manager.switchMatcher()
      assertMatcher('strict')
      await manager.cancel(true)
    })
  })

  describe('loadItems()', () => {
    it('should ignore cancellation error', async t => {
      let list: IList = {
        name: 'cancel',
        actions: [{ name: 'open', execute: () => {} }],
        defaultAction: 'open',
        loadItems: () => Promise.reject(new CancellationError()),
      }
      let disposable = manager.registerList(list)
      await manager.start(['cancel'])
      disposable.dispose()
      let line = await shared.getCmdline()
      assert.strictEqual(line, '')
    })

    it('should load items for list', async t => {
      let res = await manager.loadItems('location')
      assert.ok(res.length > 0)
      Object.assign(manager, { lastSession: undefined })
      manager.toggleMode()
      manager.stop()
      res = await shared.doAction('listLoadItems', '')
      assert.strictEqual(res, undefined)
      let error = true
      manager.registerList({
        name: 'emitter',
        actions: [],
        defaultAction: '',
        loadItems: () => {
          let emitter: any = new EventEmitter()
          let interval
          let timeout
          emitter.dispose = () => {
            emitter.removeAllListeners()
            clearInterval(interval)
            clearTimeout(timeout)
          }
          if (error) {
            timeout = setTimeout(() => {
              emitter.emit('error', new Error('error'))
              emitter.emit('end')
            }, 2)
          } else {
            timeout = setTimeout(() => {
              emitter.emit('data', { label: 'foo' })
              emitter.emit('end')
            }, 2)
          }
          interval = setInterval(() => {
            emitter.emit('data', { label: 'bar' })
            emitter.emit('error', new Error('error'))
          }, 10)
          return emitter
        }
      })
      await assert.rejects(manager.loadItems('emitter'), Error)
      error = false
      res = await manager.loadItems('emitter')
      assert.strictEqual(res.length, 1)
      await shared.wait(50)
    })
  })

  describe('onInsertInput()', () => {
    it('should handle insert input', async t => {
      await manager.onInsertInput('k')
      await manager.onInsertInput('<LeftMouse>')
      await manager.start(['--number-select', 'location'])
      await manager.session.ui.ready
      await manager.onInsertInput('1')
      await manager.onInsertInput(String.fromCharCode(129))
      let basename = path.basename(import.meta.filename)
      await shared.waitValue(async () => {
        let bufname = await nvim.call('bufname', ['%']) as string
        return bufname.includes(basename)
      }, true)
    })

    it('should ignore invalid input', async t => {
      await manager.start(['location'])
      await manager.session.ui.ready
      await manager.onInsertInput('<X-y>')
      await manager.onInsertInput(String.fromCharCode(65533))
      await manager.onInsertInput(String.fromCharCode(30))
      assert.strictEqual(manager.isActivated, true)
    })

    it('should ignore <plug> insert', async t => {
      await manager.start(['location'])
      await manager.session.ui.ready
      await shared.listInput('<plug>')
      await shared.listInput('x')
      assert.strictEqual(manager.isActivated, true)
    })

    it('reports interactive reload errors and keeps the worker usable', async t => {
      let calls = 0
      let list: IList = {
        name: 'interactiveError',
        interactive: true,
        actions: [],
        defaultAction: 'open',
        loadItems: () => {
          calls++
          if (calls === 1) return Promise.resolve([{ label: 'foo' }])
          return Promise.reject(new Error('reload boom'))
        }
      }
      let disposable = manager.registerList(list, true)
      let unhandled: Error[] = []
      let onUnhandled = (e: Error): void => {
        unhandled.push(e)
      }
      process.on('unhandledRejection', onUnhandled)
      let showError = t.mock.method(window, 'showErrorMessage', () => Promise.resolve(undefined as any))
      try {
        await manager.start(['--interactive', 'interactiveError'])
        await manager.session.ui.ready
        assert.strictEqual(manager.session.worker.isLoading, false)
        manager.prompt.input = 'x'
        manager.session.onInputChange()
        await shared.waitValue(() => calls, 2)
        await shared.waitValue(() => manager.session.worker.isLoading, false)
        assert.ok(showError.mock.callCount() > 0)
        assert.ok(String(showError.mock.calls[0].arguments[0]).includes('reload boom'))
        // a later input change still triggers a fresh reload
        manager.prompt.input = 'y'
        manager.session.onInputChange()
        await shared.waitValue(() => calls, 3)
        await shared.waitValue(() => manager.session.worker.isLoading, false)
        assert.strictEqual(manager.session.worker.isLoading, false)
      } finally {
        process.off('unhandledRejection', onUnhandled)
        disposable.dispose()
        await manager.cancel(true)
      }
      assert.deepStrictEqual(unhandled, [])
    })
  })

  describe('parseArgs()', () => {
    it('should show error for bad option', async t => {
      manager.parseArgs(['$x', 'location'])
      await waitCmdline('Invalid list option')
      manager.parseArgs(['-xyz', 'location'])
      await waitCmdline('Invalid option')
    })

    it('should parse valid arguments', async t => {
      let res = manager.parseArgs([])
      assert.strictEqual(res.list.name, 'lists')
      res = manager.parseArgs(['lists', '-foo'])
      assert.deepStrictEqual(res.listArgs, ['-foo'])
    })

    it('should show error for interactive with list not support interactive', async t => {
      manager.parseArgs(['--interactive', 'location'])
      await waitCmdline('not supported')
    })
  })

  describe('resume()', () => {
    it('should resume by name', async t => {
      await events.fire('FocusGained', [])
      await manager.start(['location'])
      await manager.session.ui.ready
      await manager.session.hide()
      await manager.resume('location')
      await shared.doAction('listResume')
      assert.strictEqual(manager.isActivated, true)
      await manager.resume('not_exists')
      await waitCmdline('Can\'t find')
    })
  })

  describe('triggerCursorMoved()', () => {
    it('should triggerCursorMoved autocmd', async t => {
      let called = 0
      let disposable = events.on('CursorMoved', () => {
        called++
      })
      Object.assign(events, { _cursor: undefined })
      Object.assign(nvim, { isVim: true })
      manager.triggerCursorMoved()
      manager.triggerCursorMoved()
      Object.assign(nvim, { isVim: false })
      await shared.waitValue(() => {
        return called
      }, 1)
      disposable.dispose()
    })
  })

  describe('first(), last()', () => {
    it('should get session by name', async t => {
      let last: string
      let list: IList = {
        name: 'test',
        actions: [{
          name: 'open',
          execute: item => {
            last = toArray(item)[0].label
          }
        }],
        defaultAction: 'open',
        loadItems: () => Promise.resolve([{ label: 'foo' }, { label: 'bar' }])
      }
      manager.registerList(list, true)
      await manager.start(['test'])
      await manager.session.ui.ready
      await shared.doAction('listFirst', 'a')
      await shared.doAction('listLast', 'a')
      await manager.first('test')
      assert.strictEqual(last, 'foo')
      await manager.last('test')
      assert.strictEqual(last, 'bar')
    })
  })

  describe('registerList()', () => {
    it('should recreate list', async t => {
      let fn = t.mock.fn()
      let list: IList = {
        name: 'test',
        actions: [{
          name: 'open', execute: _item => {
            // noop
          }
        }],
        defaultAction: 'open',
        loadItems: () => Promise.resolve([{ label: 'foo' }, { label: 'bar' }]),
        dispose: () => {
          fn()
        }
      }
      manager.registerList(list, true)
      shared.updateConfiguration('list.source.test.defaultAction', 'open')
      let disposable = manager.registerList(list, true)
      disposable.dispose()
      assert.ok(fn.mock.callCount() > 0)
    })
  })

  describe('start()', () => {
    it('should show error when loadItems throws', async t => {
      let list: IList = {
        name: 'test',
        actions: [{
          name: 'open',
          execute: _item => {
          }
        }],
        defaultAction: 'open',
        loadItems: () => {
          throw new Error('test error')
        }
      }
      manager.registerList(list, true)
      await manager.start(['test'])
      await shared.wait(20)
    })
  })

  describe('list options', () => {
    it('should respect auto preview option', async t => {
      await manager.start(['--auto-preview', 'location'])
      await manager.session.ui.ready
      await shared.waitFor('winnr', ['$'], 3)
      let previewWinnr = await nvim.call('coc#list#has_preview')
      assert.strictEqual(previewWinnr, 2)
      let bufnr = await nvim.call('winbufnr', previewWinnr) as number
      let buf = nvim.createBuffer(bufnr)
      let name = await buf.name
      assert.match(name, new RegExp('manager\\.test\\.(?:js|ts)'))
      await nvim.eval('feedkeys("j", "in")')
      await shared.wait(30)
      let winnr = await nvim.call('coc#list#has_preview')
      assert.strictEqual(winnr, previewWinnr)
    })

    it('should respect input option', async t => {
      await manager.start(['--input=foo', 'location'])
      await manager.session.ui.ready
      await waitCmdline('foo')
      assert.strictEqual(manager.isActivated, true)
    })

    it('should respect regex filter', async t => {
      await manager.start(['--input=f.o', '--regex', 'location'])
      await manager.session.ui.ready
      let item = await manager.session?.ui.item
      assert.match(item.label, new RegExp('foo'))
      await manager.session.hide()
      await manager.start(['--input=f.o', '--ignore-case', '--regex', 'location'])
      await manager.session.ui.ready
      item = await manager.session?.ui.item
      assert.match(item.label, new RegExp('foo'))
    })

    it('should respect normal option', async t => {
      await manager.start(['--normal', 'location'])
      await manager.session.ui.ready
      let line = await shared.getCmdline()
      assert.strictEqual(line, '')
    })

    it('should respect nosort option', async t => {
      await manager.start(['--ignore-case', '--no-sort', 'location'])
      await manager.session.ui.ready
      await nvim.input('oo')
      await shared.waitValue(async () => {
        let line = await nvim.call('getline', ['.']) as string
        return line.includes('foo')
      }, true)
    })

    it('should respect ignorecase option', async t => {
      await manager.start(['--ignore-case', '--strict', 'location'])
      await manager.session.ui.ready
      assert.strictEqual(manager.isActivated, true)
      await nvim.input('bar')
      await shared.waitValue(() => {
        return manager.session?.ui.length
      }, 1)
      let line = await nvim.line
      assert.match(line, new RegExp('Bar'))
    })

    it('should respect top & height option', async t => {
      await manager.start(['--top', '--height=2', 'location'])
      await manager.session.ui.ready
      let nr = await nvim.call('winnr')
      assert.strictEqual(nr, 1)
      let win = await nvim.window
      let height = await win.height
      assert.strictEqual(height, 2)
    })

    it('should respect number select option', async t => {
      await manager.start(['--number-select', 'location'])
      await manager.session.ui.ready
      await shared.waitValue(() => manager.session.ui.winid != null, true)
      await nvim.eval('feedkeys("2", "in")')
      let lnum = locations[1].lnum
      await shared.waitFor('line', ['.'], lnum)
    })

    it('should respect tab option', async t => {
      await manager.start(['--tab', '--auto-preview', 'location'])
      await manager.session.ui.ready
      await shared.waitFor('tabpagenr', ['$'], 2)
    })
  })
})
