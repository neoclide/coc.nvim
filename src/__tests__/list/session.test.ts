import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import BasicList from '../../list/basic'
import manager from '../../list/manager'
import ListSession from '../../list/session'
import Prompt from '../../list/prompt'
import { ListItem, IList } from '../../list/types'
import { disposeAll } from '../../util'
import helper from '../helper'

let labels: string[] = []
let lastItem: string
let lastItems: ListItem[]

class SimpleList extends BasicList {
  public name = 'simple'
  public detail = 'detail'
  public options = [{
    name: 'foo',
    description: 'foo'
  }]
  constructor() {
    super()
    this.addAction('open', item => {
      lastItem = item.label
    }, { tabPersist: true })
    this.addMultipleAction('multiple', items => {
      lastItems = items
    })
    this.addAction('parallel', async () => {
      await helper.wait(100)
    }, { parallel: true })
    this.addAction('reload', item => {
      lastItem = item.label
    }, { persist: true, reload: true })
  }
  public loadItems(): Promise<ListItem[]> {
    return Promise.resolve(labels.map(s => {
      return { label: s } as ListItem
    }))
  }
}

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
  manager.reset()
  await helper.reset()
})

describe('list session', () => {
  describe('doDefaultAction()', () => {
    it('should throw error when default action does not exist', async () => {
      labels = ['a', 'b', 'c']
      let list = new SimpleList()
      list.defaultAction = 'foo'
      let len = list.actions.length
      list.actions.splice(0, len)
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      let err
      try {
        await manager.session.first()
      } catch (e) {
        err = e
      }
      expect(err).toBeDefined()
      err = null
      try {
        await manager.session.last()
      } catch (e) {
        err = e
      }
      expect(err).toBeDefined()
    })
  })

  describe('doItemAction()', () => {
    it('should invoke multiple action', async () => {
      labels = ['a', 'b', 'c']
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      await ui.selectAll()
      await manager.doAction('multiple')
      expect(lastItems.length).toBe(3)
      lastItems = undefined
      await manager.session.doPreview(0)
      await manager.doAction('not_exists')
      let line = await helper.getCmdline()
      expect(line).toMatch('not found')
    })

    it('should invoke parallel action', async () => {
      labels = ['a', 'b', 'c']
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      await ui.selectAll()
      let d = Date.now()
      await manager.doAction('parallel')
      expect(Date.now() - d).toBeLessThan(300)
    })

    it('should support tabPersist action', async () => {
      labels = ['a', 'b', 'c']
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', '--tab', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      await manager.doAction('open')
      let tabnr = await nvim.call('tabpagenr')
      expect(tabnr).toBeGreaterThan(1)
      let win = nvim.createWindow(ui.winid)
      let valid = await win.valid
      expect(valid).toBe(true)
    })

    it('should invoke reload action', async () => {
      labels = ['a', 'b', 'c']
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      labels = ['d', 'e']
      await manager.doAction('reload')
      await helper.wait(50)
      let buf = await nvim.buffer
      let lines = await buf.lines
      expect(lines).toEqual(['d', 'e'])
    })
  })

  describe('reloadItems()', () => {
    it('should not reload items when window is hidden', async () => {
      let fn = jest.fn()
      let list: IList = {
        name: 'reload',
        defaultAction: 'open',
        actions: [{
          name: 'open',
          execute: () => {}
        }],
        loadItems: () => {
          fn()
          return Promise.resolve([])
        }
      }
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', 'reload'])
      let ui = manager.session.ui
      await ui.ready
      await manager.cancel(true)
      let ses = manager.getSession('reload')
      await ses.reloadItems()
      expect(fn).toBeCalledTimes(1)
    })
  })

  describe('resume()', () => {
    it('should do preview on resume', async () => {
      labels = ['a', 'b', 'c']
      let lastItem
      let list = new SimpleList()
      list.actions.push({
        name: 'preview',
        execute: item => {
          lastItem = item
        }
      })
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', '--auto-preview', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      await ui.selectLines(1, 2)
      await helper.wait(50)
      await nvim.call('coc#window#close', [ui.winid])
      await helper.wait(100)
      await manager.session.resume()
      await helper.wait(100)
      expect(lastItem).toBeDefined()
    })
  })

  describe('jumpBack()', () => {
    it('should jump back', async () => {
      let win = await nvim.window
      labels = ['a', 'b', 'c']
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      manager.session.jumpBack()
      await helper.wait(50)
      let winid = await nvim.call('win_getid')
      expect(winid).toBe(win.id)
    })
  })

  describe('hide()', () => {
    it('should not throw when window undefined', async () => {
      let session = new ListSession(nvim, new Prompt(nvim), new SimpleList(), {
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
      }, [])
      await expect(async () => {
        await session.call('fn_not_exists')
      }).rejects.toThrow(Error)
      await session.doPreview(0)
      await session.first()
      await session.hide(false, true)
      let worker: any = session.worker
      worker._onDidChangeItems.fire({ items: [] })
      worker._onDidChangeLoading.fire(false)
    })
  })

  describe('doNumberSelect()', () => {
    async function create(len: number): Promise<ListSession> {
      labels = []
      for (let i = 0; i < len; i++) {
        let code = 'a'.charCodeAt(0) + i
        labels.push(String.fromCharCode(code))
      }
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', '--number-select', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      return manager.session
    }

    it('should return false for invalid number', async () => {
      let session = await create(5)
      let res = await session.doNumberSelect('a')
      expect(res).toBe(false)
      res = await session.doNumberSelect('8')
      expect(res).toBe(false)
    })

    it('should consider 0 as 10', async () => {
      let session = await create(15)
      let res = await session.doNumberSelect('0')
      expect(res).toBe(true)
      expect(lastItem).toBe('j')
    })
  })
})

describe('showHelp()', () => {
  it('should show description and options in help', async () => {
    labels = ['a', 'b', 'c']
    let list = new SimpleList()
    disposables.push(manager.registerList(list))
    await manager.start(['--normal', 'simple'])
    let ui = manager.session.ui
    await ui.ready
    await manager.session.showHelp()
    let lines = await nvim.call('getline', [1, '$']) as string[]
    expect(lines.indexOf('DESCRIPTION')).toBeGreaterThan(0)
    expect(lines.indexOf('ARGUMENTS')).toBeGreaterThan(0)
  })
})

describe('chooseAction()', () => {
  it('should filter actions not have shortcuts', async () => {
    labels = ['a', 'b', 'c']
    let fn = jest.fn()
    let list = new SimpleList()
    list.actions.push({
      name: 'a',
      execute: () => {
        fn()
      }
    })
    list.actions.push({
      name: 'b',
      execute: () => {
      }
    })
    list.actions.push({
      name: 'ab',
      execute: () => {
      }
    })
    disposables.push(manager.registerList(list))
    await manager.start(['--normal', 'simple'])
    await manager.session.ui.ready
    let p = manager.session.chooseAction()
    await helper.wait(50)
    await nvim.input('a')
    await p
    expect(fn).toBeCalled()
  })

  it('should choose action by menu picker', async () => {
    helper.updateConfiguration('list.menuAction', true)
    labels = ['a', 'b', 'c']
    let fn = jest.fn()
    let list = new SimpleList()
    let len = list.actions.length
    list.actions.splice(0, len)
    list.actions.push({
      name: 'a',
      execute: () => {
        fn()
      }
    })
    list.actions.push({
      name: 'b',
      execute: () => {
        fn()
      }
    })
    disposables.push(manager.registerList(list))
    await manager.start(['--normal', 'simple'])
    await manager.session.ui.ready
    let p = manager.session.chooseAction()
    await helper.waitPrompt()
    await nvim.input('<cr>')
    await p
  })
})
