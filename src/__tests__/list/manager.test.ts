import { Neovim, Window } from '@chemzqm/neovim'
import EventEmitter from 'events'
import path from 'path'
import { Range } from 'vscode-languageserver-types'
import events from '../../events'
import manager, { createConfigurationNode, ListManager } from '../../list/manager'
import { IList } from '../../list/types'
import { QuickfixItem } from '../../types'
import { toArray } from '../../util/array'
import { CancellationError } from '../../util/errors'
import window from '../../window'
import helper from '../helper'

let nvim: Neovim
const locations: ReadonlyArray<QuickfixItem> = [{
  filename: __filename,
  col: 2,
  lnum: 1,
  text: 'foo'
}, {
  filename: __filename,
  col: 1,
  lnum: 2,
  text: 'Bar'
}, {
  filename: __filename,
  col: 1,
  lnum: 3,
  text: 'option'
}]

async function getFloats(): Promise<Window[]> {
  let ids = await nvim.call('coc#float#get_float_win_list', []) as number[]
  if (!ids) return []
  return ids.map(id => nvim.createWindow(id))
}

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  await nvim.setVar('coc_jump_locations', locations)
})

afterEach(async () => {
  manager.reset()
  await helper.reset()
})

afterAll(async () => {
  await helper.shutdown()
})

describe('list', () => {
  describe('createConfigurationNode', () => {
    it('should createConfigurationNode', async () => {
      expect(createConfigurationNode('foo', true)).toBeDefined()
      expect(createConfigurationNode('bar', false)).toBeDefined()
      expect(createConfigurationNode('foo', false, 'id')).toBeDefined()
    })
  })

  describe('events', () => {
    it('should cancel and enable prompt', async () => {
      let winid = await nvim.call('win_getid')
      await manager.start(['location'])
      await manager.session.ui.ready
      await nvim.call('win_gotoid', [winid])
      await helper.waitValue(async () => {
        return await nvim.call('coc#prompt#activated')
      }, 0)
      await nvim.command('wincmd p')
      await helper.waitPrompt()
    })
  })

  describe('list commands', () => {
    it('should not quit list with --no-quit', async () => {
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
      expect(ids).toContain(id)
    })

    it('should do default action for first item', async () => {
      expect(ListManager).toBeDefined()
      await manager.start(['--normal', '--first', 'location'])
      let filename = path.basename(__filename)
      await helper.waitValue(async () => {
        let name = await nvim.eval('bufname("%")') as string
        return name.includes(filename)
      }, true)
      let pos = await nvim.eval('getcurpos()')
      expect(pos[1]).toBe(1)
      expect(pos[2]).toBe(2)
    })

    it('should goto next & previous', async () => {
      await manager.start(['location'])
      await manager.session?.ui.ready
      await helper.waitPrompt()
      await manager.session?.ui.ready
      await manager.doAction()
      await helper.doAction('listCancel')
      let bufname = await nvim.eval('expand("%:p")')
      expect(bufname).toMatch('manager.test.ts')
      await helper.doAction('listNext')
      let line = await nvim.call('line', '.')
      expect(line).toBe(2)
      await helper.doAction('listPrev')
      line = await nvim.call('line', '.')
      expect(line).toBe(1)
    })

    it('should parse arguments', async () => {
      await manager.start(['--input=test', '--reverse', '--normal', '--no-sort', '--ignore-case', '--top', '--number-select', '--auto-preview', '--strict', 'location'])
      await manager.session?.ui.ready
      let opts = manager.session?.listOptions
      expect(opts).toEqual({
        reverse: true,
        numberSelect: true,
        autoPreview: true,
        first: false,
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
    it('should change indicator', async () => {
      helper.updateConfiguration('list.indicator', '>>')
      manager.prompt.input = 'foo'
      await manager.start(['location'])
      await manager.session.ui.ready
      await helper.waitValue(async () => {
        let line = await helper.getCmdline()
        return line.includes('>>')
      }, true)
      await events.fire('FocusGained', [])
    })

    it('should split right for preview window', async () => {
      helper.updateConfiguration('list.previewSplitRight', true)
      await manager.doAction('preview')
      await manager.resume()
      let win = await nvim.window
      await manager.start(['location'])
      await manager.session?.ui.ready
      await manager.doAction('preview')
      await helper.waitValue(async () => {
        let wins = await nvim.windows
        return wins.length
      }, 3)
      manager.prompt.cancel()
      await nvim.call('win_gotoid', [win.id])
      await nvim.command('wincmd l')
      let curr = await nvim.window
      let isPreview = await curr.getVar('previewwindow')
      expect(isPreview).toBe(1)
    })

    it('should use smartcase for strict match', async () => {
      helper.updateConfiguration('list.smartCase', true)
      await manager.start(['--input=Man', '--strict', 'location'])
      await manager.session?.ui.ready
      let items = await manager.session?.ui.getItems()
      expect(items.length).toBe(0)
    })

    it('should use smartcase for fuzzy match', async () => {
      helper.updateConfiguration('list.smartCase', true)
      await manager.start(['--input=Man', 'location'])
      await manager.session?.ui.ready
      let items = await manager.session?.ui.getItems()
      expect(items.length).toBe(0)
    })

    it('should toggle selection mode', async () => {
      await manager.start(['--normal', 'location'])
      await manager.session?.ui.ready
      await helper.waitPrompt()
      await window.selectRange(Range.create(0, 0, 3, 0))
      await manager.session?.ui.toggleSelection()
      let items = await manager.session?.ui.getItems()
      expect(items.length).toBeGreaterThan(0)
    })

    it('should change next and previous keymap', async () => {
      helper.updateConfiguration('list.nextKeymap', '<tab>')
      helper.updateConfiguration('list.previousKeymap', '<s-tab>')
      await manager.start(['location'])
      await manager.session.ui.ready
      await helper.waitPrompt()
      await nvim.eval('feedkeys("\\<tab>", "in")')
      await helper.waitValue(async () => {
        let line = await nvim.line
        return line.includes('Bar')
      }, true)
      await nvim.eval('feedkeys("\\<s-tab>", "in")')
      await helper.waitValue(async () => {
        let line = await nvim.line
        return line.includes('foo')
      }, true)
    })

    it('should respect mouse events', async () => {
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
      await helper.waitValue(async () => {
        let items = await manager.session?.ui.getItems()
        return items.length
      }, 3)
    })

    it('should toggle preview', async () => {
      helper.updateConfiguration('list.floatPreview', true)
      await manager.start(['--normal', '--auto-preview', 'location'])
      await manager.session.ui.ready
      await helper.waitValue(async () => {
        let wins = await getFloats()
        return wins.length > 0
      }, true)
      await manager.togglePreview()
      await helper.waitValue(async () => {
        let wins = await getFloats()
        return wins.length > 0
      }, false)
      await manager.togglePreview()
      manager.session.ui.setCursor(2)
      await helper.waitValue(async () => {
        let wins = await getFloats()
        return wins.length > 0
      }, true)
    })

    it('should show help of current list', async () => {
      await manager.start(['--normal', '--auto-preview', 'location'])
      await manager.session.ui.ready
      await manager.session?.showHelp()
      let bufname = await nvim.call('bufname', '%')
      expect(bufname).toBe('[LIST HELP]')
    })

    it('should resolve list item', async () => {
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
      await helper.waitFor('getline', ['.'], 'foo bar')
      await manager.session.next()
      await manager.session.resolveItem()
      disposable.dispose()
    })
  })

  describe('descriptions', () => {
    it('should get descriptions', async () => {
      let res = await helper.doAction('listDescriptions')
      expect(res).toBeDefined()
      expect(res.location).toBeDefined()
    })
  })

  describe('switchMatcher()', () => {
    it('should switch matcher', async () => {
      await manager.switchMatcher()
      await manager.start(['--normal', 'location'])
      manager.session.onInputChange()
      await manager.session.ui.ready
      const assertMatcher = (value: string) => {
        expect(manager.session.listOptions.matcher).toBe(value)
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
    it('should ignore cancellation error', async () => {
      let list: IList = {
        name: 'cancel',
        actions: [{ name: 'open', execute: () => {} }],
        defaultAction: 'open',
        loadItems: () => Promise.reject(new CancellationError()),
      }
      let disposable = manager.registerList(list)
      await manager.start(['cancel'])
      disposable.dispose()
      let line = await helper.getCmdline()
      expect(line).toBe('')
    })

    it('should load items for list', async () => {
      let res = await manager.loadItems('location')
      expect(res.length).toBeGreaterThan(0)
      Object.assign(manager, { lastSession: undefined })
      manager.toggleMode()
      manager.stop()
      res = await helper.doAction('listLoadItems', '')
      expect(res).toBeUndefined()
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
      await expect(async () => {
        await manager.loadItems('emitter')
      }).rejects.toThrow(Error)
      error = false
      res = await manager.loadItems('emitter')
      expect(res.length).toBe(1)
      await helper.wait(50)
    })
  })

  describe('onInsertInput()', () => {
    it('should handle insert input', async () => {
      await manager.onInsertInput('k')
      await manager.onInsertInput('<LeftMouse>')
      await manager.start(['--number-select', 'location'])
      await manager.session.ui.ready
      await manager.onInsertInput('1')
      await manager.onInsertInput(String.fromCharCode(129))
      let basename = path.basename(__filename)
      await helper.waitValue(async () => {
        let bufname = await nvim.call('bufname', ['%']) as string
        return bufname.includes(basename)
      }, true)
    })

    it('should ignore invalid input', async () => {
      await manager.start(['location'])
      await manager.session.ui.ready
      await manager.onInsertInput('<X-y>')
      await manager.onInsertInput(String.fromCharCode(65533))
      await manager.onInsertInput(String.fromCharCode(30))
      expect(manager.isActivated).toBe(true)
    })

    it('should ignore <plug> insert', async () => {
      await manager.start(['location'])
      await manager.session.ui.ready
      await helper.listInput('<plug>')
      await helper.listInput('x')
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('parseArgs()', () => {
    it('should show error for bad option', async () => {
      manager.parseArgs(['$x', 'location'])
      await helper.wait(20)
      let msg = await helper.getCmdline()
      expect(msg).toMatch('Invalid list option')
      manager.parseArgs(['-xyz', 'location'])
      msg = await helper.getCmdline()
      expect(msg).toMatch('Invalid option')
    })

    it('should parse valid arguments', async () => {
      let res = manager.parseArgs([])
      expect(res.list.name).toBe('lists')
      res = manager.parseArgs(['lists', '-foo'])
      expect(res.listArgs).toEqual(['-foo'])
    })

    it('should show error for interactive with list not support interactive', async () => {
      manager.parseArgs(['--interactive', 'location'])
      let msg = await helper.getCmdline()
      expect(msg).toMatch('not supported')
    })
  })

  describe('resume()', () => {
    it('should resume by name', async () => {
      await events.fire('FocusGained', [])
      await manager.start(['location'])
      await manager.session.ui.ready
      await manager.session.hide()
      await manager.resume('location')
      await helper.doAction('listResume')
      expect(manager.isActivated).toBe(true)
      await manager.resume('not_exists')
      let line = await helper.getCmdline()
      expect(line).toMatch('Can\'t find')
    })
  })

  describe('triggerCursorMoved()', () => {
    it('should triggerCursorMoved autocmd', async () => {
      let called = 0
      let disposable = events.on('CursorMoved', () => {
        called++
      })
      Object.assign(events, { _cursor: undefined })
      Object.assign(nvim, { isVim: true })
      manager.triggerCursorMoved()
      manager.triggerCursorMoved()
      Object.assign(nvim, { isVim: false })
      await helper.waitValue(() => {
        return called
      }, 1)
      disposable.dispose()
    })
  })

  describe('first(), last()', () => {
    it('should get session by name', async () => {
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
      await helper.doAction('listFirst', 'a')
      await helper.doAction('listLast', 'a')
      await manager.first('test')
      expect(last).toBe('foo')
      await manager.last('test')
      expect(last).toBe('bar')
    })
  })

  describe('registerList()', () => {
    it('should recreate list', async () => {
      let fn = jest.fn()
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
      helper.updateConfiguration('list.source.test.defaultAction', 'open')
      let disposable = manager.registerList(list, true)
      disposable.dispose()
      expect(fn).toBeCalled()
    })
  })

  describe('start()', () => {
    it('should show error when loadItems throws', async () => {
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
      await helper.wait(20)
    })
  })

  describe('list options', () => {
    it('should respect auto preview option', async () => {
      await manager.start(['--auto-preview', 'location'])
      await manager.session.ui.ready
      await helper.waitFor('winnr', ['$'], 3)
      let previewWinnr = await nvim.call('coc#list#has_preview')
      expect(previewWinnr).toBe(2)
      let bufnr = await nvim.call('winbufnr', previewWinnr) as number
      let buf = nvim.createBuffer(bufnr)
      let name = await buf.name
      expect(name).toMatch('manager.test.ts')
      await nvim.eval('feedkeys("j", "in")')
      await helper.wait(30)
      let winnr = await nvim.call('coc#list#has_preview')
      expect(winnr).toBe(previewWinnr)
    })

    it('should respect input option', async () => {
      await manager.start(['--input=foo', 'location'])
      await manager.session.ui.ready
      let line = await helper.getCmdline()
      expect(line).toMatch('foo')
      expect(manager.isActivated).toBe(true)
    })

    it('should respect regex filter', async () => {
      await manager.start(['--input=f.o', '--regex', 'location'])
      await manager.session.ui.ready
      let item = await manager.session?.ui.item
      expect(item.label).toMatch('foo')
      await manager.session.hide()
      await manager.start(['--input=f.o', '--ignore-case', '--regex', 'location'])
      await manager.session.ui.ready
      item = await manager.session?.ui.item
      expect(item.label).toMatch('foo')
    })

    it('should respect normal option', async () => {
      await manager.start(['--normal', 'location'])
      await manager.session.ui.ready
      let line = await helper.getCmdline()
      expect(line).toBe('')
    })

    it('should respect nosort option', async () => {
      await manager.start(['--ignore-case', '--no-sort', 'location'])
      await manager.session.ui.ready
      await nvim.input('oo')
      await helper.waitValue(async () => {
        let line = await nvim.call('getline', ['.']) as string
        return line.includes('foo')
      }, true)
    })

    it('should respect ignorecase option', async () => {
      await manager.start(['--ignore-case', '--strict', 'location'])
      await manager.session.ui.ready
      expect(manager.isActivated).toBe(true)
      await nvim.input('bar')
      await helper.waitValue(() => {
        return manager.session?.ui.length
      }, 1)
      let line = await nvim.line
      expect(line).toMatch('Bar')
    })

    it('should respect top & height option', async () => {
      await manager.start(['--top', '--height=2', 'location'])
      await manager.session.ui.ready
      let nr = await nvim.call('winnr')
      expect(nr).toBe(1)
      let win = await nvim.window
      let height = await win.height
      expect(height).toBe(2)
    })

    it('should respect number select option', async () => {
      await manager.start(['--number-select', 'location'])
      await manager.session.ui.ready
      await nvim.eval('feedkeys("2", "in")')
      let lnum = locations[1].lnum
      await helper.waitFor('line', ['.'], lnum)
    })

    it('should respect tab option', async () => {
      await manager.start(['--tab', '--auto-preview', 'location'])
      await manager.session.ui.ready
      await helper.waitFor('tabpagenr', ['$'], 2)
    })
  })
})
