import { Neovim } from '@chemzqm/neovim'
import OutputChannel from '../../model/outputChannel'
import { wait } from '../../util'
import helper from '../helper'

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterEach(async () => {
  await helper.reset()
})

afterAll(async () => {
  await helper.shutdown()
})

describe('OutputChannel', () => {
  test('without nvim', () => {
    let o = new OutputChannel('f')
    o.appendLine('foo')
    o.append('bar')
    o.show()
    o.hide()
    o.clear()
  })

  test('channel name with special characters', async () => {
    let ch = new OutputChannel("a@b 'c", nvim)
    ch.show(false, 'edit')
    let bufname = await nvim.call('bufname', '%')
    expect(bufname).toBe('output:///a@b%20\'c')
    let bufnr = await nvim.call('bufnr', ['%'])
    ch.hide()
    await helper.wait(10)
    let loaded = await nvim.call('bufloaded', [bufnr])
    expect(loaded).toBe(0)
    ch.dispose()
  })

  test('outputChannel.show(true)', async () => {
    await nvim.setLine('foo')
    let c = new OutputChannel('0', nvim)
    let bufnr = (await nvim.buffer).id
    c.show(true)
    await helper.waitFor('bufnr', ['%'], bufnr)
    c.hide()
    c.clear(1)
    c.dispose()
    c.append('')
    c.appendLine('')
  })

  test('outputChannel.keep()', async () => {
    await nvim.setLine('foo')
    let c = new OutputChannel('clear', nvim)
    c.appendLine('foo')
    c.appendLine('bar')
    c.show()
    await helper.wait(10)
    c.clear(2)
    let lines = await nvim.call('getbufline', ['output:///clear', 1, '$']) as string[]
    expect(lines.includes('bar')).toBe(true)
  })

  test('outputChannel.show(false)', async () => {
    let c = new OutputChannel('1', nvim)
    let bufnr = (await nvim.buffer).id
    c.show()
    await wait(100)
    let nr = (await nvim.buffer).id
    expect(bufnr).toBeLessThan(nr)
  })

  test('outputChannel.appendLine()', async () => {
    let c = new OutputChannel('2', nvim)
    c.show()
    await wait(100)
    let buf = await nvim.buffer
    c.appendLine('foo')
    await helper.waitFor('eval', [`join(getbufline(${buf.id},1,'$'),'\n')`], /foo/)
  })

  test('outputChannel.append()', async () => {
    let c = new OutputChannel('3', nvim)
    c.show(false)
    await wait(60)
    c.append('foo')
    c.append('bar')
    await wait(50)
    let buf = await nvim.buffer
    await helper.waitFor('eval', [`join(getbufline(${buf.id},1,'$'),'\n')`], /foo/)
  })

  test('outputChannel.clear()', async () => {
    let c = new OutputChannel('4', nvim)
    c.show(false)
    await wait(30)
    let buf = await nvim.buffer
    c.appendLine('foo')
    c.appendLine('bar')
    await wait(30)
    c.clear()
    await wait(30)
    let lines = await buf.lines
    let content = lines.join('')
    expect(content).toBe('')
  })
})
