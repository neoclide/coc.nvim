import completion from '../completion'
import { getCurrentPlugin } from '../attach'
import * as shared from './sharedUtil'
import type { Buffer, Neovim, Tabpage, Window } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import util from 'util'
import { InsertTextFormat, Position, Range, TextEdit, type Disposable } from 'vscode-languageserver-protocol'
import sources from '../completion/sources'
import type { CompleteResult, ExtendedCompleteItem } from '../completion/types'
import * as funcs from '../core/funcs'
import * as ui from '../core/ui'
import events from '../events'
import type { VirtualTextItem } from '../handler/inlayHint/buffer'
import languages from '../languages'
import { sameFile } from '../util/fs'
import workspace from '../workspace'
import { afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

function disposeAll(disposables: Disposable[]): void {
  while (disposables.length) {
    const item = disposables.pop()
    item?.dispose()
  }
}

const disposables: Disposable[] = []
let nvim: Neovim
let featuredPropList = false
before(async () => {
  nvim = workspace.nvim
  // for text_padding_left of property
  if (workspace.has('patch-9.0.1782')) {
    featuredPropList = true
  }
})

afterEach(() => {
  disposeAll(disposables)
})

async function createTmpFile(content: string, disposables?: Disposable[]): Promise<string> {
  let tmpFolder = path.join(os.tmpdir(), `coc-${process.pid}`)
  if (!fs.existsSync(tmpFolder)) {
    fs.mkdirSync(tmpFolder)
  }
  let fsPath = path.join(tmpFolder, crypto.randomUUID())
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
  it('should not has nvim feature', t => {
    assert.strictEqual(workspace.has('nvim-0.4.0'), false)
    assert.strictEqual(workspace.has('patch-9.0.0000'), true)
  })

  it('should evaluate dynamic insert keymaps', async t => {
    let value: string | undefined
    let mapping = workspace.registerInsertKeymap('[', current => {
      value = current
      return [{ text: '<left>' }, { key: '<Left>' }]
    }, { buffer: true, arglist: ['getline(".")'] })
    await nvim.setLine('current state')
    await shared.waitValue(async () => {
      let rhs = await nvim.call('maparg', ['[', 'i']) as string
      return rhs.includes('coc#_insert_keymap')
    }, true)

    try {
      let rhs = await nvim.call('maparg', ['[', 'i']) as string
      let result = await nvim.eval(rhs) as string
      assert.strictEqual(value, 'current state')
      assert.strictEqual(result.startsWith('<left>'), true)
      assert.ok(result.length > '<left>'.length)
    } finally {
      mapping.dispose()
      await shared.waitValue(async () => await nvim.call('maparg', ['[', 'i']), '')
    }
  })
})

describe('rpc client', () => {
  it('should report live socket channel as running', async t => {
    assert.strictEqual(await nvim.call('coc#client#is_running', ['coc']), 1)
  })

  it('should reset client when channel is gone on E475', async t => {
    // ch_sendraw on an invalid channel raises E475, which must still be
    // treated as connection loss for a dead channel.
    await nvim.command(`
      let g:fake = coc#client#create('fake', [])
      let g:fake['running'] = 1
      let g:fake['channel'] = 'x'
      call g:fake['notify']('testMethod', [])
    `)
    assert.strictEqual(await nvim.call('eval', ["coc#client#get_client('fake')['running']"]), 0)
  })
})

describe('disable and enable', () => {
  it('should keep dynamic autocmd after disable and enable', async t => {
    let times = 0
    let disposable = workspace.registerAutocmd({
      event: 'CursorMoved',
      request: false,
      callback: () => {
        times++
      }
    })
    await nvim.command('doautocmd <nomodeline> CursorMoved')
    await shared.waitValue(() => times, 1)
    await nvim.command('CocDisable')
    // While disabled the autocmd stays installed but no RPC is sent.
    await nvim.command('doautocmd <nomodeline> CursorMoved')
    await shared.wait(50)
    assert.strictEqual(times, 1)
    await nvim.command('CocEnable')
    await nvim.command('doautocmd <nomodeline> CursorMoved')
    await shared.waitValue(() => times, 2)
    disposable.dispose()
  })

  it('should remove dynamic autocmd on dispose', async t => {
    let name = `CocTestEvent${Math.random().toString(16).slice(2, 8)}`
    let disposable = workspace.registerAutocmd({
      event: `User ${name}`,
      callback: () => {}
    })
    let output = await nvim.call('execute', 'autocmd coc_dynamic_autocmd') as string
    assert.match(output, new RegExp(name))
    disposable.dispose()
    await new Promise(resolve => process.nextTick(resolve))
    output = await nvim.call('execute', 'autocmd coc_dynamic_autocmd') as string
    assert.strictEqual(output.includes(name), false)
  })
})

describe('vim api', () => {
  it('should start server', async t => {
    await nvim.setLine('foobar')
    let buf = await nvim.buffer
    let lines = await buf.lines
    assert.deepStrictEqual(lines, ['foobar'])
    await nvim.command('bd!')
  })

  it('should show info', async t => {
    global.REVISION = '2e82259f'
    let handler = getCurrentPlugin().getHandler().workspace
    await handler.showInfo()
    // scratch buffer should carry a meaningful name (#5061)
    let bufname = await nvim.call('bufname', ['%']) as string
    assert.strictEqual(bufname, '[Coc Info]')
    await nvim.command('bd!')
  })

  it('should navigate complete items', async t => {
    shared.updateConfiguration('suggest.noselect', true)
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
    await shared.waitPopup()
    await nvim.call('coc#pum#_navigate', [1, 1])
    await shared.waitFor('getline', ['.'], 'foo')
    assert.strictEqual(completion.isActivated, true)
    await nvim.call('coc#pum#close', ['cancel'])
    await nvim.input('<esc>')
    await shared.waitFor('mode', [], 'n')
    disposable.dispose()
    await nvim.command('silent! %bwipeout!')
  })

  it('should synchronize document before completion done', async t => {
    let line: string
    let name = crypto.randomUUID()
    let disposable = sources.createSource({
      name,
      doComplete: (): Promise<CompleteResult<ExtendedCompleteItem>> => Promise.resolve({ items: [{ word: 'foo' }] }),
      onCompleteDone: (_item, opt) => {
        line = workspace.getDocument(opt.bufnr).getline(0)
      }
    })
    await nvim.setLine('')
    await nvim.input('i')
    nvim.call('coc#start', { source: name }, true)
    try {
      await shared.waitPopup()
      await nvim.call('coc#pum#select', [0, 1, 1])
      await shared.waitValue(() => line, 'foo')
    } finally {
      await nvim.input('<esc>')
      await shared.waitFor('mode', [], 'n')
      disposable.dispose()
      await nvim.command('silent! %bwipeout!')
    }
  })

  it('should keep retriggered pum on noinsert navigation', async t => {
    shared.updateConfiguration('suggest.noselect', true, disposables)
    let feedkeys = t.mock.fn((keys: string): void => {
      nvim.call('feedkeys', [keys, 'in'], true)
    })
    let disposable = languages.registerCompletionItemProvider('issue-5409', '5409', null, {
      provideCompletionItems: document => {
        if (document.getText().includes('"inlayHint.position": ')) {
          return [{ label: '"inline"' }, { label: '"eol"' }]
        }
        return [{
          label: 'inlayHint.position',
          insertText: '"inlayHint.position": $1',
          insertTextFormat: InsertTextFormat.Snippet,
          filterText: '"inlayHint.position"',
          command: { title: 'Suggest', command: 'editor.action.triggerSuggest' },
          textEdit: {
            range: Range.create(0, 1, 0, 12),
            newText: '"inlayHint.position": $1'
          }
        }]
      }
    })
    await nvim.setLine('{"inlayHint}')
    await nvim.call('cursor', [1, 11])
    await nvim.input('a')
    try {
      nvim.call('coc#start', { source: 'issue-5409' }, true)
      await shared.waitPopup()
      await nvim.input('<esc>')
      await shared.waitFor('mode', [], 'n')
      await shared.waitFor('coc#pum#visible', [], 0)

      await nvim.input('a')
      nvim.call('coc#start', { source: 'issue-5409' }, true)
      await shared.waitPopup()
      let keys = await nvim.call('coc#pum#next', [0]) as string
      feedkeys(keys)
      await shared.waitValue(() => completion.selectedItem?.word.includes('inlayHint.position'), true)
      keys = await nvim.call('coc#pum#confirm') as string
      feedkeys(keys)
      await shared.waitValue(async () => (await nvim.line).startsWith('{"inlayHint.position": '), true)
      await shared.waitValue(() => completion.activeItems.some(item => item.word.includes('"inline"')), true)
      await shared.waitFor('coc#pum#visible', [], 1)

      let textChanged = events.race(['TextChangedI'], 1000)
      keys = await nvim.call('coc#pum#next', [0]) as string
      feedkeys(keys)
      assert.notStrictEqual(await textChanged, undefined)
      assert.strictEqual(await nvim.call('coc#pum#visible'), 1)
      assert.strictEqual(completion.isActivated, true)
      assert.ok(completion.selectedItem?.word.includes('"inline"'))
    } finally {
      await nvim.input('<esc>')
      await shared.waitFor('mode', [], 'n')
      disposable.dispose()
      await nvim.command('silent! %bwipeout!')
    }
  })

  it('should place popup menu after concealed text on current line', async t => {
    // Regression for #5582: Vim's popup 'cursor' column anchor ignores concealed
    // text, so the menu must be positioned with the conceal-aware screen column.
    let name = crypto.randomUUID()
    let disposable = sources.createSource({
      name,
      doComplete: (_opt): Promise<CompleteResult<ExtendedCompleteItem>> => Promise.resolve({
        items: [{ word: 'conceal' }, { word: 'conclude' }]
      })
    })
    await nvim.command('syntax match CocConceal /conceal/ conceal')
    await nvim.command('setl conceallevel=2 concealcursor=i')
    await nvim.call('setline', [1, 'conceal '])
    await nvim.input('A')
    await nvim.input('conc')
    nvim.call('coc#start', { source: name }, true)
    try {
      await shared.waitPopup()
      let id = 0
      await shared.waitValue(async () => {
        id = await nvim.call('coc#pum#winid', []) as number
        return id > 0
      }, true)
      let pos = await nvim.call('popup_getpos', [id]) as { col: number }
      let wincol = await nvim.call('wincol') as number
      let virtcol = await nvim.call('virtcol', ['.']) as number
      // "conceal" is hidden, so the conceal-aware cursor column is far smaller than
      // the virtual column; the menu must follow the conceal-aware column and not
      // land after the hidden text.
      assert.ok(wincol < virtcol)
      assert.ok(pos.col <= wincol)
    } finally {
      await nvim.call('coc#pum#close', ['cancel'])
      await nvim.input('<esc>')
      await shared.waitFor('mode', [], 'n')
      disposable.dispose()
      await nvim.command('silent! %bwipeout!')
    }
  })

  it('should place popup menu by word start when input wraps on concealed line', async t => {
    // Regression for #5582 (wrap case): with 'wrap', the typed input can span
    // multiple display rows. A flat column subtraction underflows below 0 and the
    // menu was clamped to the left screen edge, while the word visibly starts near
    // the right edge on an upper row. The menu must anchor under the word start.
    let name = crypto.randomUUID()
    let disposable = sources.createSource({
      name,
      doComplete: (_opt): Promise<CompleteResult<ExtendedCompleteItem>> => Promise.resolve({
        items: [{ word: 'conceal' }, { word: 'conclude' }]
      })
    })
    let columns = await nvim.eval('&columns') as number
    await nvim.command('set columns=40')
    await nvim.command('setl wrap')
    await nvim.command('syntax match CocConceal /conceal/ conceal')
    await nvim.command('setl conceallevel=2 concealcursor=i')
    await nvim.call('setline', [1, Array(151).join('.')])
    await nvim.input('Iconceal')
    await nvim.input('<esc>')
    await nvim.input('Aconcea')
    nvim.call('coc#start', { source: name }, true)
    try {
      await shared.waitPopup()
      let id = 0
      await shared.waitValue(async () => {
        id = await nvim.call('coc#pum#winid', []) as number
        return id > 0
      }, true)
      let pos = await nvim.call('popup_getpos', [id]) as { col: number }
      // The word start is on the right half of the screen on an upper wrap row,
      // so the menu must be anchored there, not clamped to the left edge (col 1).
      assert.ok(pos.col > 20)
    } finally {
      await nvim.call('coc#pum#close', ['cancel'])
      await nvim.input('<esc>')
      await shared.waitFor('mode', [], 'n')
      await nvim.command(`set columns=${columns}`)
      disposable.dispose()
      await nvim.command('silent! %bwipeout!')
    }
  })

  it('should shift popup left when pumAlign is configured', async t => {
    let name = crypto.randomUUID()
    let disposable = sources.createSource({
      name,
      doComplete: (_opt): Promise<CompleteResult<ExtendedCompleteItem>> => Promise.resolve({
        items: [
          { word: 'foo', menu: 'm', kind: 'w' },
          { word: 'foobar', menu: 'menu2', kind: 'v' }
        ]
      })
    })
    await nvim.call('setline', [1, 'xxxxxxxxxxxx foo '])
    await nvim.input('A')
    nvim.call('coc#start', { source: name }, true)
    try {
      await shared.waitPopup()
      let id = 0
      await shared.waitValue(async () => {
        id = await nvim.call('coc#pum#winid', []) as number
        return id > 0
      }, true)
      let pos = await nvim.call('popup_getpos', [id]) as { col: number }
      await nvim.call('coc#pum#close', ['cancel'])
      await nvim.input('<esc>')
      await shared.waitFor('mode', [], 'n')
      shared.updateConfiguration('suggest.pumAlign', 'menu')
      await nvim.input('A')
      nvim.call('coc#start', { source: name }, true)
      await shared.waitPopup()
      let id2 = 0
      await shared.waitValue(async () => {
        id2 = await nvim.call('coc#pum#winid', []) as number
        return id2 > 0
      }, true)
      let pos2 = await nvim.call('popup_getpos', [id2]) as { col: number }
      // offset: abbr width (6) + trailing space (1)
      assert.strictEqual(pos.col - pos2.col, 7)
    } finally {
      await nvim.call('coc#pum#close', ['cancel'])
      await nvim.input('<esc>')
      await shared.waitFor('mode', [], 'n')
      disposable.dispose()
      await nvim.command('silent! %bwipeout!')
    }
  })

  it('should keep popup menu at word start when typed input becomes concealed', async t => {
    let name = crypto.randomUUID()
    let disposable = sources.createSource({
      name,
      doComplete: (_opt): Promise<CompleteResult<ExtendedCompleteItem>> => Promise.resolve({
        items: [{ word: 'concealer' }, { word: 'concealment' }]
      })
    })
    let columns = await nvim.eval('&columns') as number
    await nvim.command('set columns=80')
    await nvim.command('setl wrap')
    await nvim.command('syntax match CocConceal /conceal/ conceal')
    await nvim.command('setl conceallevel=2 concealcursor=i')
    await nvim.input('150a.')
    await nvim.input('<esc>')
    await shared.waitFor('mode', [], 'n')
    await nvim.input('A')
    await nvim.input('concea')
    nvim.call('coc#start', { source: name }, true)
    try {
      await shared.waitPopup()
      let id = 0
      await shared.waitValue(async () => {
        id = await nvim.call('coc#pum#winid', []) as number
        return id > 0
      }, true)
      let before = await nvim.call('popup_getpos', [id]) as { col: number }
      await nvim.input('l')
      await shared.waitFor('getline', ['.'], '.'.repeat(150) + 'conceal')
      let after = await nvim.call('popup_getpos', [id]) as { col: number }
      assert.strictEqual(after.col, before.col)
    } finally {
      await nvim.call('coc#pum#close', ['cancel'])
      await nvim.input('<esc>')
      await shared.waitFor('mode', [], 'n')
      await nvim.command(`set columns=${columns}`)
      disposable.dispose()
      await nvim.command('silent! %bwipeout!')
    }
  })

  it('should keep popup menu at word start after another concealed word', async t => {
    let name = crypto.randomUUID()
    let disposable = sources.createSource({
      name,
      doComplete: (_opt): Promise<CompleteResult<ExtendedCompleteItem>> => Promise.resolve({
        items: [{ word: 'concealer' }, { word: 'concealment' }]
      })
    })
    await nvim.command('syntax match CocConceal /conceal/ conceal')
    await nvim.command('setl conceallevel=2 concealcursor=i')
    await nvim.input('Iconceal concea')
    nvim.call('coc#start', { source: name }, true)
    try {
      await shared.waitPopup()
      let id = 0
      await shared.waitValue(async () => {
        id = await nvim.call('coc#pum#winid', []) as number
        return id > 0
      }, true)
      let before = await nvim.call('popup_getpos', [id]) as { col: number }
      await nvim.input('l')
      await shared.waitFor('getline', ['.'], 'conceal conceal')
      let after = await nvim.call('popup_getpos', [id]) as { col: number }
      assert.strictEqual(after.col, before.col)
      let virtcol = await nvim.call('virtcol', ['.']) as number
      assert.ok(after.col < virtcol - 'conceal'.length)
    } finally {
      await nvim.call('coc#pum#close', ['cancel'])
      await nvim.input('<esc>')
      await shared.waitFor('mode', [], 'n')
      disposable.dispose()
      await nvim.command('silent! %bwipeout!')
    }
  })

  it('should echo message by callTimer', async t => {
    ui.echoMessages(nvim, 'message', 'more', 'more')
    await shared.waitValue(async () => {
      let line = await shared.getCmdline()
      return line.includes('message')
    }, true)
  })

  it('should call async', async t => {
    await nvim.command('normal! gg')
    let res = await funcs.callAsync(nvim, 'line', ['.'])
    assert.strictEqual(res, 1)
  })
})

describe('call_function', () => {
  before(async () => {
    let folder = path.resolve(import.meta.dirname)
    await nvim.command(`set runtimepath+=${folder}`)
  })

  it('should throw when call vim9 void function', async t => {
    await assert.rejects(nvim.call('vim9#Execute', ['g:x = $"foo"']), Error)
    // should not report error
    nvim.call('vim9#Execute', ['g:x = $"abc"'], true)
    let x = await nvim.getVar('x')
    assert.strictEqual(x, 'abc')
  })

  it('should call dict function', async t => {
    let res = await nvim.callDictFunction({ key: 1 }, 'legacy#dict_add')
    assert.strictEqual(res, 2)
  })

  it('should use notify for execute', async t => {
    nvim.call('execute', 'let g:x = "a"."b"', true)
    let res = await nvim.getVar('x')
    assert.strictEqual(res, 'ab')
  })

  it('should not throw for win_execute', async t => {
    // old style syntax
    await nvim.call('execute', ['let g:y = "a"."b"'])
    let y = await nvim.getVar('y')
    assert.strictEqual(y, 'ab')
    // new style syntax in vim9 function
    let res = await nvim.call('vim9#WinExecute', [])
    assert.strictEqual(res, true)
    // old style syntax win_execute in legacy function
    await nvim.call('legacy#win_execute', [])
    let win = await nvim.window
    let val = await win.getVar('foo')
    assert.strictEqual(val, 'ab')
  })

  it('should eval with legacy syntax', async t => {
    let res = await nvim.call('eval', ['"a"."b"'])
    assert.strictEqual(res, 'ab')
  })

  it('should not conflict with global function', async t => {
    await nvim.exec([
      'function! Win_execute(...) abort',
      ' throw "my error"',
      'endfunction'
    ].join('\n'))
    let winid = await nvim.call('win_getid') as number
    await nvim.call('win_execute', [winid, 'let w:f = "b"'])
    let win = nvim.createWindow(winid)
    let val = await win.getVar('f')
    assert.strictEqual(val, 'b')
  })
})

describe('client API', () => {
  it('stops and restarts a task without evaluating the Job as a number', async t => {
    let id = `vim-task-${Date.now()}`
    let started = await nvim.call('coc#task#start', [id, { cmd: 'sleep', args: ['30'] }])
    assert.strictEqual(started, true)
    // stop() must not throw E910 (Using a Job as a Number)
    await nvim.call('coc#task#stop', [id])
    await shared.waitValue(async () => await nvim.call('coc#task#running', [id]), false)
    // restarting the same id stops the old job first without E910
    started = await nvim.call('coc#task#start', [id, { cmd: 'sleep', args: ['30'] }])
    assert.strictEqual(started, true)
    await nvim.call('coc#task#stop', [id])
    await shared.waitValue(async () => await nvim.call('coc#task#running', [id]), false)
  })

  it('runs node version checks with spaces in the executable path', async t => {
    let dir = path.join(os.tmpdir(), `coc node check-${crypto.randomUUID()}`)
    fs.mkdirSync(dir, { recursive: true })
    let node = path.join(dir, 'my node')
    fs.writeFileSync(node, '#!/bin/sh\necho "v20.19.0"\n', { mode: 0o755 })
    let saved = await nvim.eval('exists("g:coc_node_path") ? g:coc_node_path : ""') as string
    try {
      let code = [
        `let g:coc_node_path = '${node}'`,
        'let g:coc_stderr_before_len = len(get(coc#client#get_client(\'coc\'), \'stderr\', []))',
        "call coc#client#check_version()",
        'let g:coc_stderr_after_len = len(get(coc#client#get_client(\'coc\'), \'stderr\', []))'
      ].join('\n')
      await nvim.exec(code)
      let [beforeLen, afterLen] = await nvim.call('eval', ['[g:coc_stderr_before_len, g:coc_stderr_after_len]']) as [number, number]
      // check_version must parse the version without reporting an error
      assert.strictEqual(afterLen, beforeLen)
    } finally {
      if (saved === '') {
        await nvim.exec('unlet g:coc_node_path')
      } else {
        await nvim.setVar('coc_node_path', saved)
      }
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects pending async callbacks once when the connection detaches', async t => {
    let code = [
      "call coc#client#create('fake', [])",
      'let g:coc_detach_err = ""',
      'let g:coc_detach_count = 0',
      "let c = coc#client#get_client('fake')",
      "let c['running'] = 1",
      "let c['async_req_id'] = 5",
      "let c['async_callbacks'] = {5: {err, resp -> execute(\"let g:coc_detach_err = err\")}}",
      "let c['async_callbacks'][7] = {err, resp -> execute(\"let g:coc_detach_count += 1\")}",
      "call coc#client#on_detach('fake', 0)",
      "call coc#client#on_detach('fake', 0)",
      "let g:coc_detach_map_empty = empty(c['async_callbacks'])",
      "let g:coc_detach_id = c['async_req_id']",
      "let g:coc_detach_running = c['running']"
    ].join('\n')
    await nvim.exec(code)
    assert.ok(String(await nvim.getVar('coc_detach_err')).includes('exited before response'))
    // callbacks completed exactly once even though detach ran twice
    assert.strictEqual(await nvim.getVar('coc_detach_count'), 1)
    assert.strictEqual(await nvim.getVar('coc_detach_map_empty'), 1)
    // request ids reset so a reconnect can safely reuse id 1
    assert.strictEqual(await nvim.getVar('coc_detach_id'), 1)
    assert.strictEqual(await nvim.getVar('coc_detach_running'), 0)
  })

  it('should set current dir', async t => {
    let dir = path.join(fs.realpathSync(os.tmpdir()), crypto.randomUUID())
    fs.mkdirSync(dir, { recursive: true })
    await nvim.setDirectory(dir)
    let res = await nvim.call('getcwd') as string
    assert.strictEqual(sameFile(res, dir), true)
  })

  it('should input characters', async t => {
    await nvim.input('iabc')
    await shared.waitFor('getline', ['.'], 'abc')
    await nvim.input('<esc>')
    await shared.waitFor('mode', [], 'n')
    await nvim.command('bwipeout!')
  })

  it('should set var', async t => {
    await nvim.setVar('foo', 'bar', false)
    let res = await nvim.getVar('foo')
    assert.strictEqual(res, 'bar')
  })

  it('should del var', async t => {
    await assert.rejects(async () => {
      nvim.pauseNotification()
      nvim.deleteVar('not_exists')
      await nvim.resumeNotification()
    }, Error)
    await nvim.setVar('foo', 'bar', false)
    nvim.deleteVar('foo')
    let res = await nvim.getVar('foo')
    assert.strictEqual(res, null)
  })

  it('should set option', async t => {
    await nvim.setOption('emoji', false)
    let res = await nvim.getOption('emoji')
    assert.strictEqual(res, false)
  })

  it('should set current buffer', async t => {
    let bufnr = await nvim.call('bufadd', ['foo']) as number
    await nvim.command(`call bufload(${bufnr})`)
    await nvim.setBuffer(nvim.createBuffer(bufnr))
    let b = await nvim.buffer
    assert.strictEqual(b.id, bufnr)
    await nvim.command('silent! %bwipeout!')
  })

  it('validates Buf_set_lines ranges like Neovim', async t => {
    let buf = await nvim.createNewBuffer()
    let cases: Array<[number, number, boolean]> = [
      [2, 1, true], // reversed range, strict
      [2, 1, false], // reversed range, non-strict
      [0, 5, true], // end beyond buffer, strict
      [-5, 1, true], // start below buffer, strict
      [1, -5, true], // end below buffer, strict
    ]
    for (let [start, end, strict] of cases) {
      await buf.setLines(['a', 'b'], { start: 0, end: -1 })
      let err: Error | undefined
      try {
        await buf.setLines(['X'], { start, end, strictIndexing: strict })
      } catch (e) {
        err = e as Error
      }
      assert.ok(err, `${start}:${end}:${strict}`)
      assert.deepStrictEqual(await buf.lines, ['a', 'b'], `${start}:${end}:${strict}`)
    }
    // boundary insert at the end still works
    await buf.setLines(['a', 'b'], { start: 0, end: -1 })
    await buf.setLines(['X'], { start: 2, end: 2, strictIndexing: true })
    assert.deepStrictEqual(await buf.lines, ['a', 'b', 'X'])
    // get_lines validates reversed ranges too
    await buf.setLines(['a', 'b'], { start: 0, end: -1 })
    let getErr: Error | undefined
    try {
      await buf.getLines({ start: 2, end: 1, strictIndexing: true })
    } catch (e) {
      getErr = e as Error
    }
    assert.ok(getErr)
    await nvim.command('silent! %bwipeout!')
  })

  it('restores wildignore when opening throws', async t => {
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wild-'))
    let file = path.join(dir, 'c.txt')
    fs.writeFileSync(file, 'c\n')
    let value = 'foo bar'
    await nvim.setOption('wildignore', value)
    await nvim.exec(`autocmd BufReadPre ${file} throw 'boom'`)
    let tabs = await nvim.call('tabpagenr', ['$'])
    try {
      let err: Error | undefined
      try {
        await nvim.call('coc#util#jump', ['tab drop', file])
      } catch (e) {
        err = e as Error
      }
      assert.ok(err)
      assert.strictEqual(await nvim.getOption('wildignore'), value)
    } finally {
      await nvim.exec(`autocmd! BufReadPre ${file}`)
      await nvim.setOption('wildignore', '')
      while (await nvim.call('tabpagenr', ['$']) > tabs) {
        await nvim.command('silent! tabclose!')
      }
      await nvim.command('silent! %bwipeout!')
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the centered prompt on screen with a large marginTop', async t => {
    let savedLines = await nvim.getOption('lines') as number
    let savedColumns = await nvim.getOption('columns') as number
    await nvim.setOption('lines', 12)
    await nvim.setOption('columns', 80)
    try {
      let maxRow = Number(await nvim.getOption('lines')) - Number(await nvim.getOption('cmdheight')) - 2
      for (let marginTop of [0, 1, 50, maxRow]) {
        let input = await getCurrentPlugin().window.createInputBox('title', '', { marginTop, position: 'center' })
        let row = input.dimension.row
        assert.ok(row >= 0, `marginTop ${marginTop}`)
        assert.ok(row <= maxRow, `marginTop ${marginTop}`)
        input.dispose()
      }
    } finally {
      await nvim.setOption('lines', savedLines)
      await nvim.setOption('columns', savedColumns)
    }
  })

  it('should execute vim script', async t => {
    let output = await nvim.exec(`echo 'foo'\necho 'bar'`, true)
    assert.strictEqual(output, 'foo\nbar')
    output = await nvim.exec(`let g:x = '5'\nunlet g:x`)
    assert.strictEqual(output, '')
  })

  it('should create new buffer', async t => {
    let buf = await nvim.createNewBuffer()
    let valid = await buf.valid
    assert.strictEqual(valid, true)
    let listed = await buf.getOption('buflisted')
    assert.strictEqual(listed, false)
    buf = await nvim.createNewBuffer(true, true)
    valid = await buf.valid
    assert.strictEqual(valid, true)
    listed = await buf.getOption('buflisted')
    assert.strictEqual(listed, true)
    let buftype = await buf.getOption('buftype')
    assert.strictEqual(buftype, 'nofile')
  })

  it('should name float scratch buffer', async t => {
    let bufnr = await nvim.call('coc#float#create_buf', [0]) as number
    let name = await nvim.call('bufname', [bufnr])
    assert.strictEqual(name, `coc-float://${bufnr}`)
    await nvim.command(`silent! bwipeout! ${bufnr}`)
  })

  it('should set current window', async t => {
    let winid = await nvim.call('win_getid') as number
    await nvim.command('sp | sp | sp')
    let win = nvim.createWindow(winid)
    await nvim.setWindow(win)
    let curr = await nvim.call('win_getid') as number
    assert.strictEqual(curr, winid)
    await nvim.command('only!')
  })

  it('should set current tabpage', async t => {
    let tab = await nvim.tabpage
    await nvim.command('tabe')
    await nvim.setTabpage(tab)
    let nr = await nvim.call('tabpagenr')
    assert.strictEqual(nr, tab.id)
    let tabpages = await nvim.tabpages
    assert.strictEqual(tabpages.length, 2)
    await nvim.command('tabonly!')
  })

  it('should list windows', async t => {
    let wins = await nvim.windows
    assert.strictEqual(Array.isArray(wins), true)
  })

  it('should call atomic', async t => {
    await assert.rejects(async () => {
      nvim.pauseNotification()
      nvim.call('abc', [], true)
      await nvim.resumeNotification()
    }, Error)
    let res = await nvim.getVvar('errmsg')
    assert.strictEqual(res, '')
  })

  it('should execute command', async t => {
    await nvim.command('sp')
    let wins = await nvim.windows
    assert.strictEqual(wins.length, 2)
    await nvim.command('only')
    wins = await nvim.windows
    assert.strictEqual(wins.length, 1)
  })

  it('should allow legacy script on command', async t => {
    await nvim.command('let g:x = v:argv[0]." bar"')
    let res = await nvim.getVar('x')
    assert.match(String(res), new RegExp('bar'))
  })

  it('should not throw for silent error command', async t => {
    await assert.rejects(nvim.command('abcdefg'), /E492/)
    await nvim.command('silent! abcdefg')
  })

  it('should use legacy eval', async t => {
    let res = await nvim.eval('"a"."b"')
    assert.strictEqual(res, 'ab')
  })

  it('should get api info', async t => {
    let info = await nvim.apiInfo
    assert.strictEqual(typeof info[0], 'number')
  })

  it('should get buffer list', async t => {
    let bufs = await nvim.buffers
    assert.strictEqual(typeof bufs[0].id, 'number')
  })

  it('should feedkeys', async t => {
    await nvim.setLine('foo')
    await nvim.feedKeys('$', 'int', false)
    let col = await nvim.call('col', ['.'])
    assert.strictEqual(col, 3)
    await nvim.command('bd!')
  })

  it('should list runtimepath', async t => {
    let res = await nvim.runtimePaths
    assert.strictEqual(Array.isArray(res), true)
  })

  it('should get command output', async t => {
    let res = await nvim.commandOutput('echo "foo"."bar"')
    assert.match(res, /foobar/)
    await assert.rejects(nvim.commandOutput('echonot_exists'), /E492/)
  })

  it('should get line & set line', async t => {
    await nvim.setLine('foo')
    let curr = await nvim.getLine()
    assert.strictEqual(curr, 'foo')
    await nvim.deleteCurrentLine()
    curr = await nvim.getLine()
    assert.strictEqual(curr, '')
  })

  it('should get var', async t => {
    await nvim.setVar('foo', 'bar')
    let res = await nvim.getVar('foo')
    assert.strictEqual(res, 'bar')
    nvim.deleteVar('foo')
    res = await nvim.getVar('foo')
    assert.strictEqual(res, null)
  })

  it('should get vvar', async t => {
    let res = await nvim.getVvar('progpath')
    assert.match(String(res), new RegExp('vim'))
  })

  it('should get current buffer, window, tabpage', async t => {
    assert.notStrictEqual(await nvim.buffer, undefined)
    assert.notStrictEqual(await nvim.window, undefined)
    assert.notStrictEqual(await nvim.tabpage, undefined)
  })

  it('should get strwidth', async t => {
    let w = await nvim.strWidth('foo')
    assert.strictEqual(w, 3)
  })

  it('should out_write', async t => {
    nvim.outWrite('foo')
    nvim.outWriteLine('bar')
    let env = workspace.env
    let line = await shared.getCmdline(env.lines - 1)
    assert.strictEqual(line, 'foobar')
  })

  it('should err_write', async t => {
    nvim.errWrite('foo')
    nvim.errWriteLine('bar')
    let env = workspace.env
    let line = await shared.getCmdline(env.lines - 1)
    assert.strictEqual(line, 'foobar')
  })

  it('should create namespace', async t => {
    let ns = await nvim.createNamespace('foo')
    assert.strictEqual(typeof ns, 'number')
    let namespace = await nvim.createNamespace('foo')
    assert.strictEqual(ns, namespace)
  })

  it('should add and delete keymap', async t => {
    nvim.setKeymap('n', ' ', ':normal! G', { nowait: true, script: true })
    let res = await nvim.exec('nmap <space>', true)
    assert.match(res, new RegExp('normal!'))
    nvim.deleteKeymap('n', ' ')
    res = await nvim.exec('nmap <space>', true)
    assert.match(res, new RegExp('No mapping found'))
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

  it('should checkLines on CursorHold', async t => {
    let doc = await shared.createDocument()
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
    assert.strictEqual(called, true)
    assert.deepStrictEqual(doc.getLines(), ['1', '2'])
  })

  it('should set buffer option', async t => {
    await buffer.setOption('buflisted', false)
    let curr = await buffer.getOption('buflisted')
    assert.strictEqual(curr, false)
    await buffer.setOption('buflisted', true)
    curr = await buffer.getOption('buflisted')
    assert.strictEqual(curr, true)
  })

  it('should get changedtick', async t => {
    let changedtick = await buffer.changedtick
    let curr = await nvim.eval('b:changedtick')
    assert.strictEqual(changedtick, curr)
  })

  it('should add and delete buffer keymap', async t => {
    buffer.setKeymap('n', 'e', ':normal! G', { noremap: true, nowait: true, silent: true })
    let res = await nvim.exec('nmap e', true)
    assert.match(res, new RegExp('normal!'))
    buffer.deleteKeymap('n', 'e')
    res = await nvim.exec('nmap e', true)
    assert.match(res, new RegExp('No mapping found'))
  })

  it('should check buffer valid', async t => {
    let valid = await buffer.valid
    assert.strictEqual(valid, true)
    let buf = nvim.createBuffer(99)
    valid = await buf.valid
    assert.strictEqual(valid, false)
  })

  it('should get mark', async t => {
    await buffer.append(['', '', ''])
    let c = await buffer.length
    assert.strictEqual(c, 4)
    await nvim.command(`normal! Gm"`)
    let m = await buffer.mark('"')
    assert.deepStrictEqual(m, [4, 0])
    await nvim.command('bd!')
  })

  it('should add highlight', async t => {
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
    assert.deepStrictEqual(curr, [{ hlGroup: 'MoreMsg', lnum: 0, colStart: 0, colEnd: 3, id: 1001 }])
    buf.clearNamespace(ns)
    curr = await buf.getHighlights('test')
    assert.deepStrictEqual(curr, [])
  })

  it('should get line count', async t => {
    await buffer.append(['', '', '', ''])
    await nvim.command('tabe')
    let n = await buffer.length
    assert.strictEqual(n, 5)
    await nvim.command('silent! %bwipeout!')
    await assert.rejects(async () => {
      let buf = nvim.createBuffer(-1)
      await buf.length
    }, /Invalid buffer/)
  })

  it('should get lines', async t => {
    await buffer.setLines(['1', '2', '3', '4'], { start: 0, end: -1, strictIndexing: false })
    let lines = await buffer.lines
    assert.deepStrictEqual(lines, ['1', '2', '3', '4'])
    lines = await buffer.getLines({ start: 0, end: 1, strictIndexing: false })
    assert.deepStrictEqual(lines, ['1'])
    lines = await buffer.getLines({ start: -2, end: -1, strictIndexing: false })
    assert.deepStrictEqual(lines, ['4'])
    await nvim.command('bd!')
  })

  it('should set lines', async t => {
    // insert
    await buffer.setLines(['1', '2', '3'], { start: 0, end: 0, strictIndexing: true })
    let lines = await buffer.lines
    assert.deepStrictEqual(lines, ['1', '2', '3', ''])
    // replace
    await buffer.setLines(['4'], { start: 2, end: -1, strictIndexing: true })
    lines = await buffer.lines
    assert.deepStrictEqual(lines, ['1', '2', '4'])
    // delete
    await buffer.setLines([], { start: 1, end: 2, strictIndexing: true })
    lines = await buffer.lines
    assert.deepStrictEqual(lines, ['1', '4'])
    await buffer.setLines(['2', '3'], { start: 1, end: 2, strictIndexing: true })
    lines = await buffer.lines
    assert.deepStrictEqual(lines, ['1', '2', '3'])
    await nvim.command('bd!')
  })

  it('should set name', async t => {
    await buffer.setName('foo')
    let name = await buffer.name
    assert.strictEqual(name, 'foo')
    await nvim.command('bd!')
  })

  it('should change buffer variable', async t => {
    await buffer.setVar('foo', 'bar', false)
    let curr = await buffer.getVar('foo')
    assert.strictEqual(curr, 'bar')
    buffer.deleteVar('foo')
    curr = await buffer.getVar('foo')
    assert.strictEqual(curr, null)

    // another non-current buffer
    const buf2 = await nvim.createNewBuffer()
    await buf2.setVar('foo', 'qux', false)
    let curr2 = await buf2.getVar('foo')
    assert.strictEqual(curr2, 'qux')
    buf2.deleteVar('foo')
    curr = await buf2.getVar('foo')
    assert.strictEqual(curr, null)
  })

  it('should add virtual text', async t => {
    let buf = await nvim.buffer
    await nvim.call('setline', ['.', '  foo'])
    let ns = await nvim.createNamespace('virtual-text')
    buf.setVirtualText(ns, 0, [['bar', 'MoreMsg']], { text_align: 'above', indent: true })
    let types = await nvim.call('coc#api#GetNamespaceTypes', [ns])
    let props = await nvim.call('prop_list', [1, { types }]) as any[]
    assert.strictEqual(props.length, 1)
    let prop = props[0]
    if (featuredPropList) {
      assert.strictEqual(prop.text_align, 'above')
      assert.strictEqual(prop.text_padding_left, 2)
      assert.strictEqual(prop.text, 'bar')
    }
  })

  it('should add virtual text above with right_gravity', async t => {
    let buf = await nvim.buffer
    await nvim.call('setline', ['.', '  foo'])
    let ns = await nvim.createNamespace('virtual-text-gravity')
    buf.setVirtualText(ns, 0, [['bar', 'MoreMsg']], { text_align: 'above', indent: true, right_gravity: true })
    let types = await nvim.call('coc#api#GetNamespaceTypes', [ns])
    let props = await nvim.call('prop_list', [1, { types }]) as any[]
    assert.strictEqual(props.length, 1)
  })

  it('should set multiple virtual texts', async t => {
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
    assert.strictEqual(props.length, 10)
    let prop = props[0]
    assert.strictEqual(prop.lnum, 1)
    assert.strictEqual(prop.col, 1)
    if (featuredPropList) {
      assert.strictEqual(prop.text, '0')
    }
  })

  it('should update highlights', async t => {
    let buf = await nvim.buffer
    await buf.setLines(['foo', 'bar'])
    let hls = []
    hls.push({ lnum: 0, colStart: 0, colEnd: 3, hlGroup: 'MoreMsg' })
    hls.push({ lnum: 1, colStart: 1, colEnd: 3, hlGroup: 'MoreMsg' })
    buf.updateHighlights('test', hls, { priority: 80 })
    let arr = await buf.getHighlights('test')
    assert.strictEqual(arr.length, 2)
    let obj = {}
    for (const key of ['hlGroup', 'lnum', 'colStart', 'colEnd']) {
      obj[key] = arr[0][key]
    }
    assert.deepStrictEqual(obj, hls[0])
    await nvim.call('coc#highlight#clear_all', [])
    buf.updateHighlights('test', [hls[0]], { priority: 80, start: 0, end: 1 })
    arr = await buf.getHighlights('test')
    assert.strictEqual(arr.length, 1)
    let hl = { lnum: 1, colStart: 0, colEnd: -1, hlGroup: 'MoreMsg' }
    buf.updateHighlights('test', [hl], { priority: 80 })
    arr = await buf.getHighlights('test')
    assert.strictEqual(arr.length, 1)
  })

  it('should highlight ranges', async t => {
    let buf = await nvim.buffer
    await buf.setLines(['foo', 'bar'])
    const range = Range.create(0, 0, 2, 0)
    buf.highlightRanges('test', 'MoreMsg', [range])
    let arr = await buf.getHighlights('test')
    assert.strictEqual(arr.length, 2)
  })
})

describe('Window API', () => {
  let win: Window
  beforeEach(async () => {
    win = await nvim.window
  })

  it('should get buffer of window', async t => {
    let buf = await win.buffer
    let curr = await nvim.buffer
    assert.strictEqual(buf.id, curr.id)
  })

  it('should set buffer', async t => {
    let bufnr = await nvim.call('bufadd', ['foo']) as number
    await nvim.command(`call bufload(${bufnr})`)
    await win.setBuffer(nvim.createBuffer(bufnr))
    let buf = await win.buffer
    assert.strictEqual(buf.id, bufnr)
    await nvim.command('silent! %bwipeout!')
  })

  it('should get position', async t => {
    await nvim.command('sp')
    let res = await win.position
    assert.ok(res[0] > 0)
    assert.strictEqual(res[1], 0)
    await nvim.command('only!')
  })

  it('should get and set height', async t => {
    let h = await win.height
    await win.setHeight(3)
    let curr = await win.height
    assert.strictEqual(curr, 3)
    await win.setHeight(h)
  })

  it('should get and set width', async t => {
    await nvim.command('vs')
    await win.setWidth(5)
    let curr = await win.width
    assert.strictEqual(curr, 5)
    await nvim.command('only!')
  })

  it('should get and set cursor', async t => {
    let buf = await nvim.buffer
    await buf.setLines(['1', '2', '3', '4'], { start: 0, end: -1, strictIndexing: false })
    await win.setCursor([3, 1])
    let cursor = await win.cursor
    assert.deepStrictEqual(cursor, [3, 0])
    await nvim.command('bd!')
  })

  it('should get and set option', async t => {
    let relative = await win.getOption('relativenumber')
    assert.strictEqual(relative, false)
    await win.setOption('relativenumber', true)
    relative = await win.getOption('relativenumber')
    assert.strictEqual(relative, true)
    await win.setOption('relativenumber', false)
    await assert.rejects(win.getOption('not_exists'), new RegExp('Invalid'))
    await assert.rejects(win.setOption('not_exists', ''), new RegExp('Invalid'))
  })

  it('should get and set var', async t => {
    await win.setVar('foo', 'bar')
    let curr = await win.getVar('foo')
    assert.strictEqual(curr, 'bar')
    let res = await win.getVar('not_exists')
    assert.strictEqual(res, null)
    win.deleteVar('foo')
    curr = await win.getVar('foo')
    assert.strictEqual(curr, null)
  })

  it('should check window is valid', async t => {
    let valid = await win.valid
    assert.strictEqual(valid, true)
    let tab = await win.tabpage
    let nr = await tab.number
    assert.strictEqual(nr, 1)
    let n = await win.number
    assert.strictEqual(n, 1)
    await nvim.command('vs')
    await nvim.call('win_gotoid', [win.id])
    await win.close(true)
    valid = await win.valid
    assert.strictEqual(valid, false)
    await nvim.command('only!')
  })

  it('should add and clear matches', async t => {
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
    assert.ok(ids.length > 0)
    let matches = await shared.getMatches('MoreMsg')
    assert.strictEqual(matches.length, 10)
    win.clearMatches(ids)
    matches = await shared.getMatches('MoreMsg')
    assert.strictEqual(matches.length, 0)
  })
})

describe('Popup', () => {
  it('should works for popup window', async t => {
    let winid = await nvim.call('popup_create', [['foo', 'bar'], {}]) as number
    assert.ok(winid > 1000)
    let win = nvim.createWindow(winid)
    let buf = await win.buffer
    assert.ok(buf.id > 0)
    let pos = await win.position
    assert.strictEqual(typeof pos[0], 'number')
    assert.strictEqual(typeof pos[1], 'number')
    await win.setHeight(10)
    let height = await win.height
    assert.strictEqual(height, 10)
    await win.setWidth(20)
    let width = await win.width
    assert.strictEqual(width, 20)
    await win.setCursor([1, 2])
    let cur = await win.cursor
    assert.deepStrictEqual(cur, [1, 2])
    await win.setOption('relativenumber', true)
    // different on neovim which returns true and false
    let option = await win.getOption('relativenumber')
    assert.strictEqual(option, true)
    await win.setVar('foo', 'bar', false)
    let val = await win.getVar('foo')
    assert.strictEqual(val, 'bar')
    win.deleteVar('foo')
    val = await win.getVar('foo')
    assert.strictEqual(val, null)
    let valid = await win.valid
    assert.strictEqual(valid, true)
    // not work on vim
    let num = await win.number
    assert.strictEqual(num, 0)
    let tabpage = await win.tabpage
    assert.ok(tabpage.id > 0)
    await win.close(true)
    await nvim.command(`call popup_clear()`)
  })

  it('should create inputBox', async t => {
    let input = await getCurrentPlugin().window.createInputBox('title', '')
    input.title = 'new title'
    let curr: string
    input.onDidChange(text => {
      curr = text
    })
    await nvim.input('abc')
    await shared.waitValue((() => {
      return curr
    }), 'abc')
    input.dispose()
  })

  it('updates the visible input value programmatically', async t => {
    let input = await getCurrentPlugin().window.createInputBox('title', 'old')
    let changed: string | undefined
    input.onDidChange(v => {
      changed = v
    })
    // wait until the prompt terminal is ready (default value echoed)
    await shared.waitValue(async () => {
      let line = await nvim.call('term_getline', [input.bufnr, 1]) as string
      return line.includes('old')
    }, true)
    input.value = 'foo'
    await shared.wait(60)
    let line = await nvim.call('term_getline', [input.bufnr, 1]) as string
    assert.strictEqual(line.trim(), 'foo')
    assert.strictEqual(input.value, 'foo')
    assert.strictEqual(changed, 'foo')
    input.dispose()
  })
})

describe('Tabpage API', () => {
  let tab: Tabpage
  beforeEach(async () => {
    tab = await nvim.tabpage
  })

  it('should get window list', async t => {
    await nvim.command('vs')
    let wins = await tab.windows
    assert.strictEqual(wins.length, 2)
    await nvim.command('only!')
  })

  it('should get and set var', async t => {
    await tab.setVar('foo', 'bar')
    let curr = await tab.getVar('foo')
    assert.strictEqual(curr, 'bar')
    tab.deleteVar('foo')
    curr = await tab.getVar('foo')
    assert.strictEqual(curr, null)
  })

  it('should get current window', async t => {
    let valid = await tab.valid
    assert.strictEqual(valid, true)
    let win = await tab.window
    let curr = await nvim.call('win_getid')
    assert.strictEqual(win.id, curr)
  })
})

describe('notify', () => {
  it('should call function by notify', async t => {
    let curr = await nvim.call('line', ['.'])
    nvim.call('setline', [curr, 'foo'], true)
    await shared.waitValue(async () => {
      return await nvim.call('getline', [curr])
    }, 'foo')
    await nvim.command('normal! dd')
  })
})

describe('document', () => {
  async function shouldEqual(doc, synced = false): Promise<void> {
    let lines = synced ? doc.textDocument.lines : doc.getLines()
    let cur = await doc.buffer.lines
    assert.deepStrictEqual(lines, cur)
  }

  it('should not wait for lines when already applied', async t => {
    let doc = await shared.createDocument()
    doc['_changedtick'] = 10
    doc['_linesTick'] = 10
    let p = doc['waitForLineEvents']()
    assert.strictEqual(await p, undefined)
  })

  it('should settle line waiters when lines catch up', async t => {
    let doc = await shared.createDocument()
    doc['_changedtick'] = 10
    doc['_linesTick'] = 9
    let resolved = false
    let p = doc['waitForLineEvents']().then(() => {
      resolved = true
    })
    await Promise.resolve()
    assert.strictEqual(resolved, false)
    doc['settleLineWaiters'](10)
    await p
    assert.strictEqual(resolved, true)
  })

  it('should synchronize current buffer when call vim function', async t => {
    let doc = await shared.createDocument()
    await nvim.call('appendbufline', [doc.bufnr, 0, ['3', '4', '5']])
    await nvim.call('setbufline', [doc.bufnr, 1, 'txt'])
    await shouldEqual(doc)
  })

  it('should synchronize changes', async t => {
    let lines = []
    for (let i = 1; i < 8; i++) {
      lines.push(`line ${i}`)
    }
    let filepath = await createTmpFile(lines.join('\n'), disposables)
    let doc = await shared.createDocument(filepath)
    let bufnr = doc.buffer.id
    // remove first line
    nvim.pauseNotification()
    nvim.call('deletebufline', [bufnr, 1, 3], true)
    nvim.call('appendbufline', [bufnr, 0, ['3', '4', '5']], true)
    await nvim.resumeNotification(true)
    await shouldEqual(doc)
    await doc.patchChange()
  })

  it('should synchronize changes after undo', async t => {
    const filepath = await createTmpFile('abc', disposables)
    const doc = await shared.createDocument(filepath)
    nvim.pauseNotification()
    nvim.command('normal! Ofoo', true)
    nvim.command('normal! u', true)
    await nvim.resumeNotification(true)
    await shouldEqual(doc)
  })

  it('should synchronize changes after undo (2)', async t => {
    const filepath2 = await createTmpFile('abc\ndef', disposables)
    const doc2 = await shared.createDocument(filepath2)
    nvim.pauseNotification()
    nvim.command('normal! Ofoo', true)
    nvim.command('normal! u', true)
    await nvim.resumeNotification(true)
    await shouldEqual(doc2)
  })

  it('should synchronize changes after executing a command with count', async t => {
    const doc = await shared.createDocument()
    nvim.pauseNotification()
    await nvim.command('normal! 2o')
    await nvim.resumeNotification(true)
    await shouldEqual(doc)

    nvim.pauseNotification()
    await nvim.command('normal! 5o')
    await nvim.resumeNotification(true)
    await shouldEqual(doc)
  })
  it('should synchronize changes after executing a command with count (2)', async t => {
    const doc2 = await shared.createDocument()
    nvim.pauseNotification()
    await nvim.command('normal! 5o')
    await nvim.resumeNotification(true)
    await shouldEqual(doc2)
  })

  it('should synchronize changes after single line change', async t => {
    const filepath = await createTmpFile(['a', 'b', 'c'].join('\n'), disposables)
    const doc = await shared.createDocument(filepath)

    nvim.pauseNotification()
    await nvim.command('normal! O')
    await nvim.resumeNotification(true)
    await shouldEqual(doc)

    nvim.pauseNotification()
    await nvim.command('call append(0, "append")')
    await nvim.resumeNotification(true)
    await shouldEqual(doc)

    nvim.pauseNotification()
    await nvim.command('call setline(2, "set")')
    await nvim.resumeNotification(true)
    await shouldEqual(doc)

    nvim.pauseNotification()
    await nvim.command('normal! a123')
    await nvim.resumeNotification(true)
    await shouldEqual(doc)
    nvim.pauseNotification()
    await nvim.command('normal! 5a456')
    await nvim.resumeNotification(true)
    await shouldEqual(doc)

    nvim.pauseNotification()
    await nvim.command('call deletebufline("%", 2)')
    await nvim.resumeNotification(true)
    await shouldEqual(doc)
  })

  // #5542
  it('should synchronize buffered changes after setlines', async t => {
    const fileContents = [
      'import { equal } from "assert"',
      '',
      'An extra line required to let Vim buffer the changes caused by `undo`, can also be an empty line',
      'console.log(0)',
    ]
    const filepath = await createTmpFile(fileContents.join('\n'), disposables)
    const doc = await shared.createDocument(filepath)
    nvim.pauseNotification()
    // Simulate auto-import
    await nvim.command(`call setline(4, 'console.log(path)') | call appendbufline('%', 1, 'import path from "path"')`)
    await nvim.command('normal! u')

    await nvim.resumeNotification(true)
    await shouldEqual(doc)
  })

  it('should patch change of current line', async t => {
    let doc = await shared.createDocument()
    nvim.call('setline', ['.', 'foo'], true)
    await doc.patchChange()
    await shouldEqual(doc, true)
    nvim.call('setline', ['.', 'foo'], true)
    await doc.patchChange()
    await shouldEqual(doc, true)
  })

  it('should patch change', async t => {
    let doc = await workspace.document
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

  it('should synchronize after changeLines', async t => {
    let doc = await shared.createDocument()
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

  it('should add and remove lines', async t => {
    let doc = await workspace.document
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar\n')])
    await shouldEqual(doc)
    await doc.applyEdits([TextEdit.replace(Range.create(0, 0, 3, 0), '')])
    await shouldEqual(doc)
    await nvim.command('bd!')
  })

  it('should synchronize hidden buffer after replace lines', async t => {
    let doc = await shared.createDocument()
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
    assert.deepStrictEqual(curr, lines)
    let highlights = await buf.getHighlights('test')
    let arr = highlights.map(o => [o.hlGroup, o.lnum, o.colStart, o.colEnd])
    assert.deepStrictEqual(arr, hls)
  }

  it('should apply single line edit', async t => {
    let doc = await shared.createDocument()
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

  it('should apply multi lines edit', async t => {
    let doc = await shared.createDocument()
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

  it('should apply for lines replace edit', async t => {
    let doc = await shared.createDocument()
    await doc.buffer.setLines(['foo', 'bar'])
    await doc.patchChange()
    let edit = TextEdit.replace(Range.create(0, 0, 1, 0), 'a\nb\n')
    await doc.applyEdits([edit, TextEdit.insert(Position.create(1, 0), 'x')])
    let lines = await doc.buffer.lines
    assert.deepStrictEqual(lines, ['a', 'b', 'xbar'])
    edit = TextEdit.replace(Range.create(0, 0, 2, 0), '')
    await doc.applyEdits([edit, TextEdit.replace(Range.create(2, 0, 2, 1), '')])
    lines = await doc.buffer.lines
    assert.deepStrictEqual(lines, ['bar'])
  })

  it('should apply multiple edits', async t => {
    let doc = await shared.createDocument()
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
    assert.strictEqual(hls.length, 70)
  })

  it('should consider latest change', async t => {
    let doc = await shared.createDocument()
    let buf = doc.buffer
    {
      let edits: TextEdit[] = [TextEdit.insert(Position.create(0, 0), 'bar')]
      nvim.call('setline', [1, 'foo'], true)
      await doc.applyEdits(edits)
      let line = await nvim.line
      assert.strictEqual(line, 'foobar')
    }
    {
      await buf.setLines(['  foo'])
      await doc.patchChange()
      nvim.call('setline', [1, '  fooa'], true)
      nvim.call('cursor', [1, 7], true)
      let edits: TextEdit[] = [TextEdit.del(Range.create(0, 0, 0, 1))]
      await doc.applyEdits(edits)
      let line = await nvim.line
      assert.strictEqual(line, ' fooa')
    }
    {
      await buf.setLines(['foo'])
      await nvim.call('cursor', [1, 3])
      await doc.synchronize()
      nvim.call('setline', [1, 'fo'], true)
      let edits: TextEdit[] = [TextEdit.insert(Position.create(0, 0), ' ')]
      await doc.applyEdits(edits)
      let line = await nvim.line
      assert.strictEqual(line, ' fo')
    }
  })

  it('should merge concurrent edits with multibyte characters like ASCII', async t => {
    let doc = await shared.createDocument()
    let buf = doc.buffer
    await buf.setLines(['你a'])
    await doc.patchChange()
    nvim.call('setline', [1, '你ax'], true)
    nvim.call('cursor', [1, 5], true)
    let edits: TextEdit[] = [TextEdit.replace(Range.create(0, 1, 0, 2), 'b')]
    await doc.applyEdits(edits)
    let line = await nvim.line
    assert.strictEqual(line, '你bx')
  })

  it('should merge concurrent edits with emoji like ASCII', async t => {
    let doc = await shared.createDocument()
    let buf = doc.buffer
    await buf.setLines(['a😀'])
    await doc.patchChange()
    nvim.call('setline', [1, 'a😀x'], true)
    nvim.call('cursor', [1, 6], true)
    let edits: TextEdit[] = [TextEdit.replace(Range.create(0, 0, 0, 1), 'b')]
    await doc.applyEdits(edits)
    let line = await nvim.line
    assert.strictEqual(line, 'b😀x')
  })

  it('should mark common multibyte characters as equal in LCS diff', async t => {
    let diff = await nvim.call('coc#text#LcsDiff', ['你a', '你b']) as { type: string, char: string }[]
    assert.deepStrictEqual(diff, [
      { type: '=', char: '你' },
      { type: '-', char: 'a' },
      { type: '+', char: 'b' },
    ])
    diff = await nvim.call('coc#text#LcsDiff', ['a😀b', 'a😀c']) as { type: string, char: string }[]
    assert.deepStrictEqual(diff, [
      { type: '=', char: 'a' },
      { type: '=', char: '😀' },
      { type: '-', char: 'b' },
      { type: '+', char: 'c' },
    ])
    diff = await nvim.call('coc#text#LcsDiff', ['ab', 'ac']) as { type: string, char: string }[]
    assert.deepStrictEqual(diff, [
      { type: '=', char: 'a' },
      { type: '-', char: 'b' },
      { type: '+', char: 'c' },
    ])
  })

  it('should merge concurrent line edits with multibyte characters like ASCII', async t => {
    let res = await nvim.call('coc#text#DiffApply', ['你a', '你ax', '你b', -1])
    assert.strictEqual(res, '你bx')
    res = await nvim.call('coc#text#DiffApply', ['你a', '你ax', '你b', 4])
    assert.strictEqual(res, '你bx')
    res = await nvim.call('coc#text#DiffApply', ['ab', 'abx', 'ac', -1])
    assert.strictEqual(res, 'acx')
  })

  it('SimpleStringDiff produces no user-visible echo', async t => {
    let output = await nvim.call('execute', ["let g:coc_merge_result = coc#text#DiffApply('ab', 'abx', 'ac', -1)"]) as string
    assert.strictEqual(output.trim(), '')
    assert.strictEqual(await nvim.getVar('coc_merge_result'), 'acx')
  })

  it('should merge multiple concurrent edits on a line', async t => {
    let res = await nvim.call('coc#text#DiffApply', ['abcdef', 'aBcdEf', 'abCdef', -1])
    assert.strictEqual(res, 'aBCdEf')
    res = await nvim.call('coc#text#DiffApply', ['abcd', 'axbycd', 'aXcd', -1])
    assert.strictEqual(res, 'axXycd')
    res = await nvim.call('coc#text#DiffApply', ['abcdef', 'abCDef', 'aBcdef', -1])
    assert.strictEqual(res, 'aBCDef')
  })

  it('should keep user text when concurrent edits overlap', async t => {
    let res = await nvim.call('coc#text#DiffApply', ['abc', 'aXc', 'aYc', -1])
    assert.strictEqual(res, 'aXc')
    res = await nvim.call('coc#text#DiffApply', ['abcde', 'abde', 'abCde', -1])
    assert.strictEqual(res, 'abde')
    res = await nvim.call('coc#text#DiffApply', ['abcdef', 'abef', 'abcXdef', -1])
    assert.strictEqual(res, 'abef')
  })

  it('should merge multiple concurrent edits with multibyte characters', async t => {
    let res = await nvim.call('coc#text#DiffApply', ['你a你b', '你A你B', '好a你b', -1])
    assert.strictEqual(res, '好A你B')
    res = await nvim.call('coc#text#DiffApply', ['a😀b', 'B😀C', 'aX😀b', -1])
    assert.strictEqual(res, 'BX😀C')
  })

  it('should keep user text for very long lines', async t => {
    let base = 'a'.repeat(300)
    let ours = 'a'.repeat(100) + 'x' + 'a'.repeat(49) + 'y' + 'a'.repeat(150)
    let theirs = 'a'.repeat(100) + 'b' + 'a'.repeat(49) + 'c' + 'a'.repeat(149)
    let res = await nvim.call('coc#text#DiffApply', [base, ours, theirs, -1])
    assert.strictEqual(res, ours)
  })

  it('should merge multiple concurrent edits through applyEdits', async t => {
    let doc = await shared.createDocument()
    let buf = doc.buffer
    await buf.setLines(['abcdef'])
    await doc.patchChange()
    nvim.call('setline', [1, 'aBcdEf'], true)
    nvim.call('cursor', [1, 5], true)
    let edits: TextEdit[] = [TextEdit.replace(Range.create(0, 2, 0, 3), 'C')]
    await doc.applyEdits(edits)
    let line = await nvim.line
    assert.strictEqual(line, 'aBCdEf')
  })

  it('should merge fallback without performance regression', async t => {
    let base = 'a'.repeat(100)
    let ours = 'a'.repeat(30) + 'x' + 'a'.repeat(40) + 'y' + 'a'.repeat(30)
    let theirs = 'a'.repeat(30) + 'b' + 'a'.repeat(39) + 'c' + 'a'.repeat(30)
    let start = Date.now()
    for (let i = 0; i < 10; i++) {
      await nvim.call('coc#text#DiffApply', [base, ours, theirs, -1])
    }
    let elapsed = Date.now() - start
    assert.ok(elapsed < 10000)
  })
})

describe('vim highlight generation', () => {
  async function createBufferedDoc(lines: number): Promise<[number, any]> {
    let doc = await shared.createDocument()
    let buf = doc.buffer
    await buf.setLines(Array.from({ length: lines }, (_, i) => `line-${i}`))
    await doc.patchChange()
    return [doc.bufnr, doc]
  }

  it('does not write back stale highlight batches after a clear', async t => {
    let [bufnr, doc] = await createBufferedDoc(20)
    let key = `generation-${Date.now()}`
    let highlights: any[] = []
    for (let i = 0; i < 1500; i++) {
      highlights.push(['Error', i % 10, 0, 1])
    }
    await nvim.call('coc#highlight#buffer_update', [bufnr, key, highlights, 10])
    // clear the namespace while the old batch timer is still pending
    await nvim.call('coc#highlight#buffer_update', [bufnr, key, [], 10])
    await shared.wait(120)
    let props = await nvim.call('coc#vim9#Get_highlights', [bufnr, key, 0, -1]) as any[]
    assert.strictEqual(props.length, 0)
    await nvim.command(`bwipeout! ${bufnr}`)
  })

  it('keeps only the newest highlight generation', async t => {
    let [bufnr, doc] = await createBufferedDoc(20)
    let key = `generation-new-${Date.now()}`
    let oldHighlights: any[] = []
    for (let i = 0; i < 1500; i++) {
      oldHighlights.push(['Warning', i % 10, 0, 1])
    }
    await nvim.call('coc#highlight#buffer_update', [bufnr, key, oldHighlights, 10])
    let newHighlights = [['Error', 0, 0, 1], ['Error', 1, 0, 1]]
    await nvim.call('coc#highlight#buffer_update', [bufnr, key, newHighlights, 10])
    await shared.wait(120)
    let props = await nvim.call('coc#vim9#Get_highlights', [bufnr, key, 0, -1]) as any[]
    assert.strictEqual(props.length, 2)
    for (let p of props) {
      assert.strictEqual(p[0], 'Error')
    }
    await nvim.command(`bwipeout! ${bufnr}`)
  })
})
