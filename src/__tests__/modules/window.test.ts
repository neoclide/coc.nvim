import { isDeepStrictEqual } from 'node:util'
import { Buffer, Neovim } from '@chemzqm/neovim'
import { HighlightItem } from '@chemzqm/neovim/lib/api/Buffer'
import { CancellationToken, Disposable, Emitter } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { convertHighlightItem } from '../../core/highlights'
import events from '../../events'
import Notification, { toButtons, toTitles } from '../../model/notification'
import { formatMessage } from '../../model/progress'
import { TreeItem, TreeItemCollapsibleState } from '../../tree'
import { disposeAll } from '../../util'
import window, { Window } from '../../window'
import workspace from '../../workspace'
import helper, { createTmpFile } from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []

interface FileNode {
  filepath: string
  isFolder?: boolean
}

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
  disposeAll(disposables)
  disposables = []
})

describe('window', () => {
  describe('functions', () => {
    it('should formatMessage', () => {
      assert.notStrictEqual(Window, undefined)
      assert.strictEqual(formatMessage('a', 'b', 1), 'a b 1%')
      assert.strictEqual(formatMessage(undefined, undefined, 1), '1%')
      assert.strictEqual(formatMessage('a', undefined, 0), 'a')
    })

    it('should convert highlight item', () => {
      let res = convertHighlightItem({
        colStart: 0,
        colEnd: 1,
        hlGroup: 'Search',
        lnum: 0,
        combine: true
      })
      assert.deepStrictEqual(res, ['Search', 0, 0, 1, 1, 0, 0])
    })

    it('should get offset', async () => {
      let buf = await nvim.buffer
      await nvim.call('setline', [buf.id, ['bar', 'foo']])
      await nvim.call('cursor', [2, 2])
      let n = await window.getOffset()
      assert.strictEqual(n, 5)
    })

    it('should get cursor screen position', async () => {
      let pos = await window.getCursorScreenPosition()
      assert.deepStrictEqual(pos, { row: 0, col: 0 })
    })

    it('should export terminals', async () => {
      assert.strictEqual(Array.isArray(window.terminals), true)
      assert.notStrictEqual(window.onDidOpenTerminal, undefined)
      assert.notStrictEqual(window.onDidCloseTerminal, undefined)
    })

    it('should selected range', async () => {
      await nvim.setLine('foobar')
      await nvim.command('normal! viw')
      await nvim.eval(`feedkeys("\\<Esc>", 'in')`)
      let range = await window.getSelectedRange('v')
      assert.deepStrictEqual(range, { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } })
    })

    it('should run terminal command', async () => {
      let res = await window.runTerminalCommand('ls', __dirname)
      assert.strictEqual(res.success, true)
      res = await window.runTerminalCommand('echo 1', process.cwd(), true)
      assert.strictEqual(res.success, true)
    })

    it('should open temimal buffer', async () => {
      let bufnr = await window.openTerminal('ls', { autoclose: false, keepfocus: false })
      let curr = await nvim.eval('bufnr("%")')
      assert.strictEqual(curr, bufnr)
      let buftype = await nvim.eval('&buftype')
      assert.strictEqual(buftype, 'terminal')
    })

    it('should create float factory', async () => {
      helper.updateConfiguration('coc.preferences.excludeImageLinksInMarkdownDocument', false)
      helper.updateConfiguration('floatFactory.floatConfig', {
        winblend: 10,
        rounded: true,
        border: true,
        close: true
      })
      let f = window.createFloatFactory({ modes: ['n', 'i'] })
      await f.show([{ content: 'content', filetype: 'txt' }])
      let win = await helper.getFloat()
      assert.notStrictEqual(win, undefined)
      let id = await nvim.call('coc#float#get_related', [win.id, 'border', 0]) as number
      assert.ok((id) > (0))
    })

    it('should createStatusBarItem', async () => {
      let item = window.createStatusBarItem(1, { progress: true })
      item.text = 'test'
      item.show()
      assert.strictEqual(item.text, 'test')
      assert.strictEqual(item.isProgress, true)
      let other = window.createStatusBarItem()
      other.text = 'bar'
      other.show()
      await helper.waitValue(async () => {
        let res = await nvim.getVar('coc_status') as string
        return res.includes('bar')
      }, true)
      item.hide()
      item.dispose()
      other.dispose()
    })

    it('should create outputChannel', () => {
      let channel = window.createOutputChannel('channel')
      assert.strictEqual(channel.name, 'channel')
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
      let filetype = await nvim.eval('&filetype')
      assert.strictEqual(filetype, 'coctree')
    })

    it('should show outputChannel', async () => {
      window.createOutputChannel('channel')
      window.showOutputChannel('channel')
      let buf = await nvim.buffer
      let name = await buf.name
      assert.ok((name).includes('channel'))
    })

    it('should not show channel not exists', async () => {
      let buf = await nvim.buffer
      let bufnr = buf.id
      window.showOutputChannel('NONE', 'edit')
      await helper.wait(20)
      buf = await nvim.buffer
      assert.strictEqual(buf.id, bufnr)
    })

    it('should get cursor position', async () => {
      await nvim.setLine('       ')
      await nvim.call('cursor', [1, 3])
      let pos = await window.getCursorPosition()
      assert.deepStrictEqual(pos, {
        line: 0,
        character: 2
      })
    })

    it('should moveTo position in insert mode', async () => {
      await nvim.setLine('foo')
      await nvim.input('i')
      await window.moveTo({ line: 0, character: 3 })
      let col = await nvim.call('col', '.')
      assert.strictEqual(col, 4)
      let virtualedit = await nvim.getOption('virtualedit')
      assert.strictEqual(virtualedit, '')
    })

    it('should choose quickpick', async () => {
      let p = window.showQuickpick(['a', 'b'])
      await helper.waitPrompt()
      await nvim.input('1')
      await nvim.input('<CR>')
      let res = await p
      assert.strictEqual(res, 0)
    })

    it('should cancel quickpick', async () => {
      let p = window.showQuickpick(['a', 'b'])
      await helper.waitPrompt()
      await nvim.input('<esc>')
      let res = await p
      assert.strictEqual(res, -1)
    })

    it('should show prompt', async () => {
      let p = window.showPrompt('prompt')
      await helper.wait(50)
      await nvim.input('y')
      let res = await p
      assert.strictEqual(res, true)
    })

    it('should show dialog', async () => {
      let dialog = await window.showDialog({ content: 'foo' })
      let winid = await dialog.winid
      assert.notStrictEqual(winid, undefined)
      assert.ok((winid) > (1000))
    })

    it('should show menu', async () => {
      let p = window.showMenuPicker(['a', 'b', 'c'], 'choose item')
      let winid = await helper.waitFloat()
      let bufnr = await nvim.call('winbufnr', [winid]) as number
      await nvim.input('2')
      let res = await p
      assert.strictEqual(res, 1)
      await helper.waitValue(async () => {
        return await nvim.call('bufexists', [bufnr])
      }, 0)
      res = await window.showMenuPicker(['foo'], { title: 'title', position: 'center' }, CancellationToken.Cancelled)
      assert.strictEqual(res, -1)
    })

    it('should return select items for picker', async () => {
      let curr = await nvim.call('win_getid')
      let p = window.showPickerDialog(['foo', 'bar'], 'select')
      await helper.waitFloat()
      await helper.waitPrompt()
      await nvim.input(' ')
      await nvim.input('<cr>')
      let res = await p
      let winid = await nvim.call('win_getid')
      assert.strictEqual(winid, curr)
      assert.deepStrictEqual(res, ['foo'])
    })

    it('should return undefined for picker', async () => {
      let p = window.showPickerDialog(['foo', 'bar'], 'select')
      await helper.waitFloat()
      await helper.waitPrompt()
      await nvim.input('<esc>')
      let res = await p
      assert.strictEqual(res, undefined)
    })

    it('should return undefined when cancelled', async () => {
      let token = CancellationToken.Cancelled
      let res = await window.showPickerDialog(['foo', 'bar'], 'select', token)
      assert.strictEqual(res, undefined)
    })

    it('should get visible ranges of bufnr', async () => {
      let buf = await helper.edit('not_exists')
      let range = await window.getVisibleRanges(buf.id)
      assert.strictEqual(range.length, 1)
      let winid = await nvim.call('win_getid') as number
      range = await window.getVisibleRanges(buf.id, winid)
      assert.strictEqual(range.length, 1)
      range = await window.getVisibleRanges(buf.id, 9999)
      assert.strictEqual(range.length, 0)
      await nvim.command('enew')
      range = await window.getVisibleRanges(buf.id)
      assert.strictEqual(range.length, 0)
    })

    it('should requestInputList', async () => {
      Object.assign(workspace.env, { lines: 3 })
      {
        let p = window.requestInputList('prompt', ['foo', 'bar', 'abc', 'def'])
        await helper.waitValue(async () => {
          let m = await nvim.mode
          return m.mode
        }, 'c')
        await nvim.input('1<cr>')
        let res = await p
        assert.strictEqual(res, 0)
      }
      {
        let p = window.requestInputList('prompt', ['foo', 'bar', 'abc', 'def'])
        await helper.waitValue(async () => {
          let m = await nvim.mode
          return m.mode
        }, 'c')
        await nvim.input('8<cr>')
        let res = await p
        assert.strictEqual(res, -1)
      }
    })
  })

  describe('window showMessage', () => {
    async function ensureNotification(idx: number): Promise<void> {
      let winid = await helper.waitFloat()
      await nvim.call('coc#notify#choose', [winid, idx])
    }

    it('should echo lines', async () => {
      await window.echoLines(['a', 'b'])
      let ch = await nvim.call('screenchar', [79, 1]) as number
      let s = String.fromCharCode(ch)
      assert.strictEqual(s, 'a')
    })

    it('should echo multiple lines with truncate', async () => {
      await window.echoLines(['a', 'b'.repeat(99), 'd', 'e'], true)
      let ch = await nvim.call('screenchar', [79, 1]) as number
      let s = String.fromCharCode(ch)
      assert.strictEqual(s, 'a')
      await window.echoLines(['a', 'b'.repeat(200)], true)
    })

    it('should show messages', async () => {
      window.showMessage('more')
      window.showMessage('error', 'error')
      window.showMessage('warning', 'warning')
      window.showMessage('moremsg', 'more')
    })

    it('should cap notification history', async () => {
      let notifications: any = window.notifications
      notifications.clearHistory()
      for (let i = 0; i < 120; i++) {
        await notifications._showMessage('Info', `message ${i}`, [])
      }
      assert.strictEqual(notifications._history.length, 100)
      assert.strictEqual(notifications._history[0].message, 'message 20')
      assert.strictEqual(notifications._history[99].message, 'message 119')
    })

    it('should show message item', async () => {
      helper.updateConfiguration('coc.preferences.enableMessageDialog', true)
      let p = window.showInformationMessage('information message', { title: 'first' }, { title: 'second' })
      await ensureNotification(0)
      let res = await p
      assert.deepStrictEqual(res, { title: 'first' })
      res = await window.showInformationMessage('information message')
      assert.strictEqual(res, undefined)
    })

    it('should show warning message', async () => {
      helper.updateConfiguration('coc.preferences.enableMessageDialog', true)
      let p = window.showWarningMessage('warning message', 'first', 'second')
      await ensureNotification(1)
      let res = await p
      assert.strictEqual(res, 'second')
    })

    it('should show error message', async () => {
      helper.updateConfiguration('coc.preferences.enableMessageDialog', true)
      let p = window.showErrorMessage('error message', 'first', 'second')
      await ensureNotification(0)
      let res = await p
      assert.strictEqual(res, 'first')
    })

    it('should show confirm for message', async (t) => {
      helper.updateConfiguration('coc.preferences.enableMessageDialog', false)
      let spy = t.mock.method(nvim, 'call', (method, _args) => {
        assert.strictEqual(method, 'confirm')
        return Promise.resolve('2') as any
      }, { times: 1 })
      let p = window.showInformationMessage('error message', 'first', 'second')
      let res = await p
      spy.mock.restore()
      assert.strictEqual(res, 'second')
    })

    it('should use messageDialogKind for confirm mode', async (t) => {
      helper.updateConfiguration('coc.preferences.messageDialogKind', 'confirm')
      let spy = t.mock.method(nvim, 'call', (method, args) => {
        assert.strictEqual(method, 'confirm')
        assert.strictEqual(args[0], 'test message')
        assert.strictEqual(args[1], '1first\n2second')
        return Promise.resolve('1') as any
      }, { times: 1 })
      let p = window.showInformationMessage('test message', 'first', 'second')
      let res = await p
      spy.mock.restore()
      assert.strictEqual(res, 'first')
    })

    it('should use messageDialogKind for menu mode', async (t) => {
      helper.updateConfiguration('coc.preferences.messageDialogKind', 'menu')
      let spy = t.mock.method(window.dialogs, 'showMenuPicker', () => {
        return Promise.resolve(1) as any
      })
      let res = await window.notifications._showMessage('Warning', 'test message', ['first', 'second'])
      assert.ok((spy).mock.calls.some(call => isDeepStrictEqual(call.arguments, [['first', 'second'], {
        position: 'center',
        content: 'test message',
        title: 'Choose an action',
        borderhighlight: 'CocWarningFloat'
      }])))
      assert.strictEqual(res, 'second')
      spy.mock.restore()
    })

    it('should use messageDialogKind for notification mode', async () => {
      helper.updateConfiguration('coc.preferences.messageDialogKind', 'notification')
      let p = window.showInformationMessage('notification message', 'first', 'second')
      await ensureNotification(0)
      let res = await p
      assert.strictEqual(res, 'first')
    })

    it('should echo error messages regardless of messageDialogKind', async (t) => {
      helper.updateConfiguration('coc.preferences.messageDialogKind', 'menu')
      let spy = t.mock.method(window.notifications, 'echoMessages')
      await window.showErrorMessage('error message')
      assert.ok((spy).mock.calls.some(call => isDeepStrictEqual(call.arguments, ['error message', 'error'])))
      spy.mock.restore()
    })

    it('should echo messages without items regardless of messageDialogKind', async (t) => {
      helper.updateConfiguration('coc.preferences.messageDialogKind', 'confirm')
      let spy = t.mock.method(window.notifications, 'echoMessages')
      await window.showInformationMessage('info message')
      assert.ok((spy).mock.calls.some(call => isDeepStrictEqual(call.arguments, ['info message', 'more'])))
      spy.mock.restore()
    })

    it('should echo messages without items when configured messageReportKind', async (t) => {
      helper.updateConfiguration('coc.preferences.messageReportKind', 'echo')
      let spy = t.mock.method(window.notifications, 'echoMessages')
      await window.showInformationMessage('info message')
      assert.ok((spy).mock.calls.some(call => isDeepStrictEqual(call.arguments, ['info message', 'more'])))
      spy.mock.restore()
    })

    it('should use notification messages without items when configured messageReportKind', async (t) => {
      helper.updateConfiguration('coc.preferences.messageReportKind', 'notification')
      let spy = t.mock.method(window.notifications, 'createNotification')
      await window.showInformationMessage('info message')
      assert.ok((spy).mock.calls.some(call => isDeepStrictEqual(call.arguments, ['info', 'info message', []])))
      spy.mock.restore()
    })

    it('should handle unexpected messageReportKind', async () => {
      helper.updateConfiguration('coc.preferences.messageReportKind', 'invalid')
      let p = window.showInformationMessage('invalid info message')
      await assert.rejects(p, error => String(error instanceof Error ? error.message : error).includes('Unexpected messageReportKind: invalid'))
    })

    it('should handle unexpected messageDialogKind', async () => {
      helper.updateConfiguration('coc.preferences.messageDialogKind', 'invalid')
      let p = window.showInformationMessage('test message', 'first', 'second')
      await assert.rejects(p, error => String(error instanceof Error ? error.message : error).includes('Unexpected messageDialogKind: invalid'))
    })

    it('should respect enableMessageDialog for backward compatibility', async () => {
      helper.updateConfiguration('coc.preferences.enableMessageDialog', true)
      helper.updateConfiguration('coc.preferences.messageDialogKind', 'confirm')
      let p = window.showInformationMessage('notification message', 'first', 'second')
      await ensureNotification(0)
      let res = await p
      assert.strictEqual(res, 'first')
    })
  })

  describe('window notifications', () => {
    it('should toButtons', () => {
      assert.strictEqual(toButtons(['foo', 'bar']).length, 2)
    })

    it('should toTitles', () => {
      assert.strictEqual(toTitles(['foo', 'bar']).length, 2)
      assert.strictEqual(toTitles([{ title: 'foo' }]).length, 1)
    })

    it('should show notification with options', async () => {
      await window.showNotification({
        content: 'my notification',
        title: 'title',
      })
      let ids = await nvim.call('coc#float#get_float_win_list') as number[]
      assert.strictEqual(ids.length, 1)
      let win = nvim.createWindow(ids[0])
      let kind = await win.getVar('kind')
      assert.strictEqual(kind, 'notification')
      let winid = await nvim.call('coc#float#get_related', [win.id, 'border'])
      let bufnr = await nvim.call('winbufnr', [winid]) as number
      let buf = nvim.createBuffer(bufnr)
      let lines = await buf.lines
      assert.strictEqual(lines[0].includes('title'), true)
    })

    it('should ignore events of other buffers', async () => {
      let bufnr = workspace.bufnr
      let notification = new Notification(nvim, {})
      await events.fire('BufWinLeave', [bufnr + 1])
      await events.fire('FloatBtnClick', [bufnr + 1, 1])
      notification.dispose()
    })

    it('should show notification without border', async () => {
      helper.updateConfiguration('notification.border', false)
      await window.showNotification({
        content: 'my notification',
        title: 'title',
      })
      let win = await helper.getFloat()
      let height = await nvim.call('coc#float#get_height', [win.id])
      assert.strictEqual(height, 2)
    })

    it('should show status line progress by default', async () => {
      let called = 0
      let text: string
      setTimeout(async () => {
        text = await nvim.getVar('coc_status') as string
      }, 10)
      let res = await window.withProgress({ title: 'Processing' }, progress => {
        let n = 0
        return new Promise(resolve => {
          let interval = setInterval(() => {
            progress.report({ message: 'progress', increment: 1 })
            n = n + 10
            called = called + 1
            if (n == 30) {
              clearInterval(interval)
              resolve('done')
            }
          }, 10)
        })
      })
      assert.ok((text).includes('Processing'))
      assert.ok((called) > (1))
      assert.strictEqual(res, 'done')
    })

    it('should show progress notification', async () => {
      helper.updateConfiguration('notification.statusLineProgress', false)
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
          }, 10)
          token.onCancellationRequested(() => {
            clearInterval(interval)
            resolve(undefined)
          })
        })
      })
      assert.ok((called) > (8))
      assert.strictEqual(res, 'done')
    })

    it('should cancel progress notification on window close', async () => {
      helper.updateConfiguration('notification.statusLineProgress', false)
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
          }, 10)
          token.onCancellationRequested(() => {
            clearInterval(interval)
            resolve(undefined)
          })
        })
      })
      await helper.wait(30)
      await nvim.call('coc#float#close_all', [])
      let res = await p
      assert.ok((called) < (10))
      assert.strictEqual(res, undefined)
    })

    it('should cancel progress when resolved', async () => {
      helper.updateConfiguration('notification.statusLineProgress', false)
      let called = 0
      let p = window.withProgress({ title: 'Process' }, () => {
        called = called + 1
        return Promise.resolve()
      })
      await p
      let win = await helper.getFloat()
      if (win) {
        let res = await nvim.call('coc#window#get_var', [win.id, 'closing'])
        assert.strictEqual(res, 1)
      }
      assert.strictEqual(called, 1)
    })

    it('should be disabled by configuration', async () => {
      helper.updateConfiguration('notification.statusLineProgress', false)
      helper.updateConfiguration('notification.disabledProgressSources', ['test'])
      let p = window.withProgress({ title: 'Downloading', source: 'test' }, (progress, token) => {
        let n = 0
        return new Promise(resolve => {
          let interval = setInterval(() => {
            progress.report({ message: 'progress', increment: 1 })
            n = n + 1
            if (n == 10) {
              clearInterval(interval)
              resolve('done')
            }
          }, 10)
        })
      })
      await helper.wait(30)
      let win = await helper.getFloat()
      assert.strictEqual(win, undefined)
      let res = await p
      assert.strictEqual(res, 'done')
    })

    it('should show error message when rejected', async () => {
      helper.updateConfiguration('notification.statusLineProgress', false)
      let p = window.withProgress({ title: 'Process' }, () => {
        return Promise.reject(new Error('Unable to fetch'))
      })
      let res = await p
      assert.strictEqual(res, undefined)
      let cmdline = await helper.getCmdline()
      assert.match(cmdline, /Unable to fetch/)
    })
  })

  describe('diffHighlights', () => {
    let ns = 'window-test'
    let priority = 99
    let ns_id: number
    beforeAll(async () => {
      ns_id = await nvim.call('coc#highlight#create_namespace', [ns]) as number
    })

    async function createFile(content = 'foo\nbar'): Promise<Buffer> {
      let file = await createTmpFile(content)
      return await helper.edit(file)
    }

    async function setHighlights(hls: HighlightItem[]): Promise<void> {
      let bufnr = await nvim.call('bufnr', ['%']) as number
      let arr = hls.map(o => [o.hlGroup, o.lnum, o.colStart, o.colEnd, o.combine === false ? 0 : 1, o.end_incl ? 1 : 0, o.start_incl ? 1 : 0])
      await nvim.call('coc#highlight#set', [bufnr, ns, arr, priority])
    }

    it('should return null when canceled', async () => {
      let buf = await createFile()
      let items: HighlightItem[] = []
      let token = CancellationToken.Cancelled
      let res = await window.diffHighlights(buf.id, ns, items, undefined, token)
      assert.strictEqual(res, null)
    })

    it('should add new highlights', async () => {
      let buf = await createFile()
      let items: HighlightItem[] = [{
        hlGroup: 'Search',
        lnum: 0,
        colStart: 0,
        colEnd: 3
      }]
      let res = await window.diffHighlights(buf.id, ns, items)
      assert.notStrictEqual(res, undefined)
      assert.strictEqual(res.add.length, 1)
      await window.applyDiffHighlights(buf.id, ns, priority, res)
      let markers = await buf.getExtMarks(ns_id, 0, -1, { details: true })
      assert.strictEqual(markers.length, 1)
      assert.strictEqual(markers[0][3].end_col, 3)
    })

    it('should update with new highlights', async () => {
      let buf = await createFile('foo\nbar\nbaz')
      let items: HighlightItem[] = [{
        hlGroup: 'Search',
        lnum: 0,
        colStart: 0,
        colEnd: 3
      }, {
        hlGroup: 'Search',
        lnum: 2,
        colStart: 0,
        colEnd: 3
      }]
      await setHighlights(items)
      let newItems: HighlightItem[] = [{
        hlGroup: 'Search',
        lnum: 0,
        colStart: 0,
        colEnd: 1
      }, {
        hlGroup: 'Search',
        lnum: 1,
        colStart: 0,
        colEnd: 3
      }]
      let res = await window.diffHighlights(buf.id, ns, newItems)
      await window.applyDiffHighlights(buf.id, ns, priority, res)
      let markers = await buf.getExtMarks(ns_id, 0, -1, { details: true })
      assert.strictEqual(markers.length, 2)
    })

    it('should ignore lines without highlights', async () => {
      let buf = await createFile()
      let items: HighlightItem[] = [{
        hlGroup: 'Search',
        lnum: 1,
        colStart: 0,
        colEnd: 3
      }]
      await setHighlights(items)
      let res = await window.diffHighlights(buf.id, ns, [])
      await window.applyDiffHighlights(buf.id, ns, priority, res)
      let markers = await buf.getExtMarks(ns_id, 0, -1, { details: true })
      assert.strictEqual(markers.length, 0)
    })

    it('should return empty diff', async () => {
      let buf = await createFile()
      let items: HighlightItem[] = [{
        hlGroup: 'Search',
        lnum: 0,
        colStart: 0,
        colEnd: 3
      }]
      await setHighlights(items)
      let res = await window.diffHighlights(buf.id, ns, items)
      assert.notStrictEqual(res, undefined)
      assert.deepStrictEqual(res.remove, [])
      assert.deepStrictEqual(res.add, [])
      assert.deepStrictEqual(res.removeMarkers, [])
    })

    it('should remove and add highlights', async () => {
      let buf = await createFile()
      let items: HighlightItem[] = [{
        hlGroup: 'Search',
        lnum: 0,
        colStart: 0,
        colEnd: 3
      }]
      await setHighlights(items)
      items = [{
        hlGroup: 'Search',
        lnum: 1,
        colStart: 0,
        colEnd: 3
      }]
      let res = await window.diffHighlights(buf.id, ns, items)
      assert.notStrictEqual(res, undefined)
      assert.strictEqual(res.add.length, 1)
      assert.strictEqual(res.removeMarkers.length, 1)
      await window.applyDiffHighlights(buf.id, ns, priority, res)
      let markers = await buf.getExtMarks(ns_id, 0, -1, { details: true })
      assert.strictEqual(markers.length, 1)
      assert.strictEqual(markers[0][1], 1)
      assert.strictEqual(markers[0][3].end_col, 3)
    })

    it('should update highlights of single line', async () => {
      let buf = await createFile()
      let items: HighlightItem[] = [{
        hlGroup: 'Search',
        lnum: 0,
        colStart: 0,
        colEnd: 1
      }, {
        hlGroup: 'Search',
        lnum: 1,
        colStart: 2,
        colEnd: 3
      }]
      await setHighlights(items)
      items = [{
        hlGroup: 'Search',
        lnum: 0,
        colStart: 2,
        colEnd: 3
      }]
      let res = await window.diffHighlights(buf.id, ns, items)
      assert.notStrictEqual(res, undefined)
      assert.strictEqual(res.add.length, 1)
      assert.strictEqual(res.removeMarkers.length, 2)
      await window.applyDiffHighlights(buf.id, ns, priority, res)
      let markers = await buf.getExtMarks(ns_id, 0, -1, { details: true })
      assert.strictEqual(markers.length, 1)
      assert.strictEqual(markers[0][1], 0)
      assert.strictEqual(markers[0][3].end_col, 3)
    })
  })
})
