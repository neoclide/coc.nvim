import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource } from 'vscode-languageserver-protocol'
import Menu, { isMenuItem, toIndexText } from '../../model/menu'
import helper from '../helper'

let nvim: Neovim
let menu: Menu

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  if (menu) menu.dispose()
  await helper.reset()
})

describe('Menu', () => {
  it('should check isMenuItem', () => {
    expect(isMenuItem(null)).toBe(false)
  })

  it('should get index text', () => {
    expect(toIndexText(99)).toBe('  ')
  })

  it('should dispose on window close', async () => {
    await nvim.command('vnew')
    let currWin = await nvim.window
    menu = new Menu(nvim, { shortcuts: true, items: [{ text: 'foo' }, { text: 'bar', disabled: true }] })
    let p = new Promise(resolve => {
      menu.onDidClose(v => {
        resolve(v)
      })
    })
    await menu.show()
    let win = await helper.getFloat()
    nvim.call('coc#window#close', [currWin.id], true)
    nvim.call('coc#float#close', [win.id], true)
    let res = await p
    expect(res).toBe(-1)
  })

  it('should cancel by <esc>', async () => {
    menu = new Menu(nvim, { items: [{ text: 'foo' }, { text: 'bar', disabled: true }] })
    let p = new Promise(resolve => {
      menu.onDidClose(v => {
        resolve(v)
      })
    })
    await menu.show()
    await helper.waitPrompt()
    await nvim.input('<esc>')
    let res = await p
    expect(res).toBe(-1)
  })

  it('should cancel before float window shown', async () => {
    let tokenSource: CancellationTokenSource = new CancellationTokenSource()
    menu = new Menu(nvim, { items: [{ text: 'foo' }] }, tokenSource.token)
    let p = new Promise(resolve => {
      menu.onDidClose(v => {
        resolve(v)
      })
    })
    let promise = menu.show()
    tokenSource.cancel()
    await promise
    let res = await p
    expect(res).toBe(-1)
  })

  it('should support menu shortcut', async () => {
    menu = new Menu(nvim, { items: [{ text: 'foo' }, { text: 'bar' }, { text: 'baba' }], shortcuts: true, title: 'Actions' })
    let p = new Promise(resolve => {
      menu.onDidClose(v => {
        resolve(v)
      })
    })
    await menu.show()
    await helper.waitPrompt()
    await nvim.input('b')
    let res = await p
    expect(res).toBe(1)
  })

  it('should support content', async () => {
    menu = new Menu(nvim, { items: [{ text: 'foo' }, { text: 'bar' }], content: 'content' })
    await menu.show({ confirmKey: '<C-j>' })
    let p = new Promise(resolve => {
      menu.onDidClose(v => {
        resolve(v)
      })
    })
    let lines = await menu.buffer.lines
    expect(lines[0]).toBe('content')
    await nvim.input('<C-j>')
    let res = await p
    expect(res).toBe(0)
    menu.dispose()
  })

  it('should select by CR', async () => {
    menu = new Menu(nvim, { items: ['foo', 'bar'] })
    let p = new Promise(resolve => {
      menu.onDidClose(v => {
        resolve(v)
      })
    })
    await menu.show()
    await helper.waitPrompt()
    await nvim.input('j<cr>')
    let res = await p
    expect(res).toBe(1)
  })

  it('should show menu in center', async () => {
    menu = new Menu(nvim, { items: ['foo', 'bar'], position: 'center' })
    await menu.show()
    expect(menu.buffer).toBeDefined()
  })

  it('should ignore invalid index', async () => {
    menu = new Menu(nvim, { items: ['foo', 'bar'] })
    await menu.show()
    await helper.waitPrompt()
    await nvim.input('0')
    await helper.wait(30)
    let exists = await nvim.call('coc#float#has_float', [])
    expect(exists).toBe(1)
  })

  it('should select by index number', async () => {
    menu = new Menu(nvim, { items: ['foo', 'bar'] })
    let p = new Promise(resolve => {
      menu.onDidClose(v => {
        resolve(v)
      })
    })
    await menu.show()
    await helper.waitPrompt()
    await nvim.input('1')
    let res = await p
    expect(res).toBe(0)
  })

  it('should choose item after timer', async () => {
    menu = new Menu(nvim, { items: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'] })
    await menu.show()
    let p = new Promise(resolve => {
      menu.onDidClose(n => {
        resolve(n)
      })
    })
    await helper.waitPrompt()
    await nvim.input('1')
    let res = await p
    expect(res).toBe(0)
  })

  it('should navigate by j, k, g & G', async () => {
    menu = new Menu(nvim, { items: ['one', 'two', 'three'] })
    expect(menu.buffer).toBeUndefined()
    await menu.onInputChar('session', 'j')
    await menu.show({ floatHighlight: 'CocFloating', floatBorderHighlight: 'CocFloating' })
    let id = await nvim.call('GetFloatWin') as number
    expect(id).toBeGreaterThan(0)
    let win = nvim.createWindow(id)
    await nvim.input('x')
    await nvim.input('j')
    await nvim.input('j')
    await nvim.input('j')
    await helper.wait(50)
    let cursor = await win.cursor
    expect(cursor[0]).toBe(1)
    await nvim.input('k')
    await nvim.input('k')
    await nvim.input('k')
    await helper.wait(50)
    cursor = await win.cursor
    expect(cursor[0]).toBe(1)
    await nvim.input('G')
    await helper.wait(50)
    cursor = await win.cursor
    expect(cursor[0]).toBe(3)
    await nvim.input('g')
    await helper.wait(50)
    cursor = await win.cursor
    expect(cursor[0]).toBe(1)
    await nvim.input('<C-f>')
    await nvim.input('<C-b>')
    await nvim.input('9')
    await helper.wait(20)
  })

  it('should select by numbers', async () => {
    let selected: number
    menu = new Menu(nvim, { items: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] })
    await menu.show()
    let promise = new Promise(resolve => {
      menu.onDidClose(n => {
        selected = n
        resolve(undefined)
      })
    })
    await helper.waitPrompt()
    await nvim.input('1')
    await helper.wait(10)
    await nvim.input('0')
    await promise
    expect(selected).toBe(9)
  })
})
