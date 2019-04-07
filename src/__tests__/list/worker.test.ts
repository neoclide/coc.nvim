import { Neovim } from '@chemzqm/neovim'
import manager from '../../list/manager'
import helper from '../helper'
import { BasicList, ListContext, ListTask, ListItem } from '../..'
import { CancellationToken } from 'vscode-languageserver-protocol'
import { EventEmitter } from 'events'
import colors from 'colors/safe'

class TaskList extends BasicList {
  public name = 'task'
  public timeout = 3000
  public loadItems(_context: ListContext, token: CancellationToken): Promise<ListTask> {
    let emitter: any = new EventEmitter()
    let i = 0
    let interval = setInterval(() => {
      emitter.emit('data', { label: i.toFixed() })
      i++
    }, 300)
    emitter.dispose = () => {
      clearInterval(interval)
      emitter.emit('end')
    }
    token.onCancellationRequested(() => {
      emitter.dispose()
    })
    return emitter
  }
}

class InteractiveList extends BasicList {
  public name = 'test'
  public interactive = true
  public loadItems(context: ListContext, _token: CancellationToken): Promise<ListItem[]> {
    return Promise.resolve([{
      label: colors.magenta(context.input || '')
    }])
  }
}

class ErrorList extends BasicList {
  public name = 'error'
  public interactive = true
  public loadItems(_context: ListContext, _token: CancellationToken): Promise<ListItem[]> {
    return Promise.reject(new Error('test error'))
  }
}

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await manager.cancel()
  await helper.reset()
})

describe('list worker', () => {

  it('should work with task', async () => {
    let disposable = manager.registerList(new TaskList(nvim))
    let p = manager.start(['task'])
    await helper.wait(1500)
    let len = manager.ui.length
    expect(len > 2).toBe(true)
    await manager.cancel()
    disposable.dispose()
    await p
  })

  it('should work with interactive list', async () => {
    let disposable = manager.registerList(new InteractiveList(nvim))
    await manager.start(['-I', 'test'])
    await manager.ui.ready
    expect(manager.ui.shown).toBe(true)
    await nvim.eval('feedkeys("f", "in")')
    await helper.wait(100)
    await nvim.eval('feedkeys("a", "in")')
    await helper.wait(100)
    await nvim.eval('feedkeys("x", "in")')
    await helper.wait(300)
    let item = await manager.ui.item
    expect(item.label).toBe('fax')
    disposable.dispose()
  })

  it('should not activate on load error', async () => {
    let disposable = manager.registerList(new ErrorList(nvim))
    await manager.start(['test'])
    expect(manager.isActivated).toBe(false)
    disposable.dispose()
  })
})
