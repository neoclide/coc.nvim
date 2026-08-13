import workspace from '../../workspace'
import * as shared from '../sharedUtil'
import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource } from 'vscode-languageserver-protocol'
import Menu, { isMenuItem, toIndexText } from '../../model/menu'

let nvim: Neovim
let menu: Menu
before(async () => {
  nvim = workspace.nvim
})

afterEach(editorReset)

describe('Menu', () => {
  it('should check isMenuItem', t => {
    assert.strictEqual(isMenuItem(null), false)
  })

  it('should get aligned index text', t => {
    assert.strictEqual(toIndexText(0), '1. ')
    assert.strictEqual(toIndexText(98), '99. ')
    assert.strictEqual(toIndexText(99), '    ')
    assert.strictEqual(toIndexText(0, 100), ' 1. ')
    assert.strictEqual(toIndexText(1, 100), ' 2. ')
    assert.strictEqual(toIndexText(9, 100), '10. ')
    assert.strictEqual(toIndexText(98, 100), '99. ')
    assert.strictEqual(toIndexText(99, 100), '    ')
  })

  it('should dispose on window close', async t => {
    await nvim.command('vnew')
    let currWin = await nvim.window
    menu = new Menu(nvim, { shortcuts: true, items: [{ text: 'foo' }, { text: 'bar', disabled: true }] })
    let p = new Promise(resolve => {
      menu.onDidClose(v => {
        resolve(v)
      })
    })
    await menu.show()
    let win = await shared.getFloat()
    nvim.call('coc#window#close', [currWin.id], true)
    nvim.call('coc#float#close', [win.id], true)
    let res = await p
    assert.strictEqual(res, -1)
  })

  it('should cancel by <esc>', async t => {
    menu = new Menu(nvim, { items: [{ text: 'foo' }, { text: 'bar', disabled: true }] })
    let p = new Promise(resolve => {
      menu.onDidClose(v => {
        resolve(v)
      })
    })
    await menu.show()
    await shared.waitPrompt()
    await nvim.input('<esc>')
    let res = await p
    assert.strictEqual(res, -1)
  })

  it('should cancel before float window shown', async t => {
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
    assert.strictEqual(res, -1)
  })

  it('should support menu shortcut', async t => {
    menu = new Menu(nvim, { items: [{ text: 'foo' }, { text: 'bar' }, { text: 'baba' }], shortcuts: true, title: 'Actions' })
    let p = new Promise(resolve => {
      menu.onDidClose(v => {
        resolve(v)
      })
    })
    await menu.show()
    await shared.waitPrompt()
    await nvim.input('b')
    let res = await p
    assert.strictEqual(res, 1)
  })

  it('should support content', async t => {
    menu = new Menu(nvim, { items: [{ text: 'foo' }, { text: 'bar' }], content: 'content' })
    await menu.show({ confirmKey: '<C-j>' })
    let p = new Promise(resolve => {
      menu.onDidClose(v => {
        resolve(v)
      })
    })
    let lines = await menu.buffer.lines
    assert.strictEqual(lines[0], 'content')
    await nvim.input('<C-j>')
    let res = await p
    assert.strictEqual(res, 0)
    menu.dispose()
  })

  it('should select by CR', async t => {
    menu = new Menu(nvim, { items: ['foo', 'bar'] })
    let p = new Promise(resolve => {
      menu.onDidClose(v => {
        resolve(v)
      })
    })
    await menu.show()
    await shared.waitPrompt()
    await nvim.input('j<cr>')
    let res = await p
    assert.strictEqual(res, 1)
  })

  it('should show menu in center', async t => {
    menu = new Menu(nvim, { items: ['foo', 'bar'], position: 'center' })
    await menu.show()
    assert.notStrictEqual(menu.buffer, undefined)
  })

  it('should ignore invalid index', async t => {
    menu = new Menu(nvim, { items: ['foo', 'bar'] })
    await menu.show()
    await shared.waitPrompt()
    await nvim.input('0')
    await shared.waitValue(() => nvim.call('coc#float#has_float', []), 1)
    let exists = await nvim.call('coc#float#has_float', [])
    assert.strictEqual(exists, 1)
  })

  it('should select by index number', async t => {
    menu = new Menu(nvim, { items: ['foo', 'bar'] })
    let p = new Promise(resolve => {
      menu.onDidClose(v => {
        resolve(v)
      })
    })
    await menu.show()
    await shared.waitPrompt()
    await nvim.input('1')
    let res = await p
    assert.strictEqual(res, 0)
  })

  it('should choose item after timer', async t => {
    menu = new Menu(nvim, { items: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'] })
    await menu.show()
    let p = new Promise(resolve => {
      menu.onDidClose(n => {
        resolve(n)
      })
    })
    await shared.waitPrompt()
    await nvim.input('1')
    let res = await p
    assert.strictEqual(res, 0)
  })

  it('should navigate by j, k, g & G', async t => {
    menu = new Menu(nvim, { items: ['one', 'two', 'three'] })
    assert.strictEqual(menu.buffer, undefined)
    await menu.onInputChar('session', 'j')
    await menu.show({ floatHighlight: 'CocFloating', floatBorderHighlight: 'CocFloatBorder' })
    let id = await nvim.call('GetFloatWin') as number
    assert.ok(id > 0)
    let win = nvim.createWindow(id)
    await nvim.input('x')
    await nvim.input('j')
    await nvim.input('j')
    await nvim.input('j')
    await shared.waitValue(async () => (await win.cursor)[0], 1)
    let cursor = await win.cursor
    assert.strictEqual(cursor[0], 1)
    await nvim.input('k')
    await nvim.input('k')
    await nvim.input('k')
    await shared.waitValue(async () => (await win.cursor)[0], 1)
    cursor = await win.cursor
    assert.strictEqual(cursor[0], 1)
    await nvim.input('G')
    await shared.waitValue(async () => (await win.cursor)[0], 3)
    cursor = await win.cursor
    assert.strictEqual(cursor[0], 3)
    await nvim.input('g')
    await shared.waitValue(async () => (await win.cursor)[0], 1)
    cursor = await win.cursor
    assert.strictEqual(cursor[0], 1)
    await nvim.input('<C-f>')
    await nvim.input('<C-b>')
    await nvim.input('9')
    await shared.wait(20)
  })

  it('should select by numbers', async t => {
    let selected: number
    menu = new Menu(nvim, { items: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] })
    await menu.show()
    let promise = new Promise(resolve => {
      menu.onDidClose(n => {
        selected = n
        resolve(undefined)
      })
    })
    await shared.waitPrompt()
    await nvim.input('1')
    await shared.wait(20)
    await nvim.input('0')
    await promise
    assert.strictEqual(selected, 9)
  })
})
