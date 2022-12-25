import { Neovim } from '@chemzqm/neovim'
import styles from 'ansi-styles'
import { EventEmitter } from 'events'
import { CancellationToken, Disposable } from 'vscode-languageserver-protocol'
import BasicList from '../../list/basic'
import manager from '../../list/manager'
import { ListContext, ListItem, ListTask } from '../../list/types'
import { convertItemLabel, indexOf, parseInput, toInputs } from '../../list/worker'
import { disposeAll } from '../../util'
import helper from '../helper'

let items: ListItem[] = []

class DataList extends BasicList {
  public name = 'data'
  public loadItems(): Promise<ListItem[]> {
    return Promise.resolve(items)
  }
}

class EmptyList extends BasicList {
  public name = 'empty'
  public loadItems(): Promise<ListItem[]> {
    let emitter: any = new EventEmitter()
    setTimeout(() => {
      emitter.emit('end')
    }, 20)
    return emitter
  }
}

class IntervalTaskList extends BasicList {
  public name = 'task'
  public timeout = 3000
  public loadItems(_context: ListContext, token: CancellationToken): Promise<ListTask> {
    let emitter: any = new EventEmitter()
    let i = 0
    let interval = setInterval(() => {
      emitter.emit('data', { label: i.toFixed() })
      i++
    }, 20)
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

class DelayTask extends BasicList {
  public name = 'delay'
  public interactive = true
  public loadItems(_context: ListContext, token: CancellationToken): Promise<ListTask> {
    let emitter: any = new EventEmitter()
    let disposed = false
    setTimeout(() => {
      if (disposed) return
      emitter.emit('data', { label: 'ahead' })
    }, 10)
    setTimeout(() => {
      if (disposed) return
      emitter.emit('data', { label: 'abort' })
    }, 20)
    emitter.dispose = () => {
      disposed = true
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
      label: styles.magenta.open + (context.input || '') + styles.magenta.close
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

class ErrorTaskList extends BasicList {
  public name = 'task'
  public loadItems(_context: ListContext, _token: CancellationToken): Promise<ListTask> {
    let emitter: any = new EventEmitter()
    let timeout = setTimeout(() => {
      emitter.emit('error', new Error('task error'))
    }, 100)
    emitter.dispose = () => {
      clearTimeout(timeout)
    }
    return emitter
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

describe('util', () => {
  it('should get index', () => {
    expect(indexOf('Abc', 'a', true, false)).toBe(0)
    expect(indexOf('Abc', 'A', false, false)).toBe(0)
    expect(indexOf('abc', 'A', false, true)).toBe(0)
  })

  it('should parse input with space', () => {
    let res = parseInput('a b')
    expect(res).toEqual(['a', 'b'])
    res = parseInput('a b ')
    expect(res).toEqual(['a', 'b'])
    res = parseInput('ab ')
    expect(res).toEqual(['ab'])
  })

  it('should parse input with escaped space', () => {
    let res = parseInput('a\\ b')
    expect(res).toEqual(['a b'])
  })

  it('should convert item label', () => {
    expect(convertItemLabel({ label: 'foo\nbar\nx' }).label).toBe('foo')
    const redOpen = '\x1B[31m'
    const redClose = '\x1B[39m'
    let label = redOpen + 'foo' + redClose
    expect(convertItemLabel({ label }).label).toBe('foo')
  })

  it('should convert input', () => {
    expect(toInputs('foo bar', false)).toEqual(['foo bar'])
  })
})

describe('list worker', () => {

  it('should work with long running task', async () => {
    disposables.push(manager.registerList(new IntervalTaskList()))
    await manager.start(['task'])
    await manager.session.worker.drawItems()
    await manager.session.ui.ready
    await helper.waitValue(() => {
      return manager.session?.length > 2
    }, true)
    await manager.cancel()
  })

  it('should sort by sortText', async () => {
    items = [{
      label: 'abc',
      sortText: 'b'
    }, {
      label: 'ade',
      sortText: 'a'
    }]
    disposables.push(manager.registerList(new DataList()))
    await manager.start(['data'])
    await manager.session.ui.ready
    await helper.listInput('a')
    await helper.waitFor('getline', ['.'], 'ade')
    await manager.cancel()
  })

  it('should ready with undefined result', async () => {
    items = undefined
    disposables.push(manager.registerList(new DataList()))
    await manager.start(['data'])
    await manager.session.ui.ready
    await manager.cancel()
  })

  it('should show empty line for empty task', async () => {
    disposables.push(manager.registerList(new EmptyList()))
    await manager.start(['empty'])
    await manager.session.ui.ready
    let line = await nvim.call('getline', [1])
    expect(line).toMatch('No results')
    await manager.cancel()
  })

  it('should cancel task by use CancellationToken', async () => {
    disposables.push(manager.registerList(new IntervalTaskList()))
    await manager.start(['task'])
    expect(manager.session?.worker.isLoading).toBe(true)
    await helper.listInput('1')
    await helper.wait(50)
    manager.session?.stop()
    expect(manager.session?.worker.isLoading).toBe(false)
  })

  it('should render slow interactive list', async () => {
    disposables.push(manager.registerList(new DelayTask()))
    await manager.start(['delay'])
    await helper.listInput('a')
    await helper.waitFor('getline', [2], 'abort')
  })

  it('should work with interactive list', async () => {
    disposables.push(manager.registerList(new InteractiveList()))
    await manager.start(['-I', 'test'])
    await manager.session?.ui.ready
    expect(manager.isActivated).toBe(true)
    await helper.listInput('f')
    await helper.listInput('a')
    await helper.listInput('x')
    await helper.waitFor('getline', ['.'], 'fax')
    await manager.cancel(true)
  })

  it('should not activate on load error', async () => {
    disposables.push(manager.registerList(new ErrorList()))
    await manager.start(['test'])
    expect(manager.isActivated).toBe(false)
  })

  it('should deactivate on task error', async () => {
    disposables.push(manager.registerList(new ErrorTaskList()))
    await manager.start(['task'])
    await helper.waitValue(() => {
      return manager.isActivated
    }, false)
  })
})
