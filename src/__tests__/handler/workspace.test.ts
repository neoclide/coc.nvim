import { Neovim } from '@chemzqm/neovim'
import { mock } from 'node:test'
import type { Mock as NodeMock } from 'node:test'
import fs from 'fs'
import os from 'os'
import path from 'path'
import v8 from 'v8'
import { Disposable, Location, Range } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import commands from '../../commands'
import events from '../../events'
import extensions from '../../extension'
import WorkspaceHandler from '../../handler/workspace'
import languages from '../../languages'
import snippetManager from '../../snippets/manager'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let handler: WorkspaceHandler
let heapSnapshotMock: NodeMock<any>
let disposables: Disposable[] = []
beforeAll(async () => {
  heapSnapshotMock = mock.method(v8, 'writeHeapSnapshot', () => (''))
  await helper.setup()
  nvim = helper.nvim
  handler = helper.plugin.getHandler().workspace
})

afterAll(async () => {
  await helper.shutdown()
  heapSnapshotMock.mock.restore()
})

afterEach(async () => {
  await helper.reset()
  disposeAll(disposables)
})

describe('Workspace handler', () => {
  async function checkFloat(content: string) {
    let win = await helper.getFloat()
    assert.notStrictEqual(win, undefined)
    let buf = await win.buffer
    let lines = await buf.lines
    assert.ok((lines.join('\n')).includes(content))
  }

  describe('events', () => {
    it('should reset autocmds of extensions', async () => {
      workspace.registerAutocmd({
        event: 'CursorHold',
        callback: () => {},
      })
      workspace.registerAutocmd({
        event: 'CursorMoved',
        callback: () => {},
      })
      let obj = workspace.autocmds.autocmds.get(1)
      Object.assign(obj, { _extensiionName: 'test' })
      let m = extensions.manager as any
      m._onDidUnloadExtension.fire('test')
      let map = workspace.autocmds.autocmds
      let arr = Array.from(map.keys())
      assert.deepStrictEqual(arr, [2])
      await new Promise(resolve => process.nextTick(resolve))
      let output = await nvim.call('execute', 'autocmd coc_dynamic_autocmd') as string
      assert.ok((output).includes('CursorMoved'))
      assert.strictEqual(output.includes('CursorHold'), false)
      nvim.command('autocmd! coc_dynamic_autocmd', true)
    })
  })

  describe('commands', () => {
    it('should check filetype', async () => {
      await helper.createDocument('t.vim')
      await commands.executeCommand('document.echoFiletype')
      let line = await helper.getCmdline()
      assert.ok((line).includes('vim'))
    })

    it('should show workspace folders', async () => {
      await helper.edit(__filename)
      await commands.executeCommand('workspace.workspaceFolders')
      let line = await helper.getCmdline()
      assert.ok((line).includes('coc.nvim'))
    })

    it('should write writeHeapSnapshot', async () => {
      heapSnapshotMock.mock.resetCalls()
      let filepath = await commands.executeCommand('workspace.writeHeapSnapshot')
      assert.notStrictEqual(filepath, undefined)
      assert.ok((heapSnapshotMock).mock.callCount() > 0)
    })

    it('should show output', async () => {
      window.createOutputChannel('foo')
      window.createOutputChannel('bar')
      let p = commands.executeCommand('workspace.showOutput')
      await helper.waitFloat()
      await nvim.input('<esc>')
      await p
      let bufname = await nvim.call('bufname', ['%'])
      assert.strictEqual(bufname, '')
      await commands.executeCommand('workspace.showOutput', 'foo')
      bufname = await nvim.call('bufname', ['%'])
      assert.ok(typeof bufname === 'string' && bufname.includes('output'))
    })

    it('should open location', async () => {
      let winid = await nvim.call('win_getid')
      await commands.executeCommand('workspace.openLocation', winid, Location.create('lsp:/1', Range.create(0, 0, 0, 0)))
      let bufname = await nvim.call('bufname', ['%'])
      assert.strictEqual(bufname, 'lsp:/1')
    })

    it('should clear watchman roots', async (t) => {
      let success = true
      let spy = t.mock.method(window, 'runTerminalCommand', () => {
        return Promise.resolve({ success, bufnr: 1 })
      })
      let res = await commands.executeCommand('workspace.clearWatchman')
      assert.strictEqual(res, true)
      success = false
      res = await commands.executeCommand('workspace.clearWatchman')
      assert.strictEqual(res, false)
      spy.mock.restore()
    })
  })

  describe('methods', () => {
    it('should rename buffer', async () => {
      let doc = await helper.createDocument('a')
      let fsPath = URI.parse(doc.uri).fsPath.replace(/a$/, 'b')
      disposables.push(Disposable.create(() => {
        if (fs.existsSync(fsPath)) fs.unlinkSync(fsPath)
      }))
      let p = handler.renameCurrent()
      await helper.waitValue(() => nvim.call('mode'), 'c')
      await nvim.input('<backspace>b<cr>')
      await p
      let name = await nvim.eval('bufname("%")') as string
      assert.strictEqual(name.endsWith('b'), true)
      p = handler.renameCurrent()
      await helper.waitValue(() => nvim.call('mode'), 'c')
      await nvim.input('<C-u><cr>')
      await p
    })

    it('should rename file', async (t) => {
      let dir = path.join(os.tmpdir(), crypto.randomUUID())
      fs.mkdirSync(dir, { recursive: true })
      let fsPath = path.join(dir, 'x')
      let newPath = path.join(dir, 'b')
      disposables.push(Disposable.create(() => {
        fs.rmSync(dir, { recursive: true, force: true })
      }))
      fs.writeFileSync(newPath, '', 'utf8')
      fs.writeFileSync(fsPath, 'foo', 'utf8')
      await helper.createDocument(fsPath)
      let spy = t.mock.method(window, 'showPrompt', () => {
        return Promise.resolve(true)
      })
      let p = commands.executeCommand('workspace.renameCurrentFile')
      await helper.waitFor('mode', [], 'c')
      await nvim.input('<backspace>b<cr>')
      await p
      spy.mock.restore()
      let name = await nvim.eval('bufname("%")') as string
      assert.strictEqual(name.endsWith('b'), true)
      assert.strictEqual(fs.existsSync(newPath), true)
      let content = fs.readFileSync(newPath, 'utf8')
      assert.match(content, /foo/)
    })

    it('should not rename when reject overwrite', async (t) => {
      let dir = path.join(os.tmpdir(), crypto.randomUUID())
      fs.mkdirSync(dir, { recursive: true })
      let fsPath = path.join(dir, 'x')
      let newPath = path.join(dir, 'b')
      disposables.push(Disposable.create(() => {
        fs.rmSync(dir, { recursive: true, force: true })
      }))
      fs.writeFileSync(newPath, '', 'utf8')
      await helper.createDocument(fsPath)
      let spy = t.mock.method(window, 'showPrompt', () => {
        return Promise.resolve(false)
      })
      let p = handler.renameCurrent()
      await helper.waitFor('mode', [], 'c')
      await nvim.input('<backspace>b<cr>')
      await p
      spy.mock.restore()
      let bufname = await nvim.call('bufname', ['%'])
      assert.ok(typeof bufname === 'string')
      assert.match(bufname, /x$/)
    })

    it('should open local config', async () => {
      let dir = path.join(os.tmpdir(), '.vim')
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(path.join(os.tmpdir(), '.git'), { recursive: true })
      await helper.edit(path.join(os.tmpdir(), 't'))
      let root = workspace.root
      assert.strictEqual(root, os.tmpdir())
      let p = handler.openLocalConfig()
      await helper.waitPromptWin()
      await nvim.input('n')
      await p
      p = handler.openLocalConfig()
      await helper.waitPromptWin()
      await nvim.input('y')
      await p
      let bufname = await nvim.call('bufname', ['%'])
      assert.ok(typeof bufname === 'string' && bufname.includes('coc-settings.json'))
    })

    it('should not throw when workspace folder does not exist', async (t) => {
      helper.updateConfiguration('workspace.rootPatterns', [], disposables)
      helper.updateConfiguration('workspace.ignoredFiletypes', ['vim'], disposables)
      await nvim.command('enew')
      await (window as any).openLocalConfig()
      await nvim.command(`e ${path.join(os.tmpdir(), 'a')}`)
      await helper.doAction('openLocalConfig')
      await nvim.command(`e t.md`)
      await nvim.command('setf markdown')
      await handler.openLocalConfig()
      await nvim.command(`e ${path.join(os.tmpdir(), 't.vim')}`)
      await nvim.command('setf vim')
      let called = false
      let spy = t.mock.method(window, 'showWarningMessage', () => {
        called = true
        return Promise.resolve(undefined)
      })
      await commands.executeCommand('workspace.openLocalConfig')
      assert.strictEqual(called, true)
      spy.mock.restore()
    })

    it('should add workspace folder', async () => {
      assert.throws(() => {
        handler.addWorkspaceFolder(undefined)
      }, TypeError)
      assert.throws(() => {
        handler.addWorkspaceFolder(__filename)
      }, Error)
      await helper.plugin.cocAction('addWorkspaceFolder', __dirname)
      let folders = workspace.workspaceFolderControl.workspaceFolders
      let uri = URI.file(__dirname).toString()
      let find = folders.find(o => o.uri === uri)
      assert.notStrictEqual(find, undefined)
    })

    it('should remove workspace folder', async () => {
      assert.throws(() => {
        handler.addWorkspaceFolder(__filename)
      }, Error)
      assert.throws(() => {
        handler.addWorkspaceFolder(__filename)
      }, Error)
      await helper.plugin.cocAction('addWorkspaceFolder', __dirname)
      await helper.plugin.cocAction('removeWorkspaceFolder', __dirname)
      let folders = workspace.workspaceFolderControl.workspaceFolders
      let uri = URI.file(__dirname).toString()
      let find = folders.find(o => o.uri === uri)
      assert.strictEqual(find, undefined)
    })

    it('should check env on vim resized', async () => {
      await events.fire('VimResized', [80, 80])
      assert.strictEqual(workspace.env.columns, 80)
      await events.fire('VimResized', [160, 80])
      assert.strictEqual(workspace.env.columns, 160)
    })

    it('should should error message for document not attached', async () => {
      disposables.push(languages.registerDocumentFormatProvider(['*'], {
        provideDocumentFormattingEdits: () => {
          return []
        }
      }))
      await handler.bufferCheck()
      await checkFloat('Provider state')
      await nvim.call('coc#float#close_all', [])
      await nvim.command('edit t|let b:coc_enabled = 0')
      await commands.executeCommand('document.checkBuffer')
      await checkFloat('not attached')
      await nvim.call('coc#float#close_all', [])
      await nvim.command('edit +setl\\ buftype=nofile b')
      await helper.doAction('bufferCheck')
      await checkFloat('not attached')
      await nvim.call('coc#float#close_all', [])
      helper.updateConfiguration('coc.preferences.maxFileSize', '1KB')
      await helper.edit(__filename)
      await handler.bufferCheck()
      await checkFloat('not attached')
      await nvim.call('coc#float#close_all', [])
    })

    it('should check json extension', async (t) => {
      let spy = t.mock.method(extensions, 'has', () => {
        return true
      })
      await helper.doAction('checkJsonExtension')
      spy.mock.restore()
      await helper.doAction('checkJsonExtension')
      let line = await helper.getCmdline()
      assert.notStrictEqual(line, undefined)
    })

    it('should get rootPatterns', async () => {
      let bufnr = await nvim.call('bufnr', ['%'])
      let res = await helper.doAction('rootPatterns', bufnr)
      assert.notStrictEqual(res, undefined)
    })

    it('should get config by key', async () => {
      let res = await helper.doAction('getConfig', ['suggest'])
      assert.notStrictEqual(res.autoTrigger, undefined)
    })

    it('should open log', async () => {
      await helper.doAction('openLog')
      let bufname = await nvim.call('bufname', ['%']) as string
      assert.ok((bufname).includes('coc-nvim'))
    })

    it('should get configuration of current document', async () => {
      let config = await handler.getConfiguration('suggest')
      let wait = config.get<number>('triggerCompletionWait')
      assert.strictEqual(wait, 0)
    })

    it('should get root patterns', async () => {
      let doc = await helper.createDocument()
      let patterns = handler.getRootPatterns(doc.bufnr)
      assert.notStrictEqual(patterns, undefined)
      patterns = handler.getRootPatterns(999)
      assert.strictEqual(patterns, null)
    })
  })

  describe('doKeymap()', () => {
    it('should return default value when key mapping does not exist', async () => {
      let res = await helper.doAction('doKeymap', ['not_exists', ''])
      assert.strictEqual(res, '')
    })

    it('should support repeat key mapping', async () => {
      let called = false
      await nvim.command('nmap do <Plug>(coc-test)')
      disposables.push(workspace.registerKeymap(['n'], 'test', () => {
        called = true
      }))
      await helper.waitValue(async () => {
        let res = await nvim.call('maparg', ['<Plug>(coc-test)', 'n']) as string
        return res.length > 0
      }, true)
      await nvim.call('feedkeys', ['do', 'i'])
      await helper.waitValue(() => {
        return called
      }, true)
    })
  })

  describe('snippetCheck()', () => {
    it('should return false when coc-snippets not found', async (t) => {
      let fn = async () => {
        assert.strictEqual(await handler.snippetCheck(true, false), false)
      }
      await assert.rejects(fn(), Error)
      let spy = t.mock.method(extensions.manager, 'call', () => {
        return Promise.resolve(true)
      })
      assert.strictEqual(await handler.snippetCheck(true, false), true)
      spy.mock.restore()
    })

    it('should check jump', async (t) => {
      assert.strictEqual(await handler.snippetCheck(false, true), false)
      let spy = t.mock.method(snippetManager, 'jumpable', () => {
        return true
      })
      assert.strictEqual(await handler.snippetCheck(false, true), true)
      spy.mock.restore()
    })
  })
})
