import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource } from 'vscode-languageserver-protocol'
import events from '../../events'
import Picker, { toPickerItems } from '../../model/picker'
import { QuickPickItem } from '../../types'
import helper from '../helper'

let nvim: Neovim
let picker: Picker

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  if (picker) picker.dispose()
  picker = undefined
  await helper.reset()
})

async function inputChar(ch: string): Promise<void> {
  await picker.onInputChar('picker', ch)
}

const items: QuickPickItem[] = [{ label: 'foo' }, { label: 'bar' }]
describe('util', () => {
  it('should convert picker items', () => {
    expect(toPickerItems([{ label: 'foo' }])).toEqual([{ label: 'foo' }])
    expect(toPickerItems(['foo'])).toEqual([{ label: 'foo' }])
  })
})

describe('Picker create', () => {
  it('should show dialog with buttons', async () => {
    picker = new Picker(nvim, { title: 'title', items: items.concat([{ label: 'three', picked: true }]) })
    let winid = await picker.show({ pickerButtons: true })
    expect(winid).toBeDefined()
    let id = await nvim.call('coc#float#get_related', [winid, 'buttons'])
    expect(id).toBeGreaterThan(0)
    let res = await nvim.call('sign_getplaced', [picker.buffer.id, { group: 'PopUpCocDialog' }])
    expect(res[0].signs).toBeDefined()
    expect(res[0].signs[0].name).toBe('CocCurrentLine')
  })

  it('should cancel dialog when cancellation token requested', async () => {
    let tokenSource = new CancellationTokenSource()
    picker = new Picker(nvim, { title: 'title', items }, tokenSource.token)
    let winid = await picker.show({ pickerButtons: true, pickerButtonShortcut: true })
    expect(winid).toBeDefined()
    tokenSource.cancel()
    let win = nvim.createWindow(winid)
    await helper.waitValue(async () => {
      return await win.valid
    }, false)
  })

  it('should cancel dialog without window', async () => {
    let tokenSource = new CancellationTokenSource()
    picker = new Picker(nvim, { title: 'title', items }, tokenSource.token)
    expect(picker.buffer).toBeUndefined()
    expect(picker.currIndex).toBe(0)
    await picker.onInputChar('picker', 'i')
    picker.changeLine(-1)
    tokenSource.cancel()
  })
})

describe('Picker key mappings', () => {
  it('should toggle selection mouse click bracket', async () => {
    picker = new Picker(nvim, { title: 'title', items })
    let winid = await picker.show()
    await nvim.setVar('mouse_position', [winid, 1, 1])
    await nvim.input('<LeftRelease>')
    await helper.wait(50)
    let buf = picker.buffer
    let lines = await buf.getLines({ start: 0, end: 1, strictIndexing: false })
    expect(lines[0]).toMatch(/^\[x\]/)
    await inputChar('<LeftRelease>')
    await events.fire('FloatBtnClick', [picker.bufnr, 0])
  })

  it('should change current line on mouse click label', async () => {
    picker = new Picker(nvim, { title: 'title', items })
    let winid = await picker.show()
    await nvim.setVar('mouse_position', [winid, 2, 4])
    await nvim.input('<LeftRelease>')
    await helper.wait(50)
    let buf = picker.buffer
    let res = await nvim.call('sign_getplaced', [buf.id, { group: 'PopUpCocDialog' }])
    expect(res[0].signs).toBeDefined()
    expect(res[0].signs[0].name).toBe('CocCurrentLine')
    await events.fire('FloatBtnClick', [picker.bufnr, 1])
  })

  it('should cancel by <esc>', async () => {
    await helper.createDocument()
    picker = new Picker(nvim, { title: 'title', items })
    let winid = await picker.show({ pickerButtons: true })
    expect(winid).toBeDefined()
    let fn = jest.fn()
    picker.onDidClose(fn)
    await picker.onInputChar('picker', '<esc>')
    expect(fn).toBeCalledTimes(1)
  })

  it('should confirm by <CR>', async () => {
    await helper.createDocument()
    let item: QuickPickItem = { label: 'item', description: 'description' }
    picker = new Picker(nvim, { title: 'title', items: [item].concat(items) })
    let winid = await picker.show({ pickerButtons: true })
    expect(winid).toBeDefined()
    let fn = jest.fn()
    picker.onDidClose(fn)
    await picker.onInputChar('picker', ' ')
    await picker.onInputChar('picker', ' ')
    await picker.onInputChar('picker', 'k')
    await picker.onInputChar('picker', ' ')
    await events.fire('FloatBtnClick', [picker.bufnr + 1, 0])
    await events.fire('FloatBtnClick', [picker.bufnr, 0])
    expect(fn).toBeCalledTimes(1)
  })

  it('should move cursor by j, k, g & G', async () => {
    await helper.createDocument()
    picker = new Picker(nvim, { title: 'title', items })
    function getSigns(): Promise<any> {
      return nvim.call('sign_getplaced', [picker.buffer.id, { group: 'PopUpCocDialog' }])
    }
    let winid = await picker.show({ pickerButtons: true })
    await helper.waitFloat()
    expect(winid).toBeDefined()
    await nvim.input('j')
    await helper.wait(100)
    let res = await getSigns()
    expect(res[0].signs[0].lnum).toBe(2)
    await nvim.input('k')
    await helper.wait(100)
    res = await getSigns()
    expect(res[0].signs[0].lnum).toBe(1)
    await nvim.input('G')
    await helper.wait(100)
    res = await getSigns()
    expect(res[0].signs[0].lnum).toBe(2)
    await nvim.input('g')
    await helper.wait(100)
    res = await getSigns()
    expect(res[0].signs[0].lnum).toBe(1)
  })

  it('should toggle selection by <space>', async () => {
    await helper.createDocument()
    picker = new Picker(nvim, { title: 'title', items })
    let winid = await picker.show({
      maxWidth: 60,
      floatHighlight: 'CocFloating',
      floatBorderHighlight: 'Normal',
      rounded: true,
      confirmKey: 'r',
      pickerButtons: true
    })
    await helper.waitFloat()
    expect(winid).toBeDefined()
    let fn = jest.fn()
    picker.onDidClose(fn)
    await inputChar(' ')
    let lines = await nvim.call('getbufline', [picker.buffer.id, 1])
    expect(lines[0]).toMatch('[x]')
    await inputChar('r')
  })

  it('should scroll forward & backward', async () => {
    await helper.createDocument()
    let items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map(s => {
      return { label: s }
    })
    picker = new Picker(nvim, { title: 'title', items })
    let event
    picker.onDidClose(ev => {
      event = ev
    })
    let winid = await picker.show({ maxHeight: 3 })
    expect(winid).toBeDefined()
    await picker.onInputChar('picker', '<C-f>')
    let info = await nvim.call('getwininfo', [winid])
    expect(info[0]).toBeDefined()
    await picker.onInputChar('picker', '<C-b>')
    info = await nvim.call('getwininfo', [winid])
    expect(info[0]).toBeDefined()
    await inputChar('<cr>')
    expect(event).toBeUndefined()
  })

  it('should fire selected items on cr', async () => {
    picker = new Picker(nvim, { title: 'title', items: items.concat([{ label: 'three', picked: true }]) })
    let event
    picker.onDidClose(e => {
      event = e
    })
    let winid = await picker.show({ pickerButtons: true })
    expect(winid).toBeDefined()
    await inputChar('<cr>')
    expect(event).toEqual([2])
  })
})
