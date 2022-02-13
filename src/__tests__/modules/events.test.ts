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
  it('should fire InsertEnter and InsertLeave when necessary', async () => {
    let fn = jest.fn()
    events.on('InsertEnter', fn, null, disposables)
    events.on('InsertLeave', fn, null, disposables)
    expect(events.insertMode).toBe(false)
    await events.fire('CursorMovedI', [1, [1, 1]])
    expect(events.insertMode).toBe(true)
    await events.fire('CursorMoved', [1, [1, 1]])
    expect(events.insertMode).toBe(false)
    expect(fn).toBeCalledTimes(2)
  })

  it('should change pumvisible', async () => {
    expect(events.pumvisible).toBe(false)
    await nvim.setLine('foo f')
    await nvim.input('A')
    await nvim.input('<C-n>')
    await helper.waitPopup()
    expect(events.pumvisible).toBe(true)
    expect(events.lastChangeTs).toBeDefined()
  })

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
