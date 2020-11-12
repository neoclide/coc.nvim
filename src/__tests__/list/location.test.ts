import { Neovim } from '@chemzqm/neovim'
import manager from '../../list/manager'
import { Range } from 'vscode-languageserver-protocol'
import events from '../../events'
import helper from '../helper'

let nvim: Neovim
const locations: any[] = [{
  filename: __filename,
  range: Range.create(0, 0, 0, 6),
  text: 'foo'
}, {
  filename: __filename,
  range: Range.create(2, 0, 2, 6),
  text: 'Bar'
}, {
  filename: __filename,
  range: Range.create(3, 0, 4, 6),
  text: 'multiple'
}]

let ns: number
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  ns = await nvim.createNamespace('coc-list') as number
  await nvim.setVar('coc_jump_locations', locations)
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await manager.reset()
  await helper.reset()
  await helper.wait(100)
})

describe('list commands', () => {
  it('should highlight ranges', async () => {
    await manager.start(['--normal', '--auto-preview', 'location'])
    await manager.session.ui.ready
    await helper.wait(200)
    manager.prompt.cancel()
    await nvim.command('wincmd k')
    let name = await nvim.eval('bufname("%")')
    expect(name).toMatch('location.test.ts')
    let buf = await nvim.buffer
    let res = await nvim.call('nvim_buf_get_extmarks', [buf.id, ns, 0, -1, {}]) as [number, number, number][]
    expect(res.length).toBe(1)
  })

  it('should change highlight on cursor move', async () => {
    await manager.start(['--normal', '--auto-preview', 'location'])
    await manager.session.ui.ready
    await helper.wait(200)
    await nvim.command('exe 2')
    let bufnr = await nvim.eval('bufnr("%")')
    await events.fire('CursorMoved', [bufnr, [2, 1]])
    await helper.wait(300)
    await nvim.command('wincmd k')
    let buf = await nvim.buffer
    let res = await nvim.call('nvim_buf_get_extmarks', [buf.id, ns, 0, -1, {}]) as [number, number, number][]
    expect(res.length).toBe(1)
    expect(res[0]).toEqual([2, 2, 0])
  })

  it('should highlight multiple line range', async () => {
    await manager.start(['--normal', '--auto-preview', 'location'])
    await manager.session.ui.ready
    await helper.wait(200)
    await nvim.command('exe 3')
    let bufnr = await nvim.eval('bufnr("%")')
    await events.fire('CursorMoved', [bufnr, [2, 1]])
    await helper.wait(300)
    await nvim.command('wincmd k')
    let buf = await nvim.buffer
    let res = await nvim.call('nvim_buf_get_extmarks', [buf.id, ns, 0, -1, {}]) as [number, number, number][]
    expect(res.length).toBe(2)
    expect(res[0]).toEqual([2, 3, 0])
  })
})
