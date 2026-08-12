import { Neovim } from '@chemzqm/neovim'
import helper from '../helper'
import { TerminalModel } from '../../model/terminal'

let nvim: Neovim
let terminal: TerminalModel
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  terminal = new TerminalModel('sh', [], nvim)
  await terminal.start(__dirname, { COC_TERMINAL: `option '-term'` })
})

afterAll(async () => {
  terminal.dispose()
  await helper.shutdown()
})

describe('terminal properties', () => {
  it('should get name', () => {
    let name = terminal.name
    assert.strictEqual(name, 'sh')
  })

  it('should have correct cwd and env', async () => {
    let bufnr = terminal.bufnr
    terminal.sendText('echo $PWD')
    await helper.waitFor('eval', [`join(getbufline(${bufnr},1,'$'),'\n')`], /\S/)
    let lines = await nvim.call('getbufline', [bufnr, 1, '$']) as string[]
    assert.ok((lines[0].trim().length) > (0))
    terminal.sendText('echo $COC_TERMINAL')
    await helper.waitFor('eval', [`join(getbufline(${bufnr},1,'$'),'\n')`], /option '-term'/)
    lines = await nvim.call('getbufline', [bufnr, 1, '$']) as string[]
    assert.strictEqual(lines.includes(`option '-term'`), true)
    terminal.onExit(-1)
  })

  it('should get pid', async () => {
    let pid = await terminal.processId
    assert.strictEqual(typeof pid, 'number')
  })

  it('should hide terminal window', async () => {
    await terminal.hide()
    let winnr = await nvim.call('bufwinnr', terminal.bufnr)
    assert.strictEqual(winnr, -1)
  })

  it('should show terminal window', async () => {
    await terminal.show()
    let winnr = await nvim.call('bufwinnr', terminal.bufnr)
    assert.strictEqual(winnr != -1, true)
  })

  it('should  not throw when not shown', async () => {
    let terminal = new TerminalModel('sh', [], nvim)
    terminal.sendText('text')
    await terminal.start(__dirname, {})
    await terminal.show()
    await terminal.show()
  })
})
