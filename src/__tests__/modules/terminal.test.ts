import * as shared from '../sharedUtil'
import { nvim } from '../sharedUtil'
import { TerminalModel } from '../../model/terminal'
import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'

let terminal: TerminalModel
before(async () => {
  terminal = new TerminalModel('sh', [], nvim)
  await terminal.start(import.meta.dirname, { COC_TERMINAL: `option '-term'` })
})

after(() => {
  terminal.dispose()
})

describe('terminal properties', () => {
  it('should get name', t => {
    let name = terminal.name
    assert.strictEqual(name, 'sh')
  })

  it('should have correct cwd and env', async t => {
    let bufnr = terminal.bufnr
    terminal.sendText('echo $PWD')
    await shared.waitFor('eval', [`join(getbufline(${bufnr},1,'$'),'\n')`], /\S/)
    let lines = await nvim.call('getbufline', [bufnr, 1, '$']) as string[]
    assert.ok(lines[0].trim().length > 0)
    terminal.sendText('echo $COC_TERMINAL')
    await shared.waitFor('eval', [`join(getbufline(${bufnr},1,'$'),'\n')`], /option '-term'/)
    lines = await nvim.call('getbufline', [bufnr, 1, '$']) as string[]
    assert.strictEqual(lines.includes(`option '-term'`), true)
    terminal.onExit(-1)
  })

  it('should get pid', async t => {
    let pid = await terminal.processId
    assert.strictEqual(typeof pid, 'number')
  })

  it('should hide terminal window', async t => {
    await terminal.hide()
    let winnr = await nvim.call('bufwinnr', terminal.bufnr)
    assert.strictEqual(winnr, -1)
  })

  it('should show terminal window', async t => {
    await terminal.show()
    let winnr = await nvim.call('bufwinnr', terminal.bufnr)
    assert.strictEqual(winnr != -1, true)
  })

  it('should  not throw when not shown', async t => {
    let terminal = new TerminalModel('sh', [], nvim)
    t.after(() => terminal.dispose())
    terminal.sendText('text')
    await terminal.start(import.meta.dirname, {})
    await terminal.show()
    await terminal.show()
  })
})
