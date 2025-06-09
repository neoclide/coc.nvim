process.env.VIM_NODE_RPC = '1'
import type { Buffer, Neovim, Tabpage, Window } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import util from 'util'
import { v4 as uuid } from 'uuid'
import { Position, Range, TextEdit, type Disposable } from 'vscode-languageserver-protocol'
import type { CompleteResult, ExtendedCompleteItem } from '../completion/types'
import events from '../events'
import type { VirtualTextItem } from '../handler/inlayHint/buffer'
import { sameFile } from '../util/fs'
import { type Helper } from './helper'
// make sure VIM_NODE_RPC take effect first
const helper = require('./helper').default as Helper

function disposeAll(disposables: Disposable[]): void {
  while (disposables.length) {
    const item = disposables.pop()
    item?.dispose()
  }
}

const disposables: Disposable[] = []
let nvim: Neovim
let featuredPropList = false
beforeAll(async () => {
  await helper.setupVim()
  nvim = helper.workspace.nvim
  // for text_padding_left of property
  if (helper.workspace.has('patch-9.0.1782')) {
    featuredPropList = true
  }
})

afterEach(() => {
  disposeAll(disposables)
})

afterAll(async () => {
  await helper.shutdown()
})

async function createTmpFile(content: string, disposables?: Disposable[]): Promise<string> {
  let tmpFolder = path.join(os.tmpdir(), `coc-${process.pid}`)
  if (!fs.existsSync(tmpFolder)) {
    fs.mkdirSync(tmpFolder)
  }
  let fsPath = path.join(tmpFolder, uuid())
  await util.promisify(fs.writeFile)(fsPath, content, 'utf8')
  if (disposables) {
    disposables.push({
      dispose: () => {
        if (fs.existsSync(fsPath)) fs.unlinkSync(fsPath)
      }
    })
  }
  return fsPath
}

describe('workspace', () => {
  it('should not has nvim feature', () => {
    expect(helper.workspace.has('nvim-0.4.0')).toBe(false)
    expect(helper.workspace.has('patch-9.0.0000')).toBe(true)
  })
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

describe('call_function', () => {
  beforeAll(async () => {
    let folder = path.resolve(__dirname)
    await nvim.command(`set runtimepath+=${folder}`)
  })

  it('should throw when call vim9 void function', async () => {
    await expect(async () => {
      await nvim.call('vim9#Execute', ['g:x = $"foo"'])
    }).rejects.toThrow(Error)
    // should not report error
    nvim.call('vim9#Execute', ['g:x = $"abc"'], true)
    let x = await nvim.getVar('x')
    expect(x).toBe('abc')
  })

  it('should call dict function', async () => {
    let res = await nvim.callDictFunction({ key: 1 }, 'legacy#dict_add')
    expect(res).toBe(2)
  })

  it('should use notify for execute', async () => {
    nvim.call('execute', 'let g:x = "a"."b"', true)
    let res = await nvim.getVar('x')
    expect(res).toBe('ab')
  })

  it('should not throw for win_execute', async () => {
    // old style syntax
    await nvim.call('execute', ['let g:y = "a"."b"'])
    let y = await nvim.getVar('y')
    expect(y).toBe('ab')
    // new style syntax in vim9 function
    let res = await nvim.call('vim9#WinExecute', [])
    expect(res).toBe(true)
    // old style syntax win_execute in legacy function
    await nvim.call('legacy#win_execute', [])
    let win = await nvim.window
    let val = await win.getVar('foo')
    expect(val).toBe('ab')
  })

  it('should eval with legacy syntax', async () => {
    let res = await nvim.call('eval', ['"a"."b"'])
    expect(res).toBe('ab')
  })

  it('should not conflict with global function', async () => {
    await nvim.exec([
      'function! Win_execute(...) abort',
      ' throw "my error"',
      'endfunction'
    ].join('\n'))
    let winid = await nvim.call('win_getid') as number
    await nvim.call('win_execute', [winid, 'let w:f = "b"'])
    let win = nvim.createWindow(winid)
    let val = await win.getVar('f')
    expect(val).toBe('b')
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
    expect(res).toBe(false)
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
    expect(output).toBe('')
  })

  it('should create new buffer', async () => {
    let buf = await nvim.createNewBuffer()
    let valid = await buf.valid
    expect(valid).toBe(true)
    let listed = await buf.getOption('buflisted')
    expect(listed).toBe(false)
    buf = await nvim.createNewBuffer(true, true)
    valid = await buf.valid
    expect(valid).toBe(true)
    listed = await buf.getOption('buflisted')
    expect(listed).toBe(true)
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
    let res = await nvim.getVvar('errmsg')
    expect(res).toBe('')
  })

  it('should execute command', async () => {
    await nvim.command('sp')
    let wins = await nvim.windows
    expect(wins.length).toBe(2)
    await nvim.command('only')
    wins = await nvim.windows
    expect(wins.length).toBe(1)
  })

  it('should allow legacy script on command', async () => {
    await nvim.command('let g:x = v:argv[0]." bar"')
    let res = await nvim.getVar('x')
    expect(res).toMatch('bar')
  })

  it('should not throw for silent error command', async () => {
    await expect(async () => {
      await nvim.command('abcdefg')
    }).rejects.toThrow(/E492/)
    await nvim.command('silent! abcdefg')
  })

  it('should use legacy eval', async () => {
    let res = await nvim.eval('"a"."b"')
    expect(res).toBe('ab')
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
    let res = await nvim.commandOutput('echo "foo"."bar"')
    expect(res).toMatch(/foobar/)
    await expect(async () => {
      await nvim.commandOutput('echonot_exists')
    }).rejects.toThrow(/E492/)
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
    let res = await nvim.getVvar('progpath')
    expect(res).toMatch('vim')
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

  afterEach(async () => {
    await nvim.command('bd!')
  })

  it('should checkLines on CursorHold', async () => {
    let doc = await helper.createDocument()
    let buffer = doc.buffer
    await buffer.setLines(['1', '2'], {})
    await events.fire('CursorHold', [buffer.id, [1, 1]])
    let called = false
    events.on('LinesChanged', bufnr => {
      if (bufnr == buffer.id) {
        called = true
      }
    }, null, disposables)
    Object.assign(doc, { lines: [''], _changedtick: doc.changedtick + 1 })
    await events.fire('CursorHold', [buffer.id, [1, 1]])
    expect(called).toBe(true)
    expect(doc.getLines()).toEqual(['1', '2'])
  })

  it('should set buffer option', async () => {
    await buffer.setOption('buflisted', false)
    let curr = await buffer.getOption('buflisted')
    expect(curr).toBe(false)
    await buffer.setOption('buflisted', true)
    curr = await buffer.getOption('buflisted')
    expect(curr).toBe(true)
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
    await expect(async () => {
      let buf = nvim.createBuffer(-1)
      await buf.length
    }).rejects.toThrow(/Invalid buffer/)
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
    await buffer.setLines(['2', '3'], { start: 1, end: 2, strictIndexing: true })
    lines = await buffer.lines
    expect(lines).toEqual(['1', '2', '3'])
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

  it('should add virtual text', async () => {
    let buf = await nvim.buffer
    await nvim.call('setline', ['.', '  foo'])
    let ns = await nvim.createNamespace('virtual-text')
    buf.setVirtualText(ns, 0, [['bar', 'MoreMsg']], { text_align: 'above', indent: true })
    let types = await nvim.call('coc#api#GetNamespaceTypes', [ns])
    let props = await nvim.call('prop_list', [1, { types }]) as any[]
    expect(props.length).toBe(1)
    let prop = props[0]
    if (featuredPropList) {
      expect(prop.text_align).toBe('above')
      expect(prop.text_padding_left).toBe(2)
      expect(prop.text).toBe('bar')
    }
  })

  it('should set multiple virtual texts', async () => {
    let buf = await nvim.buffer
    let arr = (new Array(10)).fill('foo')
    await buf.setLines(arr)
    let ns = await nvim.createNamespace('vtext-set')
    let len = await buf.length
    let items: VirtualTextItem[] = []
    for (let i = 0; i < len; i++) {
      items.push({
        blocks: [[`${i}`, 'MoreMsg']],
        line: i,
        col: 1,
        right_gravity: true,
        virt_text_win_col: 0,
        hl_mode: 'blend'
      })
    }
    await nvim.call('coc#vtext#set', [buf.id, ns, items, false, 900])
    let types = await nvim.call('coc#api#GetNamespaceTypes', [ns])
    let props = await nvim.call('prop_list', [1, { types, end_lnum: len }]) as any[]
    expect(props.length).toBe(10)
    let prop = props[0]
    expect(prop.lnum).toBe(1)
    expect(prop.col).toBe(1)
    if (featuredPropList) {
      expect(prop.text).toBe('0')
    }
  })

  it('should update highlights', async () => {
    let buf = await nvim.buffer
    await buf.setLines(['foo', 'bar'])
    let hls = []
    hls.push({ lnum: 0, colStart: 0, colEnd: 3, hlGroup: 'MoreMsg' })
    hls.push({ lnum: 1, colStart: 1, colEnd: 3, hlGroup: 'MoreMsg' })
    buf.updateHighlights('test', hls, { priority: 80 })
    let arr = await buf.getHighlights('test')
    expect(arr.length).toBe(2)
    let obj = {}
    for (const key of ['hlGroup', 'lnum', 'colStart', 'colEnd']) {
      obj[key] = arr[0][key]
    }
    expect(obj).toEqual(hls[0])
    await nvim.call('coc#highlight#clear_all', [])
    buf.updateHighlights('test', [hls[0]], { priority: 80, start: 0, end: 1 })
    arr = await buf.getHighlights('test')
    expect(arr.length).toBe(1)
    let hl = { lnum: 1, colStart: 0, colEnd: -1, hlGroup: 'MoreMsg' }
    buf.updateHighlights('test', [hl], { priority: 80 })
    arr = await buf.getHighlights('test')
    expect(arr.length).toBe(1)
  })

  it('should highlight ranges', async () => {
    let buf = await nvim.buffer
    await buf.setLines(['foo', 'bar'])
    const range = Range.create(0, 0, 2, 0)
    buf.highlightRanges('test', 'MoreMsg', [range])
    let arr = await buf.getHighlights('test')
    expect(arr.length).toBe(2)
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
    expect(relative).toBe(false)
    await win.setOption('relativenumber', true)
    relative = await win.getOption('relativenumber')
    expect(relative).toBe(true)
    await win.setOption('relativenumber', false)
    await expect(async () => {
      await win.getOption('not_exists')
    }).rejects.toThrow('Invalid')
    await expect(async () => {
      await win.setOption('not_exists', '')
    }).rejects.toThrow('Invalid')
  })

  it('should get and set var', async () => {
    await win.setVar('foo', 'bar')
    let curr = await win.getVar('foo')
    expect(curr).toBe('bar')
    let res = await win.getVar('not_exists')
    expect(res).toBeNull()
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

  it('should add and clear matches', async () => {
    let buf = await nvim.buffer
    let arr = new Array(10)
    arr.fill('foo')
    await buf.setLines(arr)
    let ranges: Range[] = []
    for (let i = 0; i < 10; i++) {
      ranges.push(Range.create(i, 0, i, 3))
    }
    let win = await nvim.window
    let ids = await win.highlightRanges('MoreMsg', ranges)
    expect(ids.length).toBeGreaterThan(0)
    let matches = await helper.getMatches('MoreMsg')
    expect(matches.length).toBe(10)
    win.clearMatches(ids)
    matches = await helper.getMatches('MoreMsg')
    expect(matches.length).toBe(0)
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
    expect(option).toBe(true)
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

  it('should create inputBox', async () => {
    let input = await helper.plugin.window.createInputBox('title', '')
    input.title = 'new title'
    let curr: string
    input.onDidChange(text => {
      curr = text
    })
    await nvim.input('abc')
    await helper.waitValue((() => {
      return curr
    }), 'abc')
    input.dispose()
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

describe('notify', () => {
  it('should call function by notify', async () => {
    let curr = await nvim.call('line', ['.'])
    nvim.call('setline', [curr, 'foo'], true)
    await helper.waitValue(async () => {
      return await nvim.call('getline', [curr])
    }, 'foo')
    await nvim.command('normal! dd')
  })
})

describe('document', () => {
  async function shouldEqual(doc, synced = false): Promise<void> {
    let lines = synced ? doc.textDocument.lines : doc.getLines()
    let cur = await doc.buffer.lines
    expect(lines).toEqual(cur)
  }

  it('should synchronize current buffer when call vim function', async () => {
    let doc = await helper.createDocument()
    await nvim.call('appendbufline', [doc.bufnr, 0, ['3', '4', '5']])
    await nvim.call('setbufline', [doc.bufnr, 1, 'txt'])
    await shouldEqual(doc)
  })

  it('should synchronize changes', async () => {
    let lines = []
    for (let i = 1; i < 8; i++) {
      lines.push(`line ${i}`)
    }
    let filepath = await createTmpFile(lines.join('\n'), disposables)
    let doc = await helper.createDocument(filepath)
    let bufnr = doc.buffer.id
    // remove first line
    nvim.pauseNotification()
    nvim.call('deletebufline', [bufnr, 1, 3], true)
    nvim.call('appendbufline', [bufnr, 0, ['3', '4', '5']], true)
    await nvim.resumeNotification(true)
    await shouldEqual(doc)
    await doc.patchChange()
  })

  it('should patch change of current line', async () => {
    let doc = await helper.createDocument()
    nvim.call('setline', ['.', 'foo'], true)
    await doc.patchChange()
    await shouldEqual(doc, true)
    nvim.call('setline', ['.', 'foo'], true)
    await doc.patchChange()
    await shouldEqual(doc, true)
  })

  it('should patch change', async () => {
    let doc = await helper.workspace.document
    // synchronize after user input
    await nvim.input('o')
    await doc.patchChange()
    let buf = doc.buffer
    // synchronize after api
    buf.setLines(['aa', 'bb'], {
      start: 0,
      end: 1,
      strictIndexing: false
    }, true)
    await doc.patchChange()
    await shouldEqual(doc)
    await nvim.deleteCurrentLine()
    await shouldEqual(doc)
    await nvim.setLine('foo')
    await shouldEqual(doc)
    await nvim.command('stopinsert')
  })

  it('should synchronize after changeLines', async () => {
    let doc = await helper.createDocument()
    await doc.buffer.setLines(['a', 'b', 'c', 'd'])
    await doc.synchronize()
    await doc.changeLines([
      [0, 'd'],
      [1, 'c'],
      [2, 'b'],
      [3, 'a'],
    ])
    await shouldEqual(doc)
  })

  it('should add and remove lines', async () => {
    let doc = await helper.workspace.document
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar\n')])
    await shouldEqual(doc)
    await doc.applyEdits([TextEdit.replace(Range.create(0, 0, 3, 0), '')])
    await shouldEqual(doc)
    await nvim.command('bd!')
  })

  it('should synchronize hidden buffer after replace lines', async () => {
    let doc = await helper.createDocument()
    await doc.buffer.setLines(['a', 'b', 'c', 'd'])
    await nvim.command('enew')
    await shouldEqual(doc)
    await doc.applyEdits([TextEdit.replace(Range.create(0, 0, 4, 0), 'c\nb\na\n')])
    await doc.patchChange()
    await shouldEqual(doc)
    await nvim.command('bd!')
  })

  async function assertBuffer(lines: string[], hls: [string, number, number, number][]): Promise<void> {
    let buf = await nvim.buffer
    let curr = await buf.lines
    expect(curr).toEqual(lines)
    let highlights = await buf.getHighlights('test')
    let arr = highlights.map(o => [o.hlGroup, o.lnum, o.colStart, o.colEnd])
    expect(arr).toEqual(hls)
  }

  it('should apply single line edit', async () => {
    let doc = await helper.createDocument()
    await doc.buffer.setLines(['foo foo'])
    await doc.patchChange()
    let ranges = [Range.create(0, 0, 0, 3), Range.create(0, 4, 0, 7)]
    doc.buffer.highlightRanges('test', 'MoreMsg', ranges)
    let edit = TextEdit.replace(Range.create(0, 3, 0, 4), 'xy')
    await doc.applyEdits([edit])
    await assertBuffer(['fooxyfoo'], [
      ['MoreMsg', 0, 0, 3],
      ['MoreMsg', 0, 5, 8],
    ])
    edit = TextEdit.replace(Range.create(0, 1, 0, 7), '')
    await doc.applyEdits([edit])
    await assertBuffer(['fo'], [])
    await doc.buffer.append(['bar'])
    await doc.patchChange()
    ranges = [Range.create(0, 0, 0, 1), Range.create(1, 2, 1, 3)]
    doc.buffer.highlightRanges('test', 'MoreMsg', ranges)
    edit = TextEdit.replace(Range.create(0, 1, 1, 2), 'x')
    await doc.applyEdits([edit])
    await doc.patchChange()
    await assertBuffer(['fxr'], [
      ['MoreMsg', 0, 0, 1],
      ['MoreMsg', 0, 2, 3],
    ])
  })

  it('should apply multi lines edit', async () => {
    let doc = await helper.createDocument()
    await doc.buffer.setLines(['foo foo'])
    await doc.patchChange()
    let ranges = [Range.create(0, 0, 0, 3), Range.create(0, 4, 0, 7)]
    doc.buffer.highlightRanges('test', 'MoreMsg', ranges)
    let edit = TextEdit.replace(Range.create(0, 3, 0, 4), 'a\nb\nc')
    await doc.applyEdits([edit])
    await assertBuffer(['fooa', 'b', 'cfoo'], [
      ['MoreMsg', 0, 0, 3],
      ['MoreMsg', 2, 1, 4],
    ])
    edit = TextEdit.replace(Range.create(0, 3, 2, 1), '\n')
    await doc.applyEdits([edit])
    await assertBuffer(['foo', 'foo'], [
      ['MoreMsg', 0, 0, 3],
      ['MoreMsg', 1, 0, 3],
    ])
  })

  it('should apply for lines replace edit', async () => {
    let doc = await helper.createDocument()
    await doc.buffer.setLines(['foo', 'bar'])
    await doc.patchChange()
    let edit = TextEdit.replace(Range.create(0, 0, 1, 0), 'a\nb\n')
    await doc.applyEdits([edit, TextEdit.insert(Position.create(1, 0), 'x')])
    let lines = await doc.buffer.lines
    expect(lines).toEqual(['a', 'b', 'xbar'])
    edit = TextEdit.replace(Range.create(0, 0, 2, 0), '')
    await doc.applyEdits([edit, TextEdit.replace(Range.create(2, 0, 2, 1), '')])
    lines = await doc.buffer.lines
    expect(lines).toEqual(['bar'])
  })

  it('should apply multiple edits', async () => {
    let doc = await helper.createDocument()
    let arr = new Array(10)
    arr.fill('foo bar a b c d e')
    let ranges: Range[] = []
    let edits: TextEdit[] = []
    for (let i = 0; i < arr.length; i++) {
      ranges.push(Range.create(i, 0, i, 3))
      ranges.push(Range.create(i, 4, i, 7))
      ranges.push(Range.create(i, 8, i, 9))
      ranges.push(Range.create(i, 10, i, 11))
      ranges.push(Range.create(i, 12, i, 13))
      ranges.push(Range.create(i, 14, i, 15))
      ranges.push(Range.create(i, 16, i, 17))
      edits.push(TextEdit.insert(Position.create(i, 0), `${i + 1} `))
    }
    let buf = doc.buffer
    await buf.setLines(arr)
    buf.highlightRanges('test', 'Title', ranges)
    await doc.synchronize()
    await doc.applyEdits(edits)
    await events.race(['TextChanged'], 200)
    let hls = await buf.getHighlights('test')
    expect(hls.length).toBe(70)
  })

  it('should consider latest change', async () => {
    let doc = await helper.createDocument()
    let buf = doc.buffer
    {
      let edits: TextEdit[] = [TextEdit.insert(Position.create(0, 0), 'bar')]
      nvim.call('setline', [1, 'foo'], true)
      await doc.applyEdits(edits)
      let line = await nvim.line
      expect(line).toBe('foobar')
    }
    {
      await buf.setLines(['  foo'])
      await doc.patchChange()
      nvim.call('setline', [1, '  fooa'], true)
      nvim.call('cursor', [1, 7], true)
      let edits: TextEdit[] = [TextEdit.del(Range.create(0, 0, 0, 1))]
      await doc.applyEdits(edits)
      let line = await nvim.line
      expect(line).toBe(' fooa')
    }
    {
      await buf.setLines(['foo'])
      await nvim.call('cursor', [1, 3])
      await doc.synchronize()
      nvim.call('setline', [1, 'fo'], true)
      let edits: TextEdit[] = [TextEdit.insert(Position.create(0, 0), ' ')]
      await doc.applyEdits(edits)
      let line = await nvim.line
      expect(line).toBe(' fo')
    }
  })
})
