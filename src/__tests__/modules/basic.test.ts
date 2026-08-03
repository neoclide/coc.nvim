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
    expect(highlighter.getline(0)).toBe('foo')
    expect(highlighter.getline(2)).toBe('')
    expect(highlighter.highlights).toEqual([{ lnum: 0, colStart: 0, colEnd: 3, hlGroup: 'Comment' }])
    expect(highlighter.content).toBe('foo')
  })

  it('should add lines', () => {
    highlighter.addLines(['foo', 'bar'])
    expect(highlighter.content).toBe('foo\nbar')
  })

  it('should parse ansi highlights', () => {
    const redOpen = '\x1B[31m'
    const redClose = '\x1B[39m'
    highlighter.addLine(redOpen + 'foo' + redClose + 'bar' + redOpen + redClose)
    expect(highlighter.content).toBe('foobar')
  })

  it('should add texts', () => {
    highlighter.addTexts([{ text: 'foo' }, { text: 'bar', hlGroup: 'Comment' }])
    highlighter.addText('')
    highlighter.addText(undefined)
    expect(highlighter.highlights).toEqual([{ lnum: 0, colStart: 3, colEnd: 6, hlGroup: 'Comment' }])
    expect(highlighter.content).toBe('foobar')
  })

  it('should render to buffer', async () => {
    let buf = await nvim.createNewBuffer(true, true)
    highlighter.addLine('foo', 'Comment')
    highlighter.addLine('bar')
    nvim.pauseNotification()
    highlighter.render(buf)
    await nvim.resumeNotification()
    let lines = await buf.lines
    expect(lines).toEqual(['foo', 'bar'])
  })
})


describe('task test', () => {
  it('should start task', async () => {
    let task = workspace.createTask('sleep')
    disposables.push(task)
    let started = await task.start({ cmd: 'sleep', args: ['50'] })
    expect(started).toBe(true)
  })

  it('should stop task', async () => {
    let task = workspace.createTask('sleep')
    disposables.push(task)
    await task.start({ cmd: 'sleep', args: ['50'] })
    await task.stop()
    let running = await task.running
    expect(running).toBe(false)
  })

  it('should emit exit event', async () => {
    let fn = vi.fn()
    let task = workspace.createTask('sleep')
    disposables.push(task)
    task.onExit(fn)
    await task.start({ cmd: 'sleep', args: ['50'] })
    await helper.wait(20)
    await task.stop()
    expect(fn).toHaveBeenCalled()
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
    expect(lines).toEqual(['foo'])
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
    expect(lines).toEqual(['production', 'yes'])
    let res = await nvim.call('getenv', 'COC_NVIM_TEST')
    expect(res).toBeNull()
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
    expect(lines).toEqual(['3', '', '4'])
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
    expect(lines).toEqual(['start', '', 'end'])
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
    expect(count).toBe(0)
  })
})

describe('sources', () => {
  it('should check commit', () => {
    expect(sources.shouldCommit(undefined, undefined, '')).toBe(false)
    let source = sources.getSource('$words')
    expect(sources.shouldCommit(source, { word: '' }, '.')).toBe(false)
    expect(sources.shouldCommit(source, { word: '' }, '')).toBe(false)
  })

  it('should get normal sources', () => {
    sources.createSource({
      name: 'name',
      documentSelector: [{ language: 'vim' }],
      doComplete: () => null
    })
    let arr = sources.getNormalSources('', 'test:///1')
    let res = arr.find(o => o.name === 'name')
    expect(res).toBeUndefined()
    sources.createSource({
      name: 'name',
      documentSelector: [{ language: '*' }],
      doComplete: () => null
    })
    arr = sources.getNormalSources('x', 'test:///1')
    res = arr.find(o => o.name === 'name')
    expect(res).toBeDefined()
  })

  it('should get trigger sources', () => {
    let res = sources.getTriggerSources('', 'vim', 'test:///1')
    expect(res).toEqual([])
    let arr = ['around', 'buffer', 'file']
    res = sources.getTriggerSources('', 'vim', 'test:///1', arr)
    let find = res.find(o => arr.includes(o.name))
    expect(find).toBeUndefined()
    sources.createSource({
      name: 'name',
      documentSelector: [{ language: 'vim' }],
      doComplete: () => null
    })
    helper.updateConfiguration('coc.source.name.triggerCharacters', ['.'])
    res = sources.getTriggerSources('.', 'vim', 'test:///1', arr)
    find = res.find(o => o.name === 'name')
    expect(find).toBeDefined()
    res = sources.getTriggerSources('.', 'txt', 'test:///1', arr)
    find = res.find(o => o.name === 'name')
    expect(find).toBeUndefined()
  })

  it('should do document enter', async () => {
    let fn = vi.fn()
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
    expect(fn).toHaveBeenCalled()
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
    expect(names.includes('foo')).toBe(true)
    expect(names.includes('bar')).toBe(true)
  })

  it('should return source states', async () => {
    disposables.push(sources.addSource({
      name: 'foo',
      documentSelector: ['vim'],
      enable: true,
      doComplete: () => Promise.resolve({ items: [] }),
    }))
    let stats = await helper.doAction('sourceStat')
    expect(stats.length > 1).toBe(true)
  })

  it('should toggle source state', async () => {
    await helper.doAction('toggleSource', 'around')
    let s = sources.getSource('around')
    expect(s.enable).toBe(false)
    sources.toggleSource('around')
  })
})

describe('sources#has', () => {

  it('should has source', () => {
    expect(sources.has('around')).toBe(true)
  })

  it('should not has source', () => {
    expect(sources.has('NotExists')).toBe(false)
  })
})

describe('sources#refresh', () => {
  it('should refresh if possible', async () => {
    let fn = vi.fn()
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
    expect(fn).toHaveBeenCalled()
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
    expect(() => {
      sources.createSource({
        doComplete: () => Promise.resolve({
          items: [{
            word: 'custom'
          }]
        })
      } as any)
    }).toThrow()
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
    expect(res.find(o => o.name == 'test')).toBeDefined()
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
    expect(res.find(o => o.name == 'test')).toBeDefined()
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
    expect(visible).toBe(0)
  })
})

describe('Dialog module', () => {
  it('should show dialog', async () => {
    let dialog = new Dialog(nvim, { content: '你好' })
    expect(await dialog.winid).toBeNull()
    await dialog.show({})
    let winid = await dialog.winid
    let win = nvim.createWindow(winid)
    let width = await win.width
    expect(width).toBe(4)
    await nvim.call('coc#float#close', [winid])
  })

  it('should invoke callback with index -1', async () => {
    let callback = vi.fn()
    let dialog = new Dialog(nvim, { content: '你好', callback, highlights: [] })
    await dialog.show({})
    let winid = await dialog.winid
    await nvim.call('coc#float#close', [winid])
    await helper.waitValue(() => callback.mock.calls.length, 1)
    expect(callback).toHaveBeenCalledWith(-1)
  })

  it('should invoke callback on click', async () => {
    let callback = vi.fn()
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
    expect(callback).toHaveBeenCalledWith(0)
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
    expect(called).toBe(true)
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
    expect(res).toBeUndefined()
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
      expect(times).toBe(0)
    }
    await fn(true)
    await fn(false)
  })
})
