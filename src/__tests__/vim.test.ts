process.env.VIM_NODE_RPC = '1'
import type { Buffer, Neovim } from '@chemzqm/neovim'
import type { Helper } from './helper'
import type { Window } from '../window'
import { sameFile } from '../util/fs'
// make sure VIM_NODE_RPC take effect first
const helper = require('./helper').default as Helper
const window = require('../window').default as Window

let nvim: Neovim
beforeAll(async () => {
  await helper.setupVim()
  nvim = helper.workspace.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

describe('vim api', () => {
  it('should start server', async () => {
    await nvim.setLine('foobar')
    let buf = await nvim.buffer
    let lines = await buf.lines
    expect(lines).toEqual(['foobar'])
  })

  it('should show message', async () => {
    window.showMessage('msg')
    let env = helper.workspace.env
    await helper.waitValue(async () => {
      let line = await helper.getCmdline(env.lines - 1)
      return line.includes('msg')
    }, true)
  })
})

describe('client API', () => {
  it('should set current dir', async () => {
    await nvim.setDirectory(__dirname)
    let res = await nvim.call('getcwd') as string
    expect(sameFile(res, __dirname)).toBe(true)
  })

  it('should set var', async () => {
    await nvim.setVar('foo', 'bar', false)
    let res = await nvim.getVar('foo')
    expect(res).toBe('bar')
  })

  it('should del var', async () => {
    await expect(async () => {
      nvim.pauseNotification()
      nvim.deleteVar('not_exists')
      await nvim.resumeNotification()
    }).rejects.toThrow(Error)
    await nvim.setVar('foo', 'bar', false)
    nvim.deleteVar('foo')
    let res = await nvim.getVar('foo')
    expect(res).toBeNull()
  })

  it('should set option', async () => {
    await nvim.setOption('emoji', false)
    let res = await nvim.getOption('emoji')
    // neovim return false for Boolean option.
    expect(res).toBe(0)
  })

  it('should set current buffer', async () => {
    let bufnr = await nvim.call('bufadd', ['foo']) as number
    await nvim.call('bufload', [bufnr])
    await nvim.setBuffer(nvim.createBuffer(bufnr))
    let b = await nvim.buffer
    expect(b.id).toBe(bufnr)
    await nvim.command('silent! %bwipeout!')
  })

  it('should set current window', async () => {
    let winid = await nvim.call('win_getid') as number
    await nvim.command('sp | sp | sp')
    let win = nvim.createWindow(winid)
    await nvim.setWindow(win)
    let curr = await nvim.call('win_getid') as number
    expect(curr).toBe(winid)
    await nvim.command('only!')
  })

  it('should set current tabpage', async () => {
    let tab = await nvim.tabpage
    await nvim.command('tabe')
    await nvim.setTabpage(tab)
    let nr = await nvim.call('tabpagenr')
    expect(nr).toBe(tab.id)
    let tabpages = await nvim.tabpages
    expect(tabpages.length).toBe(2)
    await nvim.command('tabonly!')
  })

  it('should list windows', async () => {
    let wins = await nvim.windows
    expect(Array.isArray(wins)).toBe(true)
  })

  it('should call atomic', async () => {
    await expect(async () => {
      nvim.pauseNotification()
      nvim.call('abc', [], true)
      await nvim.resumeNotification()
    }).rejects.toThrow(Error)
  })

  it('should call dict function', async () => {
    // eslint-disable-next-line @typescript-eslint/await-thenable
    let res = await nvim.callDictFunction({ key: 1 }, 'DictAdd')
    expect(res).toBe(2)
  })

  it('should execute command', async () => {
    await nvim.command('sp')
    let wins = await nvim.windows
    expect(wins.length).toBe(2)
    await nvim.command('only')
    wins = await nvim.windows
    expect(wins.length).toBe(1)
  })

  it('should eval', async () => {
    let res = await nvim.eval('1 + 1')
    expect(res).toBe(2)
  })

  it('should get api info', async () => {
    let info = await nvim.apiInfo
    expect(typeof info[0]).toBe('number')
  })

  it('should get buffer list', async () => {
    let bufs = await nvim.buffers
    expect(typeof bufs[0].id).toBe('number')
  })

  it('should feedkeys', async () => {
    await nvim.setLine('foo')
    await nvim.feedKeys('$', 'int', false)
    let col = await nvim.call('col', ['.'])
    expect(col).toBe(3)
    await nvim.command('bd!')
  })

  it('should list runtimepath', async () => {
    let res = await nvim.runtimePaths
    expect(Array.isArray(res)).toBe(true)
  })

  it('should get command output', async () => {
    let res = await nvim.commandOutput('version')
    expect(res).toMatch(/VIM/)
  })

  it('should get line & set line', async () => {
    await nvim.setLine('foo')
    let curr = await nvim.getLine()
    expect(curr).toBe('foo')
    await nvim.deleteCurrentLine()
    curr = await nvim.getLine()
    expect(curr).toBe('')
  })

  it('should get var', async () => {
    await nvim.setVar('foo', 'bar')
    let res = await nvim.getVar('foo')
    expect(res).toBe('bar')
    nvim.deleteVar('foo')
    res = await nvim.getVar('foo')
    expect(res).toBeNull()
  })

  it('should get vvar', async () => {
    await nvim.command('let v:errmsg = "foo"')
    let res = await nvim.getVvar('errmsg')
    expect(res).toBe('foo')
  })

  it('should get current buffer, window, tabpage', async () => {
    expect(await nvim.buffer).toBeDefined()
    expect(await nvim.window).toBeDefined()
    expect(await nvim.tabpage).toBeDefined()
  })

  it('should get strwidth', async () => {
    let w = await nvim.strWidth('foo')
    expect(w).toBe(3)
  })

  it('should out_write', async () => {
    nvim.outWrite('foo')
    nvim.outWriteLine('bar')
    let env = helper.workspace.env
    let line = await helper.getCmdline(env.lines - 1)
    expect(line).toBe('foobar')
  })

  it('should err_write', async () => {
    nvim.errWrite('foo')
    nvim.errWriteLine('bar')
    let env = helper.workspace.env
    let line = await helper.getCmdline(env.lines - 1)
    expect(line).toBe('foobar')
  })

  it('should create namespace', async () => {
    let ns = await nvim.createNamespace('foo')
    expect(typeof ns).toBe('number')
    let namespace = await nvim.createNamespace('foo')
    expect(ns).toBe(namespace)
  })
})

describe('Buffer API', () => {
  let buffer: Buffer
  beforeEach(async () => {
    buffer = await nvim.buffer
  })

  it('should set option', async () => {
    await buffer.setOption('buflisted', false)
    let curr = await nvim.eval('&buflisted')
    expect(curr).toBe(0)
    await buffer.setOption('buflisted', true)
    curr = await nvim.eval('&buflisted')
    expect(curr).toBe(1)
  })

  it('should get changedtick', async () => {
    let changedtick = await buffer.changedtick
    let curr = await nvim.eval('b:changedtick')
    expect(changedtick).toBe(curr)
  })

  it('should check buffer valid', async () => {
    let valid = await buffer.valid
    expect(valid).toBe(true)
    let buf = nvim.createBuffer(99)
    valid = await buf.valid
    expect(valid).toBe(false)
  })

  it('should get mark', async () => {
    await buffer.append(['', '', ''])
    let c = await buffer.length
    expect(c).toBe(4)
    await nvim.command(`normal! Gm"`)
    let m = await buffer.mark('"')
    expect(m).toEqual([4, 0])
    await nvim.command('bd!')
  })

  it('should add highlight', async () => {
    let ns = await nvim.createNamespace('test') as number
    await nvim.setLine('foo')
    let buf = await nvim.buffer
    await buf.addHighlight({
      hlGroup: 'MoreMsg',
      line: 0,
      colStart: 0,
      colEnd: 3,
      srcId: ns
    })
    let curr = await buf.getHighlights('test')
    expect(curr).toEqual([{ hlGroup: 'MoreMsg', lnum: 0, colStart: 0, colEnd: 3, id: 1001 }])
    buf.clearNamespace(ns)
    curr = await buf.getHighlights('test')
    expect(curr).toEqual([])
  })

  it('should get line count', async () => {
    await buffer.append(['', '', '', ''])
    await nvim.command('tabe')
    let n = await buffer.length
    expect(n).toBe(5)
    await nvim.command('silent! %bwipeout!')
  })

  it('should get lines', async () => {
    await buffer.setLines(['1', '2', '3', '4'], { start: 0, end: -1, strictIndexing: false })
    let lines = await buffer.lines
    expect(lines).toEqual(['1', '2', '3', '4'])
    lines = await buffer.getLines({ start: 0, end: 1, strictIndexing: false })
    expect(lines).toEqual(['1'])
    lines = await buffer.getLines({ start: -2, end: -1, strictIndexing: false })
    expect(lines).toEqual(['4'])
  })
})
