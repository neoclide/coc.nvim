import { Neovim } from '@chemzqm/neovim'
import { ListContext, ListTask } from '../../types'
import manager from '../../list/manager'
import helper from '../helper'
import BasicList from '../../list/basic'

class FilesList extends BasicList {
  public name = 'files'
  public loadItems(_context: ListContext): Promise<ListTask> {
    return Promise.resolve(this.createCommandTask({
      cmd: 'ls',
      args: [],
      cwd: __dirname,
      onLine: line => {
        return {
          label: line
        }
      }
    }))
  }
}

class SleepList extends BasicList {
  public name = 'sleep'
  public loadItems(_context: ListContext): Promise<ListTask> {
    return Promise.resolve(this.createCommandTask({
      cmd: 'sleep',
      args: ['10'],
      cwd: __dirname,
      onLine: line => {
        return {
          label: line
        }
      }
    }))
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
  manager.reset()
  await helper.reset()
  await helper.wait(100)
})

describe('Command task', () => {
  it('should create command task', async () => {
    let list = new FilesList(nvim)
    let disposable = manager.registerList(list)
    await manager.start(['files'])
    await helper.wait(800)
    let lines = await nvim.call('getline', [1, '$']) as string[]
    expect(lines.includes('commandTask.test.ts')).toBe(true)
    disposable.dispose()
  })

  it('should stop command task', async () => {
    let list = new SleepList(nvim)
    let disposable = manager.registerList(list)
    await manager.start(['sleep'])
    manager.session.stop()
    disposable.dispose()
  })
})
