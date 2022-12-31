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
      expect(Window).toBeDefined()
      expect(formatMessage('a', 'b', 1)).toBe('a b 1%')
      expect(formatMessage(undefined, undefined, 1)).toBe('1%')
      expect(formatMessage('a', undefined, 0)).toBe('a')
    })

    it('should convert highlight item', () => {
      let res = convertHighlightItem({
        colStart: 0,
        colEnd: 1,
        hlGroup: 'Search',
        lnum: 0,
        combine: true
      })
      expect(res).toEqual(['Search', 0, 0, 1, 1, 0, 0])
    })

    it('should get offset', async () => {
      let buf = await nvim.buffer
      await nvim.call('setline', [buf.id, ['bar', 'foo']])
      await nvim.call('cursor', [2, 2])
      let n = await window.getOffset()
      expect(n).toBe(5)
    })

    it('should get cursor screen position', async () => {
      let pos = await window.getCursorScreenPosition()
      expect(pos).toEqual({ row: 0, col: 0 })
    })

    it('should export terminals', async () => {
      expect(Array.isArray(window.terminals)).toBe(true)
      expect(window.onDidOpenTerminal).toBeDefined()
      expect(window.onDidCloseTerminal).toBeDefined()
    })

    it('should selected range', async () => {
      await nvim.setLine('foobar')
      await nvim.command('normal! viw')
      await nvim.eval(`feedkeys("\\<Esc>", 'in')`)
      let range = await window.getSelectedRange('v')
      expect(range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 6 } })
    })

    it('should run terminal command', async () => {
      let res = await window.runTerminalCommand('ls', __dirname)
      expect(res.success).toBe(true)
      res = await window.runTerminalCommand('echo 1', process.cwd(), true)
      expect(res.success).toBe(true)
    })

    it('should open temimal buffer', async () => {
      let bufnr = await window.openTerminal('ls', { autoclose: false, keepfocus: false })
      let curr = await nvim.eval('bufnr("%")')
      expect(curr).toBe(bufnr)
      let buftype = await nvim.eval('&buftype')
      expect(buftype).toBe('terminal')
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
      expect(win).toBeDefined()
      let id = await nvim.call('coc#float#get_related', [win.id, 'border', 0]) as number
      expect(id).toBeGreaterThan(0)
    })

    it('should createStatusBarItem', async () => {
      let item = window.createStatusBarItem(1, { progress: true })
      item.text = 'test'
      item.show()
      expect(item.text).toBe('test')
      expect(item.isProgress).toBe(true)
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
      let filetype = await nvim.eval('&filetype')
      expect(filetype).toBe('coctree')
    })

    it('should show outputChannel', async () => {
      window.createOutputChannel('channel')
      window.showOutputChannel('channel')
      let buf = await nvim.buffer
      let name = await buf.name
      expect(name).toMatch('channel')
    })

    it('should not show none exists channel', async () => {
      let buf = await nvim.buffer
      let bufnr = buf.id
      window.showOutputChannel('NONE')
      await helper.wait(20)
      buf = await nvim.buffer
      expect(buf.id).toBe(bufnr)
    })

    it('should get cursor position', async () => {
      await nvim.setLine('       ')
      await nvim.call('cursor', [1, 3])
      let pos = await window.getCursorPosition()
      expect(pos).toEqual({
        line: 0,
        character: 2
      })
    })

    it('should moveTo position in insert mode', async () => {
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
      await helper.waitPrompt()
      await nvim.input('1')
      await nvim.input('<CR>')
      let res = await p
      expect(res).toBe(0)
    })

    it('should cancel quickpick', async () => {
      let p = window.showQuickpick(['a', 'b'])
      await helper.waitPrompt()
      await nvim.input('<esc>')
      let res = await p
      expect(res).toBe(-1)
    })

    it('should show prompt', async () => {
      let p = window.showPrompt('prompt')
      await helper.wait(50)
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
      await helper.waitValue(async () => {
        return await nvim.call('coc#float#has_float', [])
      }, 1)
      await nvim.input('2')
      let res = await p
      expect(res).toBe(1)
      res = await window.showMenuPicker(['foo'], { title: 'title', position: 'center' }, CancellationToken.Cancelled)
      expect(res).toBe(-1)
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
      expect(winid).toBe(curr)
      expect(res).toEqual(['foo'])
    })

    it('should return undefined for picker', async () => {
      let p = window.showPickerDialog(['foo', 'bar'], 'select')
      await helper.waitFloat()
      await helper.waitPrompt()
      await nvim.input('<esc>')
      let res = await p
      expect(res).toBeUndefined()
    })

    it('should return undefined when cancelled', async () => {
      let token = CancellationToken.Cancelled
      let res = await window.showPickerDialog(['foo', 'bar'], 'select', token)
      expect(res).toBeUndefined()
    })
  })

  describe('window showMessage', () => {
    beforeEach(() => {
      helper.updateConfiguration('coc.preferences.enableMessageDialog', true)
    })

    async function ensureNotification(idx: number): Promise<void> {
      await helper.waitFloat()
      await nvim.input(`${idx + 1}`)
    }

    it('should echo lines', async () => {
      await window.echoLines(['a', 'b'])
      let ch = await nvim.call('screenchar', [79, 1]) as number
      let s = String.fromCharCode(ch)
      expect(s).toBe('a')
    })

    it('should echo multiple lines with truncate', async () => {
      await window.echoLines(['a', 'b'.repeat(99), 'd', 'e'], true)
      let ch = await nvim.call('screenchar', [79, 1]) as number
      let s = String.fromCharCode(ch)
      expect(s).toBe('a')
      await window.echoLines(['a', 'b'.repeat(200)], true)
    })

    it('should show messages', async () => {
      window.showMessage('more')
      window.showMessage('error', 'error')
      window.showMessage('warning', 'warning')
      window.showMessage('moremsg', 'more')
    })

    it('should show message item', async () => {
      let p = window.showInformationMessage('information message', { title: 'first' }, { title: 'second' })
      await ensureNotification(0)
      let res = await p
      expect(res).toEqual({ title: 'first' })
    })

    it('should show information message', async () => {
      let p = window.showInformationMessage('information message', 'first', 'second')
      await ensureNotification(0)
      let res = await p
      expect(res).toBe('first')
    })

    it('should show warning message', async () => {
      let p = window.showWarningMessage('warning message', 'first', 'second')
      await ensureNotification(1)
      let res = await p
      expect(res).toBe('second')
    })

    it('should show error message', async () => {
      let p = window.showErrorMessage('error message', 'first', 'second')
      await ensureNotification(0)
      let res = await p
      expect(res).toBe('first')
    })

    it('should use notification for message', async () => {
      helper.updateConfiguration('coc.preferences.enableMessageDialog', true)
      let p = window.showErrorMessage('error message')
      await helper.waitFloat()
      await nvim.call('coc#float#close_all', [])
      let res = await p
      expect(res).toBeUndefined()
    })

    it('should prefer menu picker for notification message', async () => {
      let p = window.showErrorMessage('error message', 'first', 'second')
      await helper.waitFloat()
      await nvim.input('1')
      let res = await p
      expect(res).toBe('first')
    })
  })

  describe('window notifications', () => {
    it('should toButtons', () => {
      expect(toButtons(['foo', 'bar']).length).toBe(2)
    })

    it('should toTitles', () => {
      expect(toTitles(['foo', 'bar']).length).toBe(2)
      expect(toTitles([{ title: 'foo' }]).length).toBe(1)
    })

    it('should show notification with options', async () => {
      await window.showNotification({
        content: 'my notification',
        title: 'title',
      })
      let ids = await nvim.call('coc#float#get_float_win_list') as number[]
      expect(ids.length).toBe(1)
      let win = nvim.createWindow(ids[0])
      let kind = await win.getVar('kind')
      expect(kind).toBe('notification')
      let winid = await nvim.call('coc#float#get_related', [win.id, 'border'])
      let bufnr = await nvim.call('winbufnr', [winid]) as number
      let buf = nvim.createBuffer(bufnr)
      let lines = await buf.lines
      expect(lines[0].includes('title')).toBe(true)
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
      expect(height).toBe(2)
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
      expect(text).toMatch('Processing')
      expect(called).toBeGreaterThan(1)
      expect(res).toBe('done')
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
      expect(called).toBeGreaterThan(8)
      expect(res).toBe('done')
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
      expect(called).toBeLessThan(10)
      expect(res).toBe(undefined)
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
        expect(res).toBe(1)
      }
      expect(called).toBe(1)
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
      expect(win).toBeUndefined()
      let res = await p
      expect(res).toBe('done')
    })

    it('should show error message when rejected', async () => {
      helper.updateConfiguration('notification.statusLineProgress', false)
      let p = window.withProgress({ title: 'Process' }, () => {
        return Promise.reject(new Error('Unable to fetch'))
      })
      let res = await p
      expect(res).toBe(undefined)
      let cmdline = await helper.getCmdline()
      expect(cmdline).toMatch(/Unable to fetch/)
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
      expect(res).toBe(null)
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
      expect(res).toBeDefined()
      expect(res.add.length).toBe(1)
      await window.applyDiffHighlights(buf.id, ns, priority, res)
      let markers = await buf.getExtMarks(ns_id, 0, -1, { details: true })
      expect(markers.length).toBe(1)
      expect(markers[0][3].end_col).toBe(3)
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
      expect(markers.length).toBe(2)
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
      expect(markers.length).toBe(0)
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
      expect(res).toBeDefined()
      expect(res.remove).toEqual([])
      expect(res.add).toEqual([])
      expect(res.removeMarkers).toEqual([])
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
      expect(res).toBeDefined()
      expect(res.add.length).toBe(1)
      expect(res.removeMarkers.length).toBe(1)
      await window.applyDiffHighlights(buf.id, ns, priority, res)
      let markers = await buf.getExtMarks(ns_id, 0, -1, { details: true })
      expect(markers.length).toBe(1)
      expect(markers[0][1]).toBe(1)
      expect(markers[0][3].end_col).toBe(3)
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
      expect(res).toBeDefined()
      expect(res.add.length).toBe(1)
      expect(res.removeMarkers.length).toBe(2)
      await window.applyDiffHighlights(buf.id, ns, priority, res)
      let markers = await buf.getExtMarks(ns_id, 0, -1, { details: true })
      expect(markers.length).toBe(1)
      expect(markers[0][1]).toBe(0)
      expect(markers[0][3].end_col).toBe(3)
    })

    it('should not use extmarks on neovim < 0.5.1', async () => {
      window.highlights.checkMarkers = false
      disposables.push({
        dispose: () => {
          window.highlights.checkMarkers = true
        }
      })
      let buf = await createFile('foo\nbar\nbza\ndef\n')
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
      let res = await window.diffHighlights(buf.id, ns, [{
        hlGroup: 'Search',
        lnum: 0,
        colStart: 0,
        colEnd: 3
      }, {
        hlGroup: 'Search',
        lnum: 2,
        colStart: 0,
        colEnd: 3
      }])
      expect(res).toEqual({
        remove: [0, 1],
        add: [['Search', 0, 0, 3, 0, 0, 0], ['Search', 2, 0, 3, 0, 0, 0]],
        removeMarkers: []
      })
      await window.applyDiffHighlights(buf.id, ns, priority, res, true)
      // let markers = await helper.getExtMarks(buf, ns_id)
      let markers = await buf.getExtMarks(ns_id, 0, -1, { details: true })
      let arr = markers.map(o => [o[1], o[2], o[3].end_col, o[3].hl_group])
      expect(arr).toEqual([
        [0, 0, 3, 'Search'],
        [2, 0, 3, 'Search']
      ])
    })
  })
})
