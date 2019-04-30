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

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  await nvim.setVar('coc_jump_locations', locations)
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await manager.cancel()
  await helper.reset()
})

describe('list commands', () => {
  it('should highlight ranges', async () => {
    await manager.start(['--normal', '--auto-preview', 'location'])
    await helper.wait(300)
    await nvim.command('wincmd k')
    let name = await nvim.eval('bufname("%")')
    expect(name).toMatch(__filename)
    let matches = await nvim.call('getmatches')
    let find = matches.find(o => o.group == 'Search')
    expect(find).toBeDefined()
  })

  it('should change highlight on cursor move', async () => {
    await manager.start(['--normal', '--auto-preview', 'location'])
    await helper.wait(300)
    await nvim.command('exe 2')
    let bufnr = await nvim.eval('bufnr("%")')
    await events.fire('CursorMoved', [bufnr, [2, 1]])
    await helper.wait(300)
    await nvim.command('wincmd k')
    let matches = await nvim.call('getmatches')
    let find = matches.find(o => o.group == 'Search')
    expect(find.pos1).toEqual([3, 1, 6])
  })

  it('should highlight multiple line range', async () => {
    await manager.start(['--normal', '--auto-preview', 'location'])
    await helper.wait(300)
    await nvim.command('exe 3')
    let bufnr = await nvim.eval('bufnr("%")')
    await events.fire('CursorMoved', [bufnr, [2, 1]])
    await helper.wait(300)
    await nvim.command('wincmd k')
    let matches = await nvim.call('getmatches')
    expect(matches.filter(o => o.group == 'Search').length).toBe(2)
  })
})
