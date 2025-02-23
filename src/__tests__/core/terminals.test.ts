import { Neovim } from '@chemzqm/neovim'
import os from 'os'
import path from 'path'
import which from 'which'
import Terminals from '../../core/terminals'
import window from '../../window'
import { TerminalModel } from '../../model/terminal'
import helper from '../helper'
import { v4 as uuid } from 'uuid'

let nvim: Neovim
let terminals: Terminals

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  terminals = new Terminals()
})

afterEach(() => {
  terminals.reset()
})

afterAll(async () => {
  await helper.shutdown()
})

describe('create terminal', () => {
  it('should use cleaned env', async () => {
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${uuid()}`,
      shellPath: which.sync('bash'),
      strictEnv: true
    })
    await helper.wait(10)
    terminal.sendText(`echo $NODE_ENV`, true)
    await helper.wait(50)
    let buf = nvim.createBuffer(terminal.bufnr)
    let lines = await buf.lines
    expect(lines.includes('test')).toBe(false)
  })

  it('should use custom shell command', async () => {
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${uuid()}`,
      shellPath: which.sync('bash')
    })
    let bufnr = terminal.bufnr
    let bufname = await nvim.call('bufname', [bufnr]) as string
    expect(bufname.includes('bash')).toBe(true)
  })

  it('should use custom cwd', async () => {
    let basename = path.basename(os.tmpdir())
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${uuid()}`,
      cwd: os.tmpdir()
    })
    let bufnr = terminal.bufnr
    let bufname = await nvim.call('bufname', [bufnr]) as string
    expect(bufname.includes(basename)).toBe(true)
  })

  it('should have exit code', async () => {
    let exitStatus
    terminals.onDidCloseTerminal(terminal => {
      exitStatus = terminal.exitStatus
    })
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${uuid()}`,
      shellPath: which.sync('bash'),
      strictEnv: true
    })
    terminal.sendText('exit', true)
    await helper.waitFor('bufloaded', [terminal.bufnr], 0)
    await helper.waitValue(() => {
      return exitStatus != null
    }, true)
    expect(exitStatus.code).toBeDefined()
  })

  it('should return false on show when buffer unloaded', async () => {
    let model = new TerminalModel('bash', [], nvim)
    await model.start()
    expect(model.bufnr).toBeDefined()
    await nvim.command(`bd! ${model.bufnr}`)
    let res = await model.show()
    expect(res).toBe(false)
  })

  it('should not throw when show & hide disposed terminal', async () => {
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${uuid()}`,
      shellPath: which.sync('bash')
    })
    terminal.dispose()
    await terminal.show()
    await terminal.hide()
  })

  it('should show terminal on current window', async () => {
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${uuid()}`,
      shellPath: which.sync('bash')
    })
    let winid = await nvim.call('bufwinid', [terminal.bufnr])
    expect(winid).toBeGreaterThan(0)
    await nvim.call('win_gotoid', [winid])
    await terminal.show()
  })

  it('should show terminal that shown', async () => {
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${uuid()}`,
      shellPath: which.sync('bash')
    })
    let res = await terminal.show(true)
    expect(res).toBe(true)
  })

  it('should show hidden terminal', async () => {
    let terminal = await terminals.createTerminal(nvim, {
      name: `test-${uuid()}`,
      shellPath: which.sync('bash')
    })
    await terminal.hide()
    await terminal.show()
  })

  it('should create terminal', async () => {
    let terminal = await window.createTerminal({
      name: `test-${uuid()}`,
    })
    expect(terminal).toBeDefined()
    expect(terminal.processId).toBeDefined()
    expect(terminal.name).toBeDefined()
    terminal.dispose()
    await helper.wait(30)
    expect(terminal.bufnr).toBeUndefined()
  })
})
