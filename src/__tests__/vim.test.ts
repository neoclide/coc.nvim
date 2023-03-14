process.env.VIM_NODE_RPC = '1'
import type { Buffer, Neovim, Tabpage, Window } from '@chemzqm/neovim'
import { CompleteResult, ExtendedCompleteItem } from '../completion/types'
import { sameFile } from '../util/fs'
import type { Helper } from './helper'
// make sure VIM_NODE_RPC take effect first
const helper = require('./helper').default as Helper

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
    await nvim.command('bd!')
  })

  it('should show info', async () => {
    global.REVISION = '2e82259f'
    let handler = helper.plugin.getHandler().workspace
    await handler.showInfo()
    await nvim.command('bd!')
  })

  it('should navigate complete items', async () => {
    helper.updateConfiguration('suggest.noselect', true)
    const sources = require('../completion/sources').default
    let name = Math.random().toString(16).slice(-6)
    let disposable = sources.createSource({
      name,
      doComplete: (_opt): Promise<CompleteResult<ExtendedCompleteItem>> => new Promise(resolve => {
        resolve({
          items: [{ word: 'foo\nbar' }, { word: 'word' }]
        })
      })
    })
    await nvim.input('i')
    nvim.call('coc#start', { source: name }, true)
    await helper.waitPopup()
    await nvim.call('coc#pum#_navigate', [1, 1])
    await helper.waitFor('getline', ['.'], 'foo')
    expect(helper.completion.isActivated).toBe(true)
    await nvim.call('coc#pum#close', ['cancel'])
    await nvim.input('<esc>')
    await helper.waitFor('mode', [], 'n')
    disposable.dispose()
    await nvim.command('silent! %bwipeout!')
  })

  it('should echo message by callTimer', async () => {
    const ui = require('../core/ui')
    ui.echoMessages(nvim, 'message', 'more', 'more')
    await helper.waitValue(async () => {
      let line = await helper.getCmdline()
      return line.includes('message')
    }, true)
  })

  it('should call async', async () => {
    const funcs = require('../core/funcs')
    await nvim.command('normal! gg')
    let res = await funcs.callAsync(nvim, 'line', ['.'])
    expect(res).toBe(1)
  })
})

describe('document', () => {
  it('should patch change', async () => {
    let doc = await helper.createDocument('foo')
    await nvim.command('enew')
    // undefined change
    await doc.patchChange(true)
    await nvim.command(`b ${doc.bufnr}`)
    // no change
    await doc.patchChange(true)
    await nvim.setLine('foo')
    // changed
    await doc.patchChange(true)
    let curr = doc.getline(0, false)
    expect(curr).toBe('foo')
    await nvim.setLine('bar')
    await doc.patchChange()
    await doc.patchChange()
    curr = doc.getline(0, false)
    expect(curr).toBe('bar')
    await nvim.command(`bd! ${doc.bufnr}`)
    expect(doc.attached).toBe(false)
    await doc.patchChange()
    await nvim.command('silent! %bwipeout!')
  })

  it('should fetch content', async () => {
    let doc = await helper.workspace.document
    await nvim.setLine('foo')
    await helper.waitValue(() => doc.getline(0, false), 'foo')
    await nvim.command('silent! %bwipeout!')
    doc.detach()
    await doc._fetchContent()
  })

  it('should synchronize on TextChangedI', async () => {
    let doc = await helper.workspace.document
    await nvim.feedKeys('ifoo', 'int', false)
    await helper.waitValue(() => doc.getline(0, false), 'foo')
    await nvim.command('doautocmd <nomodeline> TextChangedP')
    await nvim.setLine('foo foot f')
    await nvim.eval(`feedkeys("\\<end>", 'int')`)
    await nvim.eval(`feedkeys("\\<C-n>", 'int')`)
    await doc.patchChange()
    await nvim.eval(`feedkeys("\\<C-n>", 'int')`)
    await nvim.eval(`feedkeys("\\<esc>", 'int')`)
    await helper.wait(20)
    let line = await nvim.line
    await helper.waitValue(() => doc.getline(0, false), line)
    await nvim.command('silent! %bwipeout!')
  })
})

describe('client API', () => {
  it('should set current dir', async () => {
    await nvim.setDirectory(__dirname)
    let res = await nvim.call('getcwd') as string
    expect(sameFile(res, __dirname)).toBe(true)
  })

  it('should input characters', async () => {
    await nvim.input('iabc')
    await helper.waitFor('getline', ['.'], 'abc')
    await nvim.input('<esc>')
    await helper.waitFor('mode', [], 'n')
    await nvim.command('bwipeout!')
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

  it('should execute vim script', async () => {
    let output = await nvim.exec(`echo 'foo'\necho 'bar'`, true)
    expect(output).toBe('foo\nbar')
    output = await nvim.exec(`let g:x = '5'\nunlet g:x`)
    expect(output).toBeNull()
  })

  it('should create new buffer', async () => {
    let buf = await nvim.createNewBuffer()
    let valid = await buf.valid
    expect(valid).toBe(true)
    let listed = await buf.getOption('buflisted')
    expect(listed).toBe(0)
    buf = await nvim.createNewBuffer(true, true)
    valid = await buf.valid
    expect(valid).toBe(true)
    listed = await buf.getOption('buflisted')
    expect(listed).toBe(1)
    let buftype = await buf.getOption('buftype')
    expect(buftype).toBe('nofile')
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

  it('should add and delete keymap', async () => {
    nvim.setKeymap('n', ' ', ':normal! G', { nowait: true, script: true })
    let res = await nvim.exec('nmap <space>', true)
    expect(res).toMatch('normal!')
    nvim.deleteKeymap('n', ' ')
    res = await nvim.exec('nmap <sapce>', true)
    expect(res).toMatch('No mapping found')
  })
})

describe('Buffer API', () => {
  let buffer: Buffer
  beforeEach(async () => {
    buffer = await nvim.buffer
  })

  it('should set buffer option', async () => {
    await buffer.setOption('buflisted', false)
    let curr = await buffer.getOption('buflisted')
    expect(curr).toBe(0)
    await buffer.setOption('buflisted', true)
    curr = await buffer.getOption('buflisted')
    expect(curr).toBe(1)
  })

  it('should get changedtick', async () => {
    let changedtick = await buffer.changedtick
    let curr = await nvim.eval('b:changedtick')
    expect(changedtick).toBe(curr)
  })

  it('should add and delete buffer keymap', async () => {
    buffer.setKeymap('n', 'e', ':normal! G', { noremap: true, nowait: true, silent: true })
    let res = await nvim.exec('nmap e', true)
    expect(res).toMatch('normal!')
    buffer.deleteKeymap('n', 'e')
    res = await nvim.exec('nmap e', true)
    expect(res).toMatch('No mapping found')
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
    await nvim.command('bd!')
  })

  it('should set lines', async () => {
    // insert
    await buffer.setLines(['1', '2', '3'], { start: 0, end: 0, strictIndexing: true })
    let lines = await buffer.lines
    expect(lines).toEqual(['1', '2', '3', ''])
    // replace
    await buffer.setLines(['4'], { start: 2, end: -1, strictIndexing: true })
    lines = await buffer.lines
    expect(lines).toEqual(['1', '2', '4'])
    // delete
    await buffer.setLines([], { start: 1, end: 2, strictIndexing: true })
    lines = await buffer.lines
    expect(lines).toEqual(['1', '4'])
    await nvim.command('bd!')
  })

  it('should set name', async () => {
    await buffer.setName('foo')
    let name = await buffer.name
    expect(name).toBe('foo')
    await nvim.command('bd!')
  })

  it('should change buffer variable', async () => {
    await buffer.setVar('foo', 'bar', false)
    let curr = await buffer.getVar('foo')
    expect(curr).toBe('bar')
    buffer.deleteVar('foo')
    curr = await buffer.getVar('foo')
    expect(curr).toBeNull()

    // another non-current buffer
    const buf2 = await nvim.createNewBuffer()
    await buf2.setVar('foo', 'qux', false)
    let curr2 = await buf2.getVar('foo')
    expect(curr2).toBe('qux')
    buf2.deleteVar('foo')
    curr = await buf2.getVar('foo')
    expect(curr).toBeNull()
  })
})

describe('Window API', () => {
  let win: Window
  beforeEach(async () => {
    win = await nvim.window
  })

  it('should get buffer of window', async () => {
    let buf = await win.buffer
    let curr = await nvim.buffer
    expect(buf.id).toBe(curr.id)
  })

  it('should set buffer', async () => {
    let bufnr = await nvim.call('bufadd', ['foo']) as number
    await nvim.call('bufload', [bufnr])
    await win.setBuffer(nvim.createBuffer(bufnr))
    let buf = await win.buffer
    expect(buf.id).toBe(bufnr)
    await nvim.command('silent! %bwipeout!')
  })

  it('should get position', async () => {
    await nvim.command('sp')
    let res = await win.position
    expect(res[0]).toBeGreaterThan(0)
    expect(res[1]).toBe(0)
    await nvim.command('only!')
  })

  it('should get and set height', async () => {
    let h = await win.height
    await win.setHeight(3)
    let curr = await win.height
    expect(curr).toBe(3)
    await win.setHeight(h)
  })

  it('should get and set width', async () => {
    await nvim.command('vs')
    await win.setWidth(5)
    let curr = await win.width
    expect(curr).toBe(5)
    await nvim.command('only!')
  })

  it('should get and set cursor', async () => {
    let buf = await nvim.buffer
    await buf.setLines(['1', '2', '3', '4'], { start: 0, end: -1, strictIndexing: false })
    await win.setCursor([3, 1])
    let cursor = await win.cursor
    expect(cursor).toEqual([3, 0])
    await nvim.command('bd!')
  })

  it('should get and set option', async () => {
    let relative = await win.getOption('relativenumber')
    expect(relative).toBe(0)
    await win.setOption('relativenumber', true)
    relative = await win.getOption('relativenumber')
    expect(relative).toBe(1)
    await win.setOption('relativenumber', false)
    await expect(async () => {
      await win.getOption('not_exists')
    }).rejects.toThrow('Invalid option name')
  })

  it('should get and set var', async () => {
    await win.setVar('foo', 'bar')
    let curr = await win.getVar('foo')
    expect(curr).toBe('bar')
    win.deleteVar('foo')
    curr = await win.getVar('foo')
    expect(curr).toBe(null)
  })

  it('should check window is valid', async () => {
    let valid = await win.valid
    expect(valid).toBe(true)
    let tab = await win.tabpage
    let nr = await tab.number
    expect(nr).toBe(1)
    let n = await win.number
    expect(n).toBe(1)
    await nvim.command('vs')
    await nvim.call('win_gotoid', [win.id])
    await win.close(true)
    valid = await win.valid
    expect(valid).toBe(false)
    await nvim.command('only!')
  })
})

describe('Popup', () => {
  it('should works for popup window', async () => {
    let winid = await nvim.call('popup_create', [['foo', 'bar'], {}]) as number
    expect(winid).toBeGreaterThan(1000)
    let win = nvim.createWindow(winid)
    let buf = await win.buffer
    expect(buf.id).toBeGreaterThan(0)
    let pos = await win.position
    expect(typeof pos[0]).toBe('number')
    expect(typeof pos[1]).toBe('number')
    await win.setHeight(10)
    let height = await win.height
    expect(height).toBe(10)
    await win.setWidth(20)
    let width = await win.width
    expect(width).toBe(20)
    await win.setCursor([1, 2])
    let cur = await win.cursor
    expect(cur).toEqual([1, 2])
    await win.setOption('relativenumber', true)
    // different on neovim which returns true and false
    let option = await win.getOption('relativenumber')
    expect(option).toBe(1)
    await win.setVar('foo', 'bar', false)
    let val = await win.getVar('foo')
    expect(val).toBe('bar')
    win.deleteVar('foo')
    val = await win.getVar('foo')
    expect(val).toBeNull()
    let valid = await win.valid
    expect(valid).toBe(true)
    // not work on vim
    let num = await win.number
    expect(num).toBe(0)
    let tabpage = await win.tabpage
    expect(tabpage.id).toBeGreaterThan(0)
    await win.close(true)
    await nvim.call('popup_clear', [])
  })
})

describe('Tabpage API', () => {
  let tab: Tabpage
  beforeEach(async () => {
    tab = await nvim.tabpage
  })

  it('should get window list', async () => {
    await nvim.command('vs')
    let wins = await tab.windows
    expect(wins.length).toBe(2)
    await nvim.command('only!')
  })

  it('should get and set var', async () => {
    await tab.setVar('foo', 'bar')
    let curr = await tab.getVar('foo')
    expect(curr).toBe('bar')
    tab.deleteVar('foo')
    curr = await tab.getVar('foo')
    expect(curr).toBe(null)
  })

  it('should get current window', async () => {
    let valid = await tab.valid
    expect(valid).toBe(true)
    let win = await tab.window
    let curr = await nvim.call('win_getid')
    expect(win.id).toBe(curr)
  })
})
