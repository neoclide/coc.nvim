import { Neovim } from '@chemzqm/neovim'
import { Disposable, Range } from 'vscode-languageserver-protocol'
import { disposeAll } from '../../util'
import window from '../../window'
import helper from '../helper'

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
  await helper.reset()
  disposeAll(disposables)
  disposables = []
})

describe('window functions', () => {
  it('should get offset', async () => {
    let doc = await helper.createDocument()
    await doc.applyEdits([{ range: Range.create(0, 0, 0, 0), newText: 'foo\nbar' }])
    let buf = await nvim.buffer
    await buf.setLines(['foo', 'bar'], { start: 0, end: -1 })
    await helper.wait(100)
    await nvim.call('cursor', [2, 2])
    let n = await window.getOffset()
    expect(n).toBe(5)
  })

  it('should echo lines', async () => {
    await window.echoLines(['a', 'b'])
    let ch = await nvim.call('screenchar', [79, 1])
    let s = String.fromCharCode(ch)
    expect(s).toBe('a')
  })

  it('should echo multiple lines with truncate', async () => {
    await window.echoLines(['a', 'b', 'd', 'e'], true)
    let ch = await nvim.call('screenchar', [79, 1])
    let s = String.fromCharCode(ch)
    expect(s).toBe('a')
  })

  it('should run terminal command', async () => {
    let res = await window.runTerminalCommand('ls', __dirname)
    expect(res.success).toBe(true)
  })

  it('should open temimal buffer', async () => {
    let bufnr = await window.openTerminal('ls', { autoclose: false, keepfocus: false })
    let curr = await nvim.eval('bufnr("%")')
    expect(curr).toBe(bufnr)
    let buftype = await nvim.eval('&buftype')
    expect(buftype).toBe('terminal')
  })

  it('should show mesages', async () => {
    await helper.edit()
    window.showMessage('error', 'error')
    await helper.wait(100)
    let str = await helper.getCmdline()
    expect(str).toMatch('error')
    window.showMessage('warning', 'warning')
    await helper.wait(100)
    str = await helper.getCmdline()
    expect(str).toMatch('warning')
    window.showMessage('moremsg')
    await helper.wait(100)
    str = await helper.getCmdline()
    expect(str).toMatch('moremsg')
  })

  it('should create outputChannel', () => {
    let channel = window.createOutputChannel('channel')
    expect(channel.name).toBe('channel')
  })

  it('should show outputChannel', async () => {
    window.createOutputChannel('channel')
    window.showOutputChannel('channel')
    await helper.wait(50)
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toMatch('channel')
  })

  it('should not show none exists channel', async () => {
    let buf = await nvim.buffer
    let bufnr = buf.id
    window.showOutputChannel('NONE')
    await helper.wait(10)
    buf = await nvim.buffer
    expect(buf.id).toBe(bufnr)
  })

  it('should get cursor position', async () => {
    await helper.createDocument()
    await nvim.setLine('       ')
    await nvim.call('cursor', [1, 3])
    let pos = await window.getCursorPosition()
    expect(pos).toEqual({
      line: 0,
      character: 2
    })
  })

  it('should moveTo position in insert mode', async () => {
    await helper.edit()
    await nvim.setLine('foo')
    await nvim.input('i')
    await window.moveTo({ line: 0, character: 3 })
    let col = await nvim.call('col', '.')
    expect(col).toBe(4)
    let virtualedit = await nvim.getOption('virtualedit')
    expect(virtualedit).toBe('')
  })

  it('should choose quickpick', async () => {
    let p = window.showQuickpick(['a', 'b'])
    await helper.wait(100)
    await nvim.input('1')
    await nvim.input('<CR>')
    let res = await p
    expect(res).toBe(0)
  })

  it('should cancel quickpick', async () => {
    let p = window.showQuickpick(['a', 'b'])
    await helper.wait(100)
    await nvim.input('<esc>')
    let res = await p
    expect(res).toBe(-1)
  })

  it('should show prompt', async () => {
    let p = window.showPrompt('prompt')
    await helper.wait(100)
    await nvim.input('y')
    let res = await p
    expect(res).toBe(true)
  })

  it('should show dialog', async () => {
    let dialog = await window.showDialog({ content: 'foo' })
    let winid = await dialog.winid
    expect(winid).toBeDefined()
    expect(winid).toBeGreaterThan(1000)
  })

  it('should show menu', async () => {
    let p = window.showMenuPicker(['a', 'b', 'c'], 'choose item')
    await helper.wait(100)
    let exists = await nvim.call('coc#float#has_float', [])
    expect(exists).toBe(1)
    await nvim.input('2')
    let res = await p
    expect(res).toBe(1)
  })

  it('should request input', async () => {
    let p = window.requestInput('Name')
    await helper.wait(100)
    await nvim.input('bar<enter>')
    let res = await p
    expect(res).toBe('bar')
  })

  it('should return null when input empty', async () => {
    let p = window.requestInput('Name')
    await helper.wait(30)
    await nvim.input('<enter>')
    let res = await p
    expect(res).toBeNull()
  })

  it('should return select items for picker', async () => {
    let p = window.showPickerDialog(['foo', 'bar'], 'select')
    await helper.wait(100)
    await nvim.input(' ')
    await helper.wait(30)
    await nvim.input('<cr>')
    let res = await p
    expect(res).toEqual(['foo'])
  })
})
