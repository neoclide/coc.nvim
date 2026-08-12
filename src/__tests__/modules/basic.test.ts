import { isDeepStrictEqual } from 'node:util'
// Merged from highlighter.test.ts, dialog.test.ts, task.test.ts and
// sources.test.ts to share a single nvim session and reduce per-file
// startup overhead.
import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import { Disposable } from 'vscode-languageserver-protocol'
import sources from '../../completion/sources'
import { ISource, SourceType } from '../../completion/types'
import events from '../../events'
import { Dialog, DialogButton } from '../../model/dialog'
import Highlighter from '../../model/highlighter'
import Notification from '../../model/notification'
import ProgressNotification from '../../model/progress'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import helper, { createTmpFile } from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  // Native sources (around/buffer/file) are loaded via dynamic import
  // without awaiting in completion/sources.ts; wait until they are ready.
  for (let i = 0; i < 50; i++) {
    if (sources.has('around') && sources.has('buffer') && sources.has('file')) break
    await helper.wait(20)
  }
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  disposeAll(disposables)
  await helper.reset()
})

describe('Highlighter', () => {

  let highlighter: Highlighter
  beforeEach(() => {
    highlighter = new Highlighter()
  })

  it('should add line', () => {
    highlighter.addLine('foo', 'Comment')
    assert.strictEqual(highlighter.getline(0), 'foo')
    assert.strictEqual(highlighter.getline(2), '')
    assert.deepStrictEqual(highlighter.highlights, [{ lnum: 0, colStart: 0, colEnd: 3, hlGroup: 'Comment' }])
    assert.strictEqual(highlighter.content, 'foo')
  })

  it('should add lines', () => {
    highlighter.addLines(['foo', 'bar'])
    assert.strictEqual(highlighter.content, 'foo\nbar')
  })

  it('should parse ansi highlights', () => {
    const redOpen = '\x1B[31m'
    const redClose = '\x1B[39m'
    highlighter.addLine(redOpen + 'foo' + redClose + 'bar' + redOpen + redClose)
    assert.strictEqual(highlighter.content, 'foobar')
  })

  it('should add texts', () => {
    highlighter.addTexts([{ text: 'foo' }, { text: 'bar', hlGroup: 'Comment' }])
    highlighter.addText('')
    highlighter.addText(undefined)
    assert.deepStrictEqual(highlighter.highlights, [{ lnum: 0, colStart: 3, colEnd: 6, hlGroup: 'Comment' }])
    assert.strictEqual(highlighter.content, 'foobar')
  })

  it('should render to buffer', async () => {
    let buf = await nvim.createNewBuffer(true, true)
    highlighter.addLine('foo', 'Comment')
    highlighter.addLine('bar')
    nvim.pauseNotification()
    highlighter.render(buf)
    await nvim.resumeNotification()
    let lines = await buf.lines
    assert.deepStrictEqual(lines, ['foo', 'bar'])
  })
})


describe('task test', () => {
  it('should start task', async () => {
    let task = workspace.createTask('sleep')
    disposables.push(task)
    let started = await task.start({ cmd: 'sleep', args: ['50'] })
    assert.strictEqual(started, true)
  })

  it('should stop task', async () => {
    let task = workspace.createTask('sleep')
    disposables.push(task)
    await task.start({ cmd: 'sleep', args: ['50'] })
    await task.stop()
    let running = await task.running
    assert.strictEqual(running, false)
  })

  it('should emit exit event', async (t) => {
    let fn = t.mock.fn()
    let task = workspace.createTask('sleep')
    disposables.push(task)
    task.onExit(fn)
    await task.start({ cmd: 'sleep', args: ['50'] })
    await helper.wait(20)
    await task.stop()
    assert.ok((fn).mock.callCount() > 0)
  })

  it('should emit stdout event', async () => {
    let file = await createTmpFile('echo foo')
    let task = workspace.createTask('echo')
    disposables.push(task)
    let p = new Promise<string[]>(resolve => {
      let lines: string[] = []
      task.onStdout(stdout => {
        lines.push(...stdout)
      })
      task.onExit(() => {
        resolve(lines)
      })
    })
    await task.start({ cmd: '/bin/sh', args: [file] })
    let lines = await p
    assert.deepStrictEqual(lines, ['foo'])
  })

  it('should change environment variables', async () => {
    let file = await createTmpFile('echo $NODE_ENV\necho $COC_NVIM_TEST')
    let task = workspace.createTask('ENV')
    disposables.push(task)
    let lines: string[] = []
    task.onStdout(arr => {
      lines.push(...arr)
    })
    let p = new Promise<void>(resolve => {
      task.onExit(() => {
        resolve()
      })
    })
    await task.start({
      cmd: '/bin/sh',
      args: [file],
      env: {
        NODE_ENV: 'production',
        COC_NVIM_TEST: 'yes'
      }
    })
    await p
    assert.deepStrictEqual(lines, ['production', 'yes'])
    let res = await nvim.call('getenv', 'COC_NVIM_TEST')
    assert.strictEqual(res, null)
  })

  it('should receive stdout lines as expected', async () => {
    let file = await createTmpFile('echo 3\necho ""\necho 4')
    let task = workspace.createTask('ENV')
    let p = new Promise(resolve => {
      let lines: string[] = []
      task.onStdout(arr => {
        lines.push(...arr)
      })
      task.onExit(() => {
        resolve(lines)
      })
    })
    await task.start({ cmd: '/bin/sh', args: [file] })
    let lines = await p
    assert.deepStrictEqual(lines, ['3', '', '4'])
    task.dispose()
  })

  it('should emit stderr event', async () => {
    let file = await createTmpFile('console.error("start\\n\\nend");')
    let task = workspace.createTask('error')
    disposables.push(task)
    let p = new Promise<string[]>(resolve => {
      let lines: string[] = []
      task.onStderr(arr => {
        lines.push(...arr)
      })
      task.onExit(() => {
        resolve(lines)
      })
    })
    await task.start({ cmd: 'node', args: [file] })
    let lines = await p
    assert.deepStrictEqual(lines, ['start', '', 'end'])
  })

  it('should not receive event from other task', async () => {
    let task1 = workspace.createTask('one')
    disposables.push(task1)
    let count = 0
    let cb = () => {
      count++
    }
    task1.onExit(cb)
    task1.onStderr(cb)
    task1.onStdout(cb)
    let file = await createTmpFile('console.log("start");console.error("end");')
    let task = workspace.createTask('error')
    await task.start({ cmd: 'node', args: [file] })
    let promise = new Promise<void>(resolve => {
      task.onExit(() => {
        resolve(undefined)
      })
    })
    await promise
    assert.strictEqual(count, 0)
  })
})

describe('sources', () => {
  it('should check commit', () => {
    assert.strictEqual(sources.shouldCommit(undefined, undefined, ''), false)
    let source = sources.getSource('$words')
    assert.strictEqual(sources.shouldCommit(source, { word: '' }, '.'), false)
    assert.strictEqual(sources.shouldCommit(source, { word: '' }, ''), false)
  })

  it('should get normal sources', () => {
    sources.createSource({
      name: 'name',
      documentSelector: [{ language: 'vim' }],
      doComplete: () => null
    })
    let arr = sources.getNormalSources('', 'test:///1')
    let res = arr.find(o => o.name === 'name')
    assert.strictEqual(res, undefined)
    sources.createSource({
      name: 'name',
      documentSelector: [{ language: '*' }],
      doComplete: () => null
    })
    arr = sources.getNormalSources('x', 'test:///1')
    res = arr.find(o => o.name === 'name')
    assert.notStrictEqual(res, undefined)
  })

  it('should get trigger sources', () => {
    let res = sources.getTriggerSources('', 'vim', 'test:///1')
    assert.deepStrictEqual(res, [])
    let arr = ['around', 'buffer', 'file']
    res = sources.getTriggerSources('', 'vim', 'test:///1', arr)
    let find = res.find(o => arr.includes(o.name))
    assert.strictEqual(find, undefined)
    sources.createSource({
      name: 'name',
      documentSelector: [{ language: 'vim' }],
      doComplete: () => null
    })
    helper.updateConfiguration('coc.source.name.triggerCharacters', ['.'])
    res = sources.getTriggerSources('.', 'vim', 'test:///1', arr)
    find = res.find(o => o.name === 'name')
    assert.notStrictEqual(find, undefined)
    res = sources.getTriggerSources('.', 'txt', 'test:///1', arr)
    find = res.find(o => o.name === 'name')
    assert.strictEqual(find, undefined)
  })

  it('should do document enter', async (t) => {
    let fn = t.mock.fn()
    let source: ISource = {
      name: 'enter',
      enable: true,
      priority: 0,
      sourceType: SourceType.Service,
      triggerCharacters: [],
      doComplete: () => Promise.resolve({ items: [] }),
      onEnter: fn
    }
    disposables.push(sources.addSource(source))
    let buffer = await nvim.buffer
    await events.fire('BufEnter', [buffer.id])
    assert.ok((fn).mock.callCount() > 0)
  })

  it('should get sources by split filetypes', async () => {
    disposables.push(sources.addSource({
      name: 'foo',
      filetypes: ['foo'],
      enable: true,
      doComplete: () => Promise.resolve({ items: [] }),
    }))
    disposables.push(sources.addSource({
      name: 'bar',
      filetypes: ['bar'],
      enable: true,
      doComplete: () => Promise.resolve({ items: [] }),
    }))
    let arr = sources.getNormalSources('foo.bar', 'file:///a')
    let names = arr.map(s => s.name)
    assert.strictEqual(names.includes('foo'), true)
    assert.strictEqual(names.includes('bar'), true)
  })

  it('should return source states', async () => {
    disposables.push(sources.addSource({
      name: 'foo',
      documentSelector: ['vim'],
      enable: true,
      doComplete: () => Promise.resolve({ items: [] }),
    }))
    let stats = await helper.doAction('sourceStat')
    assert.strictEqual(stats.length > 1, true)
  })

  it('should toggle source state', async () => {
    await helper.doAction('toggleSource', 'around')
    let s = sources.getSource('around')
    assert.strictEqual(s.enable, false)
    sources.toggleSource('around')
  })
})

describe('sources#has', () => {

  it('should has source', () => {
    assert.strictEqual(sources.has('around'), true)
  })

  it('should not has source', () => {
    assert.strictEqual(sources.has('NotExists'), false)
  })
})

describe('sources#refresh', () => {
  it('should refresh if possible', async (t) => {
    let fn = t.mock.fn()
    let source: ISource = {
      name: 'refresh',
      enable: true,
      priority: 0,
      sourceType: SourceType.Service,
      triggerCharacters: [],
      doComplete: () => Promise.resolve({ items: [] }),
      refresh: fn
    }
    disposables.push(sources.addSource(source))
    await helper.doAction('refreshSource', 'refresh')
    assert.ok((fn).mock.callCount() > 0)
  })

  it('should work if refresh not defined', async () => {
    let source: ISource = {
      name: 'refresh',
      enable: true,
      priority: 0,
      sourceType: SourceType.Service,
      triggerCharacters: [],
      doComplete: () => Promise.resolve({ items: [] })
    }
    disposables.push(sources.addSource(source))
    await sources.refresh('refresh')
  })
})

describe('sources#createSource', () => {
  it('should throw on create source', async () => {
    assert.throws(() => {
      sources.createSource({
        doComplete: () => Promise.resolve({
          items: [{
            word: 'custom'
          }]
        })
      } as any)
    })
  })

  it('should create vim source', async () => {
    let folder = path.resolve(__dirname, '..')
    await nvim.command(`set runtimepath+=${folder}`)
    disposables.push({
      dispose: () => {
        sources.removeSource('email')
      }
    })
    await helper.waitValue(() => {
      return sources.has('email')
    }, true)
    await helper.createDocument()
    await nvim.input('i@')
    await helper.visible('foo@gmail.com')
  })
})

describe('sources#getTriggerSources()', () => {
  it('should filter by filetypes', async () => {
    let source: ISource = {
      name: 'test',
      enable: true,
      priority: 0,
      filetypes: ['javascript'],
      sourceType: SourceType.Service,
      triggerCharacters: ['#'],
      doComplete: () => Promise.resolve({ items: [] })
    }
    disposables.push(sources.addSource(source))
    let res = sources.getTriggerSources('#', 'javascript', 'file:///tmp.js')
    assert.notStrictEqual(res.find(o => o.name == 'test'), undefined)
  })

  it('should filter by documentSelector', async () => {
    let source: ISource = {
      name: 'test',
      enable: true,
      priority: 0,
      documentSelector: [{ language: 'javascript' }],
      sourceType: SourceType.Service,
      triggerCharacters: ['#'],
      doComplete: () => Promise.resolve({ items: [] })
    }
    disposables.push(sources.addSource(source))
    let res = sources.getTriggerSources('#', 'javascript', 'file:///tmp.js')
    assert.notStrictEqual(res.find(o => o.name == 'test'), undefined)
  })

  it('should filter disabled sources', async () => {
    await nvim.setLine('foo bar ')
    let buf = await nvim.buffer
    await buf.setVar('coc_disabled_sources', ['around', 'buffer', 'file'])
    await nvim.input('Af')
    await helper.waitFor('mode', [], 'i')
    await nvim.input('/')
    await helper.waitValue(() => nvim.call('pumvisible'), 0)
    let visible = await nvim.call('pumvisible')
    assert.strictEqual(visible, 0)
  })
})

describe('Dialog module', () => {
  it('should show dialog', async () => {
    let dialog = new Dialog(nvim, { content: '你好' })
    assert.strictEqual(await dialog.winid, null)
    await dialog.show({})
    let winid = await dialog.winid
    let win = nvim.createWindow(winid)
    let width = await win.width
    assert.strictEqual(width, 4)
    await nvim.call('coc#float#close', [winid])
  })

  it('should invoke callback with index -1', async (t) => {
    let callback = t.mock.fn()
    let dialog = new Dialog(nvim, { content: '你好', callback, highlights: [] })
    await dialog.show({})
    let winid = await dialog.winid
    await nvim.call('coc#float#close', [winid])
    await helper.waitValue(() => callback.mock.calls.length, 1)
    assert.ok((callback).mock.calls.some(call => isDeepStrictEqual(call.arguments, [-1])))
  })

  it('should invoke callback on click', async (t) => {
    let callback = t.mock.fn()
    let buttons: DialogButton[] = [{
      index: 0,
      text: 'yes'
    }, {
      index: 1,
      text: 'no'
    }]
    let dialog = new Dialog(nvim, { content: '你好', buttons, callback })
    await dialog.show({})
    let winid = await dialog.winid
    let btnwin = await nvim.call('coc#float#get_related', [winid, 'buttons'])
    await nvim.call('win_gotoid', [btnwin])
    await nvim.call('cursor', [2, 1])
    await nvim.call('coc#float#nvim_float_click', [])
    await helper.wait(20)
    assert.ok((callback).mock.calls.some(call => isDeepStrictEqual(call.arguments, [0])))
  })
})

describe('Notification', () => {
  it('should invoke callback', async () => {
    let n = new Notification(nvim, { content: 'foo\nbar' })
    await n.show({})
    await events.fire('FloatBtnClick', [n.bufnr, 1])
    n.dispose()
    let called = false
    n = new Notification(nvim, {
      content: 'foo\nbar',
      buttons: [{ index: 1, text: 'text' }, { index: 2, text: 'disabled', disabled: true }],
      callback: () => {
        called = true
      }
    })
    await n.show({ border: true })
    await events.fire('FloatBtnClick', [n.bufnr, 0])
    assert.strictEqual(called, true)
  })
})

describe('ProgressNotification', () => {
  it('should cancel on window close', async () => {
    let n = new ProgressNotification(nvim, {
      cancellable: true,
      task: (_progress, token) => {
        return new Promise(resolve => {
          token.onCancellationRequested(() => {
            resolve(undefined)
          })
        })
      }
    })
    await n.show({})
    let p = new Promise(resolve => {
      n.onDidFinish(e => {
        resolve(e)
      })
    })
    await nvim.call('coc#float#close_all', [])
    let res = await p
    assert.strictEqual(res, undefined)
  })

  it('should not fire event when disposed', async () => {
    let fn = async (success: boolean) => {
      let n = new ProgressNotification(nvim, {
        cancellable: true,
        task: () => {
          return new Promise((resolve, reject) => {
            if (success) {
              setTimeout(resolve, 20)
            } else {
              setTimeout(() => {
                reject(new Error('timeout'))
              }, 20)
            }
          })
        }
      })
      let times = 0
      n.onDidFinish(() => {
        times++
      })
      await n.show({})
      n.dispose()
      await helper.wait(20)
      assert.strictEqual(times, 0)
    }
    await fn(true)
    await fn(false)
  })
})
