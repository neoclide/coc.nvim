import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import events from '../../events'
import { disposeAll } from '../../util'
let disposables: Disposable[] = []
import helper from '../helper'

let nvim: Neovim

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  disposeAll(disposables)
})

describe('register handler', () => {
  it('should register single handler', async () => {
    let fn = jest.fn()
    let obj = {}
    let disposable = events.on('BufEnter', fn, obj)
    disposables.push(disposable)
    await events.fire('BufEnter', ['a', 'b'])
    expect(fn).toBeCalledWith('a', 'b')
  })

  it('should register multiple events', async () => {
    let fn = jest.fn()
    let disposable = events.on(['TaskExit', 'TaskStderr'], fn)
    disposables.push(disposable)
    await events.fire('TaskExit', [])
    await events.fire('TaskStderr', [])
    expect(fn).toBeCalledTimes(2)
  })

  it('should resolve after timeout', async () => {
    let fn = (): Promise<void> => new Promise(resolve => {
      setTimeout(() => {
        resolve()
      }, 100)
    })
    let disposable = events.on('FocusGained', fn, {})
    disposables.push(disposable)
    let ts = Date.now()
    await events.fire('FocusGained', [])
    expect(Date.now() - ts >= 80).toBe(true)
  })

  it('should emit TextInsert after TextChangedI', async () => {
    let arr: string[] = []
    events.on('TextInsert', () => {
      arr.push('insert')
    }, null, disposables)
    events.on('TextChangedI', () => {
      arr.push('change')
    }, null, disposables)
    await nvim.input('ia')
    await helper.wait(300)
    expect(arr).toEqual(['change', 'insert'])
  })
})
