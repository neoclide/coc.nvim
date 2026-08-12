import * as shared from '../sharedUtil'
import { nvim } from '../sharedUtil'
import { CancellationTokenSource } from 'vscode-languageserver-protocol'
import events from '../../events'
import Picker, { toPickerItems } from '../../model/picker'
import { QuickPickItem } from '../../types'
import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

let picker: Picker

afterEach(() => {
  if (picker) picker.dispose()
  picker = undefined
})

async function inputChar(ch: string): Promise<void> {
  await picker.onInputChar('picker', ch)
}

const items: QuickPickItem[] = [{ label: 'foo' }, { label: 'bar' }]
describe('util', () => {
  it('should convert picker items', t => {
    assert.deepStrictEqual(toPickerItems([{ label: 'foo' }]), [{ label: 'foo' }])
    assert.deepStrictEqual(toPickerItems(['foo']), [{ label: 'foo' }])
  })
})

describe('Picker create', () => {
  it('should show dialog with buttons', async t => {
    picker = new Picker(nvim, { title: 'title', items: items.concat([{ label: 'three', picked: true }]) })
    let winid = await picker.show({ pickerButtons: true })
    assert.notStrictEqual(winid, undefined)
    let id = await nvim.call('coc#float#get_related', [winid, 'buttons'])
    assert.ok(Number(id) > 0)
    let res = await nvim.call('sign_getplaced', [picker.buffer.id, { group: 'PopUpCocDialog' }])
    assert.notStrictEqual(res[0].signs, undefined)
    assert.strictEqual(res[0].signs[0].name, 'CocCurrentLine')
  })

  it('should cancel dialog when cancellation token requested', async t => {
    let tokenSource = new CancellationTokenSource()
    picker = new Picker(nvim, { title: 'title', items }, tokenSource.token)
    let winid = await picker.show({ pickerButtons: true, pickerButtonShortcut: true })
    assert.notStrictEqual(winid, undefined)
    tokenSource.cancel()
    let win = nvim.createWindow(winid)
    await shared.waitValue(async () => {
      return await win.valid
    }, false)
  })

  it('should cancel dialog without window', async t => {
    let tokenSource = new CancellationTokenSource()
    picker = new Picker(nvim, { title: 'title', items }, tokenSource.token)
    assert.strictEqual(picker.buffer, undefined)
    assert.strictEqual(picker.currIndex, 0)
    await picker.onInputChar('picker', 'i')
    picker.changeLine(-1)
    tokenSource.cancel()
  })
})

describe('Picker key mappings', () => {
  it('should toggle selection mouse click bracket', async t => {
    picker = new Picker(nvim, { title: 'title', items })
    let winid = await picker.show()
    await nvim.setVar('mouse_position', [winid, 1, 1])
    await nvim.input('<LeftRelease>')
    let buf = picker.buffer
    await shared.waitValue(async () => (await buf.getLines({ start: 0, end: 1, strictIndexing: false }))[0].startsWith('[x]'), true)
    let lines = await buf.getLines({ start: 0, end: 1, strictIndexing: false })
    assert.match(lines[0], /^\[x\]/)
    await inputChar('<LeftRelease>')
    await events.fire('FloatBtnClick', [picker.bufnr, 0])
  })

  it('should change current line on mouse click label', async t => {
    picker = new Picker(nvim, { title: 'title', items })
    let winid = await picker.show()
    await nvim.setVar('mouse_position', [winid, 2, 4])
    await nvim.input('<LeftRelease>')
    let buf = picker.buffer
    await shared.waitValue(async () => {
      let res = await nvim.call('sign_getplaced', [buf.id, { group: 'PopUpCocDialog' }])
      return res[0]?.signs?.length > 0
    }, true)
    let res = await nvim.call('sign_getplaced', [buf.id, { group: 'PopUpCocDialog' }])
    assert.notStrictEqual(res[0].signs, undefined)
    assert.strictEqual(res[0].signs[0].name, 'CocCurrentLine')
    await events.fire('FloatBtnClick', [picker.bufnr, 1])
  })

  it('should cancel by <esc>', async t => {
    await shared.createDocument()
    picker = new Picker(nvim, { title: 'title', items })
    let winid = await picker.show({ pickerButtons: true })
    assert.notStrictEqual(winid, undefined)
    let fn = t.mock.fn()
    picker.onDidClose(fn)
    await picker.onInputChar('picker', '<esc>')
    assert.strictEqual(fn.mock.calls.length, 1)
  })

  it('should confirm by <CR>', async t => {
    await shared.createDocument()
    let item: QuickPickItem = { label: 'item', description: 'description' }
    picker = new Picker(nvim, { title: 'title', items: [item].concat(items) })
    let winid = await picker.show({ pickerButtons: true })
    assert.notStrictEqual(winid, undefined)
    let fn = t.mock.fn()
    picker.onDidClose(fn)
    await picker.onInputChar('picker', ' ')
    await picker.onInputChar('picker', ' ')
    await picker.onInputChar('picker', 'k')
    await picker.onInputChar('picker', ' ')
    await events.fire('FloatBtnClick', [picker.bufnr + 1, 0])
    await events.fire('FloatBtnClick', [picker.bufnr, 0])
    assert.strictEqual(fn.mock.calls.length, 1)
  })

  it('should move cursor by j, k, g & G', async t => {
    await shared.createDocument()
    picker = new Picker(nvim, { title: 'title', items })
    function getSigns(): Promise<any> {
      return nvim.call('sign_getplaced', [picker.buffer.id, { group: 'PopUpCocDialog' }])
    }
    let winid = await picker.show({ pickerButtons: true })
    await shared.waitFloat()
    assert.notStrictEqual(winid, undefined)
    await nvim.input('j')
    await shared.waitValue(async () => (await getSigns())[0]?.signs?.[0]?.lnum, 2)
    let res = await getSigns()
    assert.strictEqual(res[0].signs[0].lnum, 2)
    await nvim.input('k')
    await shared.waitValue(async () => (await getSigns())[0]?.signs?.[0]?.lnum, 1)
    res = await getSigns()
    assert.strictEqual(res[0].signs[0].lnum, 1)
    await nvim.input('G')
    await shared.waitValue(async () => (await getSigns())[0]?.signs?.[0]?.lnum, 2)
    res = await getSigns()
    assert.strictEqual(res[0].signs[0].lnum, 2)
    await nvim.input('g')
    await shared.waitValue(async () => (await getSigns())[0]?.signs?.[0]?.lnum, 1)
    res = await getSigns()
    assert.strictEqual(res[0].signs[0].lnum, 1)
  })

  it('should toggle selection by <space>', async t => {
    await shared.createDocument()
    picker = new Picker(nvim, { title: 'title', items })
    let winid = await picker.show({
      maxWidth: 60,
      floatHighlight: 'CocFloating',
      floatBorderHighlight: 'Normal',
      rounded: true,
      confirmKey: 'r',
      pickerButtons: true
    })
    await shared.waitFloat()
    assert.notStrictEqual(winid, undefined)
    let fn = t.mock.fn()
    picker.onDidClose(fn)
    await inputChar(' ')
    let lines = await nvim.call('getbufline', [picker.buffer.id, 1])
    assert.match(lines[0], new RegExp('\\[x\\]'))
    await inputChar('r')
  })

  it('should scroll forward & backward', async t => {
    await shared.createDocument()
    let items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map(s => {
      return { label: s }
    })
    picker = new Picker(nvim, { title: 'title', items })
    let event
    picker.onDidClose(ev => {
      event = ev
    })
    let winid = await picker.show({ maxHeight: 3 })
    assert.notStrictEqual(winid, undefined)
    await picker.onInputChar('picker', '<C-f>')
    let info = await nvim.call('getwininfo', [winid])
    assert.notStrictEqual(info[0], undefined)
    await picker.onInputChar('picker', '<C-b>')
    info = await nvim.call('getwininfo', [winid])
    assert.notStrictEqual(info[0], undefined)
    await inputChar('<cr>')
    assert.strictEqual(event, undefined)
  })

  it('should fire selected items on cr', async t => {
    picker = new Picker(nvim, { title: 'title', items: items.concat([{ label: 'three', picked: true }]) })
    let event
    picker.onDidClose(e => {
      event = e
    })
    let winid = await picker.show({ pickerButtons: true })
    assert.notStrictEqual(winid, undefined)
    await inputChar('<cr>')
    assert.deepStrictEqual(event, [2])
  })
})
