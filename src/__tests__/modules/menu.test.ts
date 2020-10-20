import { Neovim } from '@chemzqm/neovim'
import helper from '../helper'
import workspace from '../../workspace'
import Menu from '../../model/menu'
import { Disposable } from 'vscode-languageserver-protocol'

let nvim: Neovim
let menu: Menu

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  menu = new Menu(nvim, workspace.env)
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  menu.hide()
  await helper.reset()
})

describe('Menu', () => {
  it('should show menu', async () => {
    await menu.show(['one', 'two', 'thr'])
    await helper.wait(100)
    let id = await nvim.call('coc#float#get_float_win')
    expect(id).toBeGreaterThan(0)
    let bufnr = await nvim.call('winbufnr', [id])
    let buf = nvim.createBuffer(bufnr)
    let lines = await buf.lines
    expect(lines).toEqual(['1. one', '2. two', '3. thr'])
  })

  it('should cancel by <esc>', async () => {
    let fn = jest.fn()
    await menu.show(['one', 'two', 'three'])
    let disposable = menu.onDidCancel(() => {
      disposable.dispose()
      fn()
    })
    await helper.wait(100)
    let id = await nvim.call('coc#float#get_float_win')
    expect(id).toBeGreaterThan(0)
    await nvim.input('<esc>')
    await helper.wait(100)
    expect(fn).toBeCalled()
  })

  it('should select by CR', async () => {
    let cancelFn = jest.fn()
    await menu.show(['one', 'two', 'three'])
    let selected: number
    let disposables: Disposable[] = []
    disposables.push(menu.onDidCancel(() => {
      cancelFn()
    }))
    disposables.push(menu.onDidChoose(n => {
      selected = n
    }))
    await helper.wait(100)
    await nvim.input('<cr>')
    await helper.wait(100)
    for (let disposable of disposables) {
      disposable.dispose()
    }
    expect(selected).toBe(0)
    expect(cancelFn).toBeCalledTimes(0)
  })

  it('should ignore invalid index', async () => {
    await menu.show(['one', 'two', 'three'])
    let canceled = false
    let disposables: Disposable[] = []
    disposables.push(menu.onDidCancel(() => {
      canceled = true
    }))
    await helper.wait(100)
    await nvim.input('0')
    await helper.wait(50)
    await nvim.input('5')
    await helper.wait(50)
    await nvim.input('<esc>')
    await helper.wait(50)
    for (let disposable of disposables) {
      disposable.dispose()
    }
    expect(canceled).toBe(false)
  })

  it('should select by index number', async () => {
    await menu.show(['one', 'two', 'three'])
    let selected: number
    let disposables: Disposable[] = []
    disposables.push(menu.onDidChoose(n => {
      selected = n
    }))
    await helper.wait(100)
    await nvim.input('2')
    await helper.wait(100)
    for (let disposable of disposables) {
      disposable.dispose()
    }
    expect(selected).toBe(1)
  })

  it('should navigate by j, k & G', async () => {
    await menu.show(['one', 'two', 'three'])
    await helper.wait(100)
    let id = await nvim.call('coc#float#get_float_win')
    expect(id).toBeGreaterThan(0)
    let win = nvim.createWindow(id)
    nvim.call('feedkeys', ['j', 'in'], true)
    await helper.wait(100)
    // neovim would cancel input
    nvim.call('coc#list#start_prompt', ['MenuInput'], true)
    let cursor = await win.cursor
    expect(cursor[0]).toBe(2)
    nvim.call('feedkeys', ['k', 'in'], true)
    await helper.wait(100)
    nvim.call('coc#list#start_prompt', ['MenuInput'], true)
    cursor = await win.cursor
    expect(cursor[0]).toBe(1)
    nvim.call('feedkeys', ['G', 'in'], true)
    await helper.wait(100)
    cursor = await win.cursor
    expect(cursor[0]).toBe(3)
  })

  it('should select by numbers', async () => {
    let selected: number
    await menu.show(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    let disposable = menu.onDidChoose(n => {
      disposable.dispose()
      selected = n
    })
    await helper.wait(100)
    nvim.call('feedkeys', ['1', 'in'], true)
    await helper.wait(50)
    nvim.call('coc#list#start_prompt', ['MenuInput'], true)
    nvim.call('feedkeys', ['0', 'in'], true)
    await helper.wait(200)
    expect(selected).toBe(9)
  })
})
