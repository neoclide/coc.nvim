import { Neovim } from '@chemzqm/neovim'
import { Position, Range } from 'vscode-languageserver-types'
import * as ui from '../../core/ui'
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
  await helper.reset()
})

describe('getCursorPosition()', () => {
  it('should get cursor position', async () => {
    await nvim.call('cursor', [1, 1])
    let res = await ui.getCursorPosition(nvim)
    expect(res).toEqual({
      line: 0,
      character: 0
    })
  })
})

describe('moveTo()', () => {
  it('should moveTo position', async () => {
    await nvim.setLine('foo')
    await ui.moveTo(nvim, Position.create(0, 1), true)
    let res = await ui.getCursorPosition(nvim)
    expect(res).toEqual({ line: 0, character: 1 })
  })
})

describe('getCursorScreenPosition()', () => {
  it('should get cursor screen position', async () => {
    let res = await ui.getCursorScreenPosition(nvim)
    expect(res).toBeDefined()
    expect(typeof res.row).toBe('number')
    expect(typeof res.col).toBe('number')
  })
})

describe('createFloatFactory()', () => {
  it('should create FloatFactory', async () => {
    let f = ui.createFloatFactory(nvim, { border: true, autoHide: false, breaks: false }, { close: true })
    await f.show([{ content: 'shown', filetype: 'txt' }])
    let activated = await f.activated()
    expect(activated).toBe(true)
    expect(f.window != null).toBe(true)
    let win = await helper.getFloat()
    expect(win).toBeDefined()
    let id = await nvim.call('coc#float#get_related', [win.id, 'border', 0]) as number
    expect(id).toBeGreaterThan(0)
    id = await nvim.call('coc#float#get_related', [win.id, 'close', 0]) as number
    expect(id).toBeGreaterThan(0)
    await f.show([{ content: 'shown', filetype: 'txt' }], { offsetX: 10 })
    let curr = await helper.getFloat()
    expect(curr.id).toBe(win.id)
  })
})

describe('showMessage()', () => {
  it('should showMessage on vim', async () => {
    ui.echoMessages(nvim, 'my message', 'more', 'more')
    await helper.wait(50)
    let cmdline = await helper.getCmdline()
    expect(cmdline).toMatch(/my message/)
  })

  it('should get messageLevel', () => {
    let level = ui.toMessageLevel('error')
    expect(level).toBe(ui.MessageLevel.Error)
    level = ui.toMessageLevel('warning')
    expect(level).toBe(ui.MessageLevel.Warning)
    level = ui.toMessageLevel('more')
    expect(level).toBe(ui.MessageLevel.More)
  })
})

describe('getSelection()', () => {
  it('should return null when no selection exists', async () => {
    let res = await ui.getSelection(nvim, 'v')
    expect(res).toBeNull()
  })

  it('should return range for line selection', async () => {
    await nvim.setLine('foo')
    await nvim.input('V')
    await nvim.input('<esc>')
    let res = await ui.getSelection(nvim, 'V')
    expect(res).toEqual({ start: { line: 0, character: 0 }, end: { line: 1, character: 0 } })
  })

  it('should return range of current line', async () => {
    await nvim.command('normal! gg')
    let res = await ui.getSelection(nvim, 'currline')
    expect(res).toEqual(Range.create(0, 0, 1, 0))
  })
})

describe('selectRange()', () => {
  it('should select range #1', async () => {
    await nvim.call('setline', [1, ['foo', 'b']])
    await nvim.command('set selection=inclusive')
    await nvim.command('set virtualedit=onemore')
    await ui.selectRange(nvim, Range.create(0, 0, 1, 1), true)
    await nvim.input('<esc>')
    let res = await ui.getSelection(nvim, 'v')
    expect(res).toEqual(Range.create(0, 0, 1, 1))
  })

  it('should select range #2', async () => {
    await nvim.call('setline', [1, ['foo', 'b']])
    await ui.selectRange(nvim, Range.create(0, 0, 1, 0), true)
    await nvim.input('<esc>')
    let res = await ui.getSelection(nvim, 'v')
    expect(res).toEqual(Range.create(0, 0, 0, 3))
  })

  it('should select range #3', async () => {
    await ui.selectRange(nvim, Range.create(0, 0, 0, 0), true)
    let m = await nvim.mode
    expect(m.mode).toBe('v')
    await nvim.input('<esc>')
    await ui.selectRange(nvim, Range.create(0, 0, 0, 1), true)
  })
})
