import { Neovim } from '@chemzqm/neovim'
import { Disposable, Emitter, Range } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { TreeItem, TreeItemCollapsibleState } from '../../tree'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import events from '../../events'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []

interface FileNode {
  filepath: string
  isFolder?: boolean
}

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  let config = workspace.getConfiguration('coc.preferences')
  config.update('enableMessageDialog', true)
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
  disposeAll(disposables)
  disposables = []
})

describe('window functions', () => {
  it('should get offset', async () => {
    let doc = await helper.createDocument()
    await doc.applyEdits([{ range: Range.create(0, 0, 0, 0), newText: 'foo\nbar' }])
    let buf = await nvim.buffer
    await buf.setLines(['foo', 'bar'], { start: 0, end: -1 })
    await helper.wait(100)
    await nvim.call('cursor', [2, 2])
    let n = await window.getOffset()
    expect(n).toBe(5)
  })

  it('should echo lines', async () => {
    await window.echoLines(['a', 'b'])
    let ch = await nvim.call('screenchar', [79, 1])
    let s = String.fromCharCode(ch)
    expect(s).toBe('a')
  })

  it('should echo multiple lines with truncate', async () => {
    await window.echoLines(['a', 'b', 'd', 'e'], true)
    let ch = await nvim.call('screenchar', [79, 1])
    let s = String.fromCharCode(ch)
    expect(s).toBe('a')
  })

  it('should run terminal command', async () => {
    let res = await window.runTerminalCommand('ls', __dirname)
    expect(res.success).toBe(true)
  })

  it('should open temimal buffer', async () => {
    let bufnr = await window.openTerminal('ls', { autoclose: false, keepfocus: false })
    let curr = await nvim.eval('bufnr("%")')
    expect(curr).toBe(bufnr)
    let buftype = await nvim.eval('&buftype')
    expect(buftype).toBe('terminal')
  })

  it('should show mesages', async () => {
    await helper.edit()
    window.showMessage('error', 'error')
    await helper.wait(100)
    let str = await helper.getCmdline()
    expect(str).toMatch('error')
    window.showMessage('warning', 'warning')
    await helper.wait(100)
    str = await helper.getCmdline()
    expect(str).toMatch('warning')
    window.showMessage('moremsg')
    await helper.wait(100)
    str = await helper.getCmdline()
    expect(str).toMatch('moremsg')
  })

  it('should create outputChannel', () => {
    let channel = window.createOutputChannel('channel')
    expect(channel.name).toBe('channel')
  })

  it('should create TreeView instance', async () => {
    let emitter = new Emitter<FileNode | undefined>()
    let removed = false
    let treeView = window.createTreeView('files', {
      treeDataProvider: {
        onDidChangeTreeData: emitter.event,
        getChildren: root => {
          if (root) return undefined
          if (removed) return [{ filepath: '/foo/a', isFolder: true }]
          return [{ filepath: '/foo/a', isFolder: true }, { filepath: '/foo/b.js' }]
        },
        getTreeItem: (node: FileNode) => {
          let { filepath, isFolder } = node
          return new TreeItem(URI.file(filepath), isFolder ? TreeItemCollapsibleState.Collapsed : TreeItemCollapsibleState.None)
        },
      }
    })
    disposables.push(emitter)
    disposables.push(treeView)
    await treeView.show()
    await helper.wait(50)
    await nvim.command('exe 2')
    await nvim.input('t')
    await helper.wait(50)
    let lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['files', '- a', '  b.js'])
    removed = true
    emitter.fire(undefined)
    await helper.wait(50)
    lines = await nvim.call('getline', [1, '$'])
    expect(lines).toEqual(['files', '- a'])
  })

  it('should show outputChannel', async () => {
    window.createOutputChannel('channel')
    window.showOutputChannel('channel')
    await helper.wait(50)
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toMatch('channel')
  })

  it('should not show none exists channel', async () => {
    let buf = await nvim.buffer
    let bufnr = buf.id
    window.showOutputChannel('NONE')
    await helper.wait(10)
    buf = await nvim.buffer
    expect(buf.id).toBe(bufnr)
  })

  it('should get cursor position', async () => {
    await helper.createDocument()
    await nvim.setLine('       ')
    await nvim.call('cursor', [1, 3])
    let pos = await window.getCursorPosition()
    expect(pos).toEqual({
      line: 0,
      character: 2
    })
  })

  it('should moveTo position in insert mode', async () => {
    await helper.edit()
    await nvim.setLine('foo')
    await nvim.input('i')
    await window.moveTo({ line: 0, character: 3 })
    let col = await nvim.call('col', '.')
    expect(col).toBe(4)
    let virtualedit = await nvim.getOption('virtualedit')
    expect(virtualedit).toBe('')
  })

  it('should choose quickpick', async () => {
    let p = window.showQuickpick(['a', 'b'])
    await helper.wait(100)
    await nvim.input('1')
    await nvim.input('<CR>')
    let res = await p
    expect(res).toBe(0)
  })

  it('should cancel quickpick', async () => {
    let p = window.showQuickpick(['a', 'b'])
    await helper.wait(100)
    await nvim.input('<esc>')
    let res = await p
    expect(res).toBe(-1)
  })

  it('should show prompt', async () => {
    let p = window.showPrompt('prompt')
    await helper.wait(100)
    await nvim.input('y')
    let res = await p
    expect(res).toBe(true)
  })

  it('should show dialog', async () => {
    let dialog = await window.showDialog({ content: 'foo' })
    let winid = await dialog.winid
    expect(winid).toBeDefined()
    expect(winid).toBeGreaterThan(1000)
  })

  it('should show menu', async () => {
    let p = window.showMenuPicker(['a', 'b', 'c'], 'choose item')
    await helper.wait(100)
    let exists = await nvim.call('coc#float#has_float', [])
    expect(exists).toBe(1)
    await nvim.input('2')
    let res = await p
    expect(res).toBe(1)
  })

  it('should request input', async () => {
    let winid = await nvim.call('win_getid')
    let p = window.requestInput('Name')
    await helper.wait(100)
    await nvim.input('bar<enter>')
    let res = await p
    let curr = await nvim.call('win_getid')
    expect(curr).toBe(winid)
    expect(res).toBe('bar')
  })

  it('should return null when input empty', async () => {
    let p = window.requestInput('Name')
    await helper.wait(30)
    await nvim.input('<enter>')
    let res = await p
    expect(res).toBeNull()
  })

  it('should return select items for picker', async () => {
    let curr = await nvim.call('win_getid')
    let p = window.showPickerDialog(['foo', 'bar'], 'select')
    await helper.wait(100)
    await nvim.input(' ')
    await helper.wait(30)
    await nvim.input('<cr>')
    let res = await p
    let winid = await nvim.call('win_getid')
    expect(winid).toBe(curr)
    expect(res).toEqual(['foo'])
  })

  async function ensureNotification(idx: number): Promise<void> {
    let ids = await nvim.call('coc#float#get_float_win_list')
    expect(ids.length).toBe(1)
    let win = nvim.createWindow(ids[0])
    let kind = await win.getVar('kind')
    expect(kind).toBe('notification')
    let bufnr = await nvim.call('winbufnr', [win.id])
    await events.fire('FloatBtnClick', [bufnr, idx])
  }

  it('should show information message', async () => {
    let p = window.showInformationMessage('information message', 'first', 'second')
    await helper.wait(50)
    await ensureNotification(0)
    let res = await p
    expect(res).toBe('first')
  })

  it('should show warning message', async () => {
    let p = window.showWarningMessage('warning message', 'first', 'second')
    await helper.wait(50)
    await ensureNotification(1)
    let res = await p
    expect(res).toBe('second')
  })

  it('should show error message', async () => {
    let p = window.showErrorMessage('error message', 'first', 'second')
    await helper.wait(50)
    await ensureNotification(0)
    let res = await p
    expect(res).toBe('first')
  })
})

describe('window notifications', () => {
  it('should show notification with options', async () => {
    let res = await window.showNotification({
      content: 'my notification',
      close: true,
      title: 'title',
      timeout: 500
    })
    expect(res).toBe(true)
    let ids = await nvim.call('coc#float#get_float_win_list')
    expect(ids.length).toBe(1)
    let win = nvim.createWindow(ids[0])
    let kind = await win.getVar('kind')
    expect(kind).toBe('notification')
    let winid = await nvim.call('coc#float#get_related', [win.id, 'border'])
    let bufnr = await nvim.call('winbufnr', [winid])
    let buf = nvim.createBuffer(bufnr)
    let lines = await buf.lines
    expect(lines[0].includes('title')).toBe(true)
    await helper.wait(600)
    let valid = await nvim.call('coc#float#valid', [win.id])
    expect(valid).toBeFalsy()
  })

  it('should show progress notification', async () => {
    let called = 0
    let res = await window.withProgress({ title: 'Downloading', cancellable: true }, (progress, token) => {
      let n = 0
      return new Promise(resolve => {
        let interval = setInterval(() => {
          progress.report({ message: 'progress', increment: 1 })
          n = n + 10
          called = called + 1
          if (n == 100) {
            clearInterval(interval)
            resolve('done')
          }
        }, 100)
        token.onCancellationRequested(() => {
          clearInterval(interval)
          resolve(undefined)
        })
      })
    })
    expect(called).toBe(10)
    expect(res).toBe('done')
  })

  it('should cancel progress notification on window close', async () => {
    let called = 0
    let p = window.withProgress({ title: 'Downloading', cancellable: true }, (progress, token) => {
      let n = 0
      return new Promise(resolve => {
        let interval = setInterval(() => {
          progress.report({ message: 'progress', increment: 1 })
          n = n + 10
          called = called + 1
          if (n == 100) {
            clearInterval(interval)
            resolve('done')
          }
        }, 100)
        token.onCancellationRequested(() => {
          clearInterval(interval)
          resolve(undefined)
        })
      })
    })
    await helper.wait(300)
    await nvim.call('coc#float#close_all', [])
    let res = await p
    expect(called).toBeLessThan(10)
    expect(res).toBe(undefined)
  })

  it('should cancel progress when window not shown', async () => {
    let called = 0
    let p = window.withProgress({ title: 'Process' }, () => {
      called = called + 1
      return Promise.resolve()
    })
    await p
    await helper.wait(120)
    let floats = await helper.getFloats()
    expect(called).toBe(1)
    expect(floats.length).toBe(0)
  })
})
