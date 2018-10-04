import { Neovim } from '@chemzqm/neovim'
import OutputChannel from '../../model/outputChannel'
import { createNvim, wait } from '../../util'

let nvim: Neovim
beforeEach(() => {
  nvim = createNvim()
})

afterEach(() => {
  nvim.quit()
})

describe('OutputChannel', () => {
  test('outputChannel.isShown()', async () => {
    let c = new OutputChannel('test', nvim)
    let shown = await c.isShown()
    expect(shown).toBe(false)
    c.show()
    await wait(100)
    shown = await c.isShown()
    expect(shown).toBe(true)
  })

  test('outputChannel.show(true)', async () => {
    let c = new OutputChannel('test', nvim)
    let bufnr = (await nvim.buffer).id
    c.show(true)
    await wait(100)
    let nr = (await nvim.buffer).id
    expect(bufnr).toBe(nr)
  })

  test('outputChannel.show(false)', async () => {
    let c = new OutputChannel('test', nvim)
    let bufnr = (await nvim.buffer).id
    c.show()
    await wait(100)
    let nr = (await nvim.buffer).id
    expect(bufnr).toBeLessThan(nr)
  })

  test('outputChannel.appendLine()', async () => {
    let c = new OutputChannel('test', nvim)
    c.show(false)
    await wait(100)
    let buf = await nvim.buffer
    c.appendLine('foo')
    let lines = await buf.getLines({ start: 0, end: -1, strictIndexing: false })
    expect(lines).toContain('foo')
  })

  test('outputChannel.append()', async () => {
    let c = new OutputChannel('test', nvim)
    c.show(false)
    await wait(100)
    let buf = await nvim.buffer
    c.append('foo')
    let lines = await buf.getLines({ start: 0, end: -1, strictIndexing: false })
    expect(lines).toContain('foo')
  })

  test('outputChannel.clear()', async () => {
    let c = new OutputChannel('test', nvim)
    c.show(false)
    await wait(30)
    let buf = await nvim.buffer
    c.append('foo')
    await wait(30)
    c.clear()
    let lines = await buf.getLines({ start: 0, end: -1, strictIndexing: false })
    let content = lines.join('')
    expect(content).toBe('')
  })
})
