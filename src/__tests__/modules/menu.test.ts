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
    menu.show(['one', 'two', 'thr'])
    await helper.wait(150)
    let id = await nvim.call('coc#float#get_float_win')
    expect(id).toBeGreaterThan(0)
    let bufnr = await nvim.call('winbufnr', [id])
    let buf = nvim.createBuffer(bufnr)
    let lines = await buf.lines
    expect(lines).toEqual(['1. one', '2. two', '3. thr'])
    menu.hide()
  })

  it('should cancel by <esc>', async () => {
    let fn = jest.fn()
    menu.show(['one', 'two', 'three'])
    let promise = new Promise(resolve => {
      let disposable = menu.onDidCancel(() => {
        disposable.dispose()
        fn()
        resolve()
      })
    })
    await helper.wait(150)
    let id = await nvim.call('coc#float#get_float_win')
    expect(id).toBeGreaterThan(0)
    await nvim.input('<esc>')
    await promise
    expect(fn).toBeCalled()
  })

  it('should select by CR', async () => {
    let cancelFn = jest.fn()
    menu.show(['one', 'two', 'three'])
    let selected: number
    let disposables: Disposable[] = []
    let promise = new Promise(resolve => {
      disposables.push(menu.onDidCancel(() => {
        cancelFn()
        resolve()
      }))
      disposables.push(menu.onDidChoose(n => {
        selected = n
        resolve()
      }))
    })
    await helper.wait(100)
    await nvim.input('<cr>')
    await promise
    for (let disposable of disposables) {
      disposable.dispose()
    }
    expect(selected).toBe(0)
    expect(cancelFn).toBeCalledTimes(0)
  })

  it('should ignore invalid index', async () => {
    menu.show(['one', 'two', 'three'])
    let canceled = false
    let disposable = menu.onDidCancel(() => {
      disposable.dispose()
      canceled = true
    })
    await helper.wait(100)
    await nvim.input('05')
    await helper.wait(50)
    expect(canceled).toBe(false)
    menu.hide()
  })

  it('should select by index number', async () => {
    menu.show(['one', 'two', 'three'])
    let selected: number
    let promise = new Promise(resolve => {
      let disposable = menu.onDidChoose(n => {
        disposable.dispose()
        selected = n
        resolve()
      })
    })
    await helper.wait(100)
    await nvim.input('2')
    await promise
    expect(selected).toBe(1)
  })

  it('should navigate by j, k & G', async () => {
    menu.show(['one', 'two', 'three'])
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
    menu.show(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
    let promise = new Promise(resolve => {
      let disposable = menu.onDidChoose(n => {
        disposable.dispose()
        selected = n
        resolve()
      })
    })
    await helper.wait(100)
    nvim.call('feedkeys', ['1', 'in'], true)
    await helper.wait(50)
    nvim.call('coc#list#start_prompt', ['MenuInput'], true)
    nvim.call('feedkeys', ['0', 'in'], true)
    await promise
    expect(selected).toBe(9)
  })
})
