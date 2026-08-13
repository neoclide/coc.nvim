import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
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
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

let nvim: Neovim
let handler: WorkspaceHandler
let disposables: Disposable[] = []

before(async () => {
  nvim = workspace.nvim
  handler = getCurrentPlugin().getHandler().workspace
})
afterEach(async () => {
  disposeAll(disposables)
})

afterEach(editorReset)

describe('Workspace handler', () => {
  async function checkFloat(content: string) {
    let win = await shared.getFloat()
    assert.notStrictEqual(win, undefined)
    let buf = await win.buffer
    let lines = await buf.lines
    assert.match(lines.join('\n'), new RegExp(content))
  }

  describe('events', () => {
    it('should reset autocmds of extensions', async t => {
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
      assert.match(output, new RegExp('CursorMoved'))
      assert.strictEqual(output.includes('CursorHold'), false)
      nvim.command('autocmd! coc_dynamic_autocmd', true)
    })
  })

  describe('commands', () => {
    it('should check filetype', async t => {
      await shared.createDocument('t.vim')
      await commands.executeCommand('document.echoFiletype')
      let line = await shared.getCmdline()
      assert.match(line, new RegExp('vim'))
    })

    it('should show workspace folders', async t => {
      await shared.edit(import.meta.filename)
      await commands.executeCommand('workspace.workspaceFolders')
      let line = await shared.getCmdline()
      assert.match(line, new RegExp('coc\\.nvim'))
    })

    it('should write writeHeapSnapshot', async t => {
      const v8 = require('v8') as { writeHeapSnapshot: (...args: any[]) => string }
      let called = false
      t.mock.method(v8, 'writeHeapSnapshot', () => {
        called = true
        return ''
      })
      let filepath = await commands.executeCommand('workspace.writeHeapSnapshot')
      assert.notStrictEqual(filepath, undefined)
      assert.strictEqual(called, true)
    })

    it('should show output', async t => {
      window.createOutputChannel('foo')
      window.createOutputChannel('bar')
      let p = commands.executeCommand('workspace.showOutput')
      await shared.waitFloat()
      await nvim.input('<esc>')
      await p
      let bufname = await nvim.call('bufname', ['%']) as string
      assert.strictEqual(bufname, '')
      await commands.executeCommand('workspace.showOutput', 'foo')
      bufname = await nvim.call('bufname', ['%']) as string
      assert.match(bufname, new RegExp('output'))
    })

    it('should open location', async t => {
      let winid = await nvim.call('win_getid')
      await commands.executeCommand('workspace.openLocation', winid, Location.create('lsp:/1', Range.create(0, 0, 0, 0)))
      let bufname = await nvim.call('bufname', ['%']) as string
      assert.strictEqual(bufname, 'lsp:/1')
    })

    it('should clear watchman roots', async t => {
      let success = true
      let spy = t.mock.method(window, 'runTerminalCommand', () => {
        return Promise.resolve({ success, bufnr: 1 })
      })
      let res = await commands.executeCommand('workspace.clearWatchman')
      assert.strictEqual(res, true)
      success = false
      res = await commands.executeCommand('workspace.clearWatchman')
      assert.strictEqual(res, false)
    })
  })

  describe('methods', () => {
    it('should rename buffer', async t => {
      let doc = await shared.createDocument('a')
      let fsPath = URI.parse(doc.uri).fsPath.replace(/a$/, 'b')
      disposables.push(Disposable.create(() => {
        if (fs.existsSync(fsPath)) fs.unlinkSync(fsPath)
      }))
      let p = handler.renameCurrent()
      await shared.waitValue(() => nvim.call('mode'), 'c')
      await nvim.input('<backspace>b<cr>')
      await p
      let name = await nvim.eval('bufname("%")') as string
      assert.strictEqual(name.endsWith('b'), true)
      p = handler.renameCurrent()
      await shared.waitValue(() => nvim.call('mode'), 'c')
      await nvim.input('<C-u><cr>')
      await p
    })

    it('should rename file', async t => {
      let dir = path.join(os.tmpdir(), crypto.randomUUID())
      fs.mkdirSync(dir, { recursive: true })
      let fsPath = path.join(dir, 'x')
      let newPath = path.join(dir, 'b')
      disposables.push(Disposable.create(() => {
        fs.rmSync(dir, { recursive: true, force: true })
      }))
      fs.writeFileSync(newPath, '', 'utf8')
      fs.writeFileSync(fsPath, 'foo', 'utf8')
      await shared.createDocument(fsPath)
      let spy = t.mock.method(window, 'showPrompt', () => {
        return Promise.resolve(true)
      })
      let p = commands.executeCommand('workspace.renameCurrentFile')
      await shared.waitFor('mode', [], 'c')
      await nvim.input('<backspace>b<cr>')
      await p
      let name = await nvim.eval('bufname("%")') as string
      assert.strictEqual(name.endsWith('b'), true)
      assert.strictEqual(fs.existsSync(newPath), true)
      let content = fs.readFileSync(newPath, 'utf8')
      assert.match(content, /foo/)
    })

    it('should not rename when reject overwrite', async t => {
      let dir = path.join(os.tmpdir(), crypto.randomUUID())
      fs.mkdirSync(dir, { recursive: true })
      let fsPath = path.join(dir, 'x')
      let newPath = path.join(dir, 'b')
      disposables.push(Disposable.create(() => {
        fs.rmSync(dir, { recursive: true, force: true })
      }))
      fs.writeFileSync(newPath, '', 'utf8')
      await shared.createDocument(fsPath)
      t.mock.method(window, 'showPrompt', () => {
        return Promise.resolve(false)
      })
      let p = handler.renameCurrent()
      await shared.waitFor('mode', [], 'c')
      await nvim.input('<backspace>b<cr>')
      await p
      let bufname = await nvim.call('bufname', ['%']) as string
      assert.match(bufname, /x$/)
    })

    it('should open local config', async t => {
      workspace.workspaceFolderControl.addWorkspaceFolder(process.env.COC_DATA_HOME, true)
      await shared.edit(path.join(process.env.COC_DATA_HOME, 'foo'))
      let p = handler.openLocalConfig()
      t.mock.method(window, 'showPrompt', () => {
        return Promise.resolve(true)
      })
      await nvim.input('n')
      await p
      p = handler.openLocalConfig()
      await nvim.input('y')
      await p
      let bufname = await nvim.call('bufname', ['%']) as string
      assert.match(bufname, new RegExp('coc-settings\\.json'))
    })

    it('should not throw when workspace folder does not exist', async t => {
      shared.updateConfiguration('workspace.rootPatterns', [], disposables)
      shared.updateConfiguration('workspace.ignoredFiletypes', ['vim'], disposables)
      await nvim.command('enew')
      await (window as any).openLocalConfig()
      await nvim.command(`e ${path.join(os.tmpdir(), 'a')}`)
      await shared.doAction('openLocalConfig')
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
    })

    it('should add workspace folder', async t => {
      assert.throws(() => {
        handler.addWorkspaceFolder(undefined)
      }, TypeError)
      assert.throws(() => {
        handler.addWorkspaceFolder(import.meta.filename)
      }, Error)
      await getCurrentPlugin().cocAction('addWorkspaceFolder', import.meta.dirname)
      let folders = workspace.workspaceFolderControl.workspaceFolders
      let uri = URI.file(import.meta.dirname).toString()
      let find = folders.find(o => o.uri === uri)
      assert.notStrictEqual(find, undefined)
    })

    it('should remove workspace folder', async t => {
      assert.throws(() => {
        handler.addWorkspaceFolder(import.meta.filename)
      }, Error)
      assert.throws(() => {
        handler.addWorkspaceFolder(import.meta.filename)
      }, Error)
      await getCurrentPlugin().cocAction('addWorkspaceFolder', import.meta.dirname)
      await getCurrentPlugin().cocAction('removeWorkspaceFolder', import.meta.dirname)
      let folders = workspace.workspaceFolderControl.workspaceFolders
      let uri = URI.file(import.meta.dirname).toString()
      let find = folders.find(o => o.uri === uri)
      assert.strictEqual(find, undefined)
    })

    it('should check env on vim resized', async t => {
      await events.fire('VimResized', [80, 80])
      assert.strictEqual(workspace.env.columns, 80)
      await events.fire('VimResized', [160, 80])
      assert.strictEqual(workspace.env.columns, 160)
    })

    it('should should error message for document not attached', async t => {
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
      await shared.doAction('bufferCheck')
      await checkFloat('not attached')
      await nvim.call('coc#float#close_all', [])
      shared.updateConfiguration('coc.preferences.maxFileSize', '1KB')
      await shared.edit(import.meta.filename)
      await handler.bufferCheck()
      await checkFloat('not attached')
      await nvim.call('coc#float#close_all', [])
      shared.updateConfiguration('coc.preferences.maxFileSize', '10MB')
    })

    it('should check json extension', async t => {
      let spy = t.mock.method(extensions, 'has', () => {
        return true
      })
      await shared.doAction('checkJsonExtension')
      await shared.doAction('checkJsonExtension')
      let line = await shared.getCmdline()
      assert.notStrictEqual(line, undefined)
    })

    it('should get rootPatterns', async t => {
      let bufnr = await nvim.call('bufnr', ['%'])
      let res = await shared.doAction('rootPatterns', bufnr)
      assert.notStrictEqual(res, undefined)
    })

    it('should get config by key', async t => {
      let res = await shared.doAction('getConfig', ['suggest'])
      assert.notStrictEqual(res.autoTrigger, undefined)
    })

    it('should open log', async t => {
      await shared.doAction('openLog')
      let bufname = await nvim.call('bufname', ['%']) as string
      assert.match(bufname, new RegExp('coc-nvim'))
    })

    it('should get configuration of current document', async t => {
      let config = await handler.getConfiguration('suggest')
      let wait = config.get<number>('triggerCompletionWait')
      assert.strictEqual(wait, 0)
    })

    it('should get root patterns', async t => {
      let doc = await shared.createDocument()
      let patterns = handler.getRootPatterns(doc.bufnr)
      assert.notStrictEqual(patterns, undefined)
      patterns = handler.getRootPatterns(999)
      assert.strictEqual(patterns, null)
    })
  })

  describe('doKeymap()', () => {
    it('should return default value when key mapping does not exist', async t => {
      let res = await shared.doAction('doKeymap', ['not_exists', ''])
      assert.strictEqual(res, '')
    })

    it('should support repeat key mapping', async t => {
      let called = false
      await nvim.command('nmap do <Plug>(coc-test)')
      disposables.push(workspace.registerKeymap(['n'], 'test', () => {
        called = true
      }))
      await shared.waitValue(async () => {
        let res = await nvim.call('maparg', ['<Plug>(coc-test)', 'n']) as string
        return res.length > 0
      }, true)
      await nvim.call('feedkeys', ['do', 'i'])
      await shared.waitValue(() => {
        return called
      }, true)
    })
  })

  describe('snippetCheck()', () => {
    it('should return false when coc-snippets not found', async t => {
      let fn = async () => {
        assert.strictEqual(await handler.snippetCheck(true, false), false)
      }
      await assert.rejects(fn(), Error)
      let spy = t.mock.method(extensions.manager, 'call', () => {
        return Promise.resolve(true)
      })
      assert.strictEqual(await handler.snippetCheck(true, false), true)
    })

    it('should check jump', async t => {
      assert.strictEqual(await handler.snippetCheck(false, true), false)
      let spy = t.mock.method(snippetManager, 'jumpable', () => {
        return true
      })
      assert.strictEqual(await handler.snippetCheck(false, true), true)
    })
  })
})
