import { Neovim } from '@chemzqm/neovim'
import workspace from '../../workspace'
import Keymaps, { getBufnr, getKeymapModifier } from '../../core/keymaps'
import helper from '../helper'
import { Disposable } from 'vscode-languageserver-protocol'
import { disposeAll } from '../../util'
import events from '../../events'

let nvim: Neovim
let keymaps: Keymaps
let disposables: Disposable[] = []

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  keymaps = workspace.keymaps
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  disposeAll(disposables)
  await helper.reset()
})

describe('doKeymap()', () => {
  it('should not throw when key not mapped', async () => {
    await keymaps.doKeymap('<C-a>', '')
  })

  it('should invoke exists keymap', async () => {
    let called = false
    keymaps.registerKeymap(['i', 'n'], 'test-keymap', () => {
      called = true
      return 'result'
    })
    let res = await keymaps.doKeymap('test-keymap', '')
    expect(res).toBe('result')
    expect(called).toBe(true)
  })
})

describe('registerKeymap()', () => {
  it('should getBufnr', () => {
    expect(getBufnr(3)).toBe(3)
    expect(getBufnr(true)).toBe(events.bufnr)
  })

  it('should getKeymapModifier', () => {
    expect(getKeymapModifier('i')).toBe('<C-o>')
    expect(getKeymapModifier('s')).toBe('<Esc>')
    expect(getKeymapModifier('x')).toBe('<C-U>')
    expect(getKeymapModifier('t' as any)).toBe('')
  })

  it('should throw for invalid key', () => {
    let err
    try {
      keymaps.registerKeymap(['i'], '', jest.fn())
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })

  it('should throw for duplicated key', async () => {
    keymaps.registerKeymap(['i'], 'tmp', jest.fn())
    let err
    try {
      keymaps.registerKeymap(['i'], 'tmp', jest.fn())
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })

  it('should register insert key mapping', async () => {
    let fn = jest.fn()
    disposables.push(keymaps.registerKeymap(['i'], 'test', fn))
    let res = await nvim.call('execute', ['verbose imap <Plug>(coc-test)'])
    expect(res).toMatch('coc#_insert_key')
  })

  it('should register with different options', async () => {
    let called = false
    let fn = () => {
      called = true
      return ''
    }
    disposables.push(keymaps.registerKeymap(['n', 'v'], 'test', fn, {
      sync: false,
      cancel: false,
      silent: false,
      repeat: true
    }))
    let res = await nvim.exec(`verbose nmap <Plug>(coc-test)`, true)
    expect(res).toMatch('coc#rpc#notify')
    await nvim.eval(`feedkeys("\\<Plug>(coc-test)")`)
    await helper.waitValue(() => called, true)
  })
})

describe('registerExprKeymap()', () => {
  it('should visual key mapping', async () => {
    await nvim.setLine('foo')
    let called = false
    let fn = () => {
      called = true
      return ''
    }
    disposables.push(keymaps.registerExprKeymap('x', 'x', fn))
    await nvim.command('normal! viw')
    await nvim.input('x<esc>')
    await helper.waitValue(() => called, true)
  })

  it('should register insert key mapping', async () => {
    let buf = await nvim.buffer
    let called = false
    let fn = () => {
      called = true
      return ''
    }
    let disposable = keymaps.registerExprKeymap('i', 'x', fn, buf.id)
    let res = await nvim.exec('imap x', true)
    expect(res).toMatch('coc#_insert_key')
    await nvim.input('i')
    await nvim.input('x')
    await helper.waitValue(() => called, true)
    disposable.dispose()
    res = await nvim.exec('imap x', true)
    expect(res).toMatch('No mapping found')
  })

  it('should regist key mapping without cancel pum', async () => {
    let fn = jest.fn()
    let disposable = keymaps.registerExprKeymap('i', 'x', fn, false, false)
    let res = await nvim.exec('imap x', true)
    expect(res).toMatch('coc#_insert_key')
    disposable.dispose()
  })
})

describe('registerLocalKeymap', () => {
  it('should register local keymap by notification', async () => {
    let bufnr = await nvim.call('bufnr', ['%']) as number
    let called = false
    let disposable = keymaps.registerLocalKeymap(bufnr, 'n', 'n', () => {
      called = true
    }, true)
    let res = await nvim.exec('nmap n', true)
    await nvim.input('n')
    await helper.waitValue(() => called, true)
    disposable.dispose()
    res = await nvim.exec('nmap n', true)
    expect(res).toMatch('No mapping found')
  })
})
