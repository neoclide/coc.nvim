/* tslint:disable:no-console */
import { Neovim } from '@chemzqm/neovim'
import helper from '../helper'
import TerminalModel from '../../model/terminal'

let nvim: Neovim
let terminal: TerminalModel
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  terminal = new TerminalModel('sh', [], nvim)
  await terminal.start()
})

afterAll(async () => {
  terminal.dispose()
  await helper.shutdown()
})

describe('terminal properties', () => {
  it('should get name', () => {
    let name = terminal.name
    expect(name).toBe('sh')
  })

  it('should get pid', async () => {
    let pid = await terminal.processId
    expect(typeof pid).toBe('number')
  })

  it('should hide terminal window', async () => {
    await terminal.hide()
    let winnr = await nvim.call('bufwinnr', terminal.bufnr)
    expect(winnr).toBe(-1)
  })

  it('should show terminal window', async () => {
    await terminal.show()
    let winnr = await nvim.call('bufwinnr', terminal.bufnr)
    expect(winnr != -1).toBe(true)
  })

  it('should send text', async () => {
    terminal.sendText('ls')
    await helper.wait(100)
    let buf = nvim.createBuffer(terminal.bufnr)
    let lines = await buf.lines
    expect(lines.join('\n')).toMatch('vimrc')
  })
})
