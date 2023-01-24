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
import { v4 as uuid } from 'uuid'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'
import snippetManager from '../../snippets/manager'

let nvim: Neovim
let handler: WorkspaceHandler
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  handler = helper.plugin.getHandler().workspace
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  disposeAll(disposables)
  await helper.reset()
})

describe('Workspace handler', () => {
  async function checkFloat(content: string) {
    let win = await helper.getFloat()
    expect(win).toBeDefined()
    let buf = await win.buffer
    let lines = await buf.lines
    expect(lines.join('\n')).toMatch(content)
  }

  describe('commands', () => {
    it('should check filetype', async () => {
      await helper.createDocument('t.vim')
      await commands.executeCommand('document.echoFiletype')
      let line = await helper.getCmdline()
      expect(line).toMatch('vim')
    })

    it('should show workspace folders', async () => {
      await helper.edit(__filename)
      await commands.executeCommand('workspace.workspaceFolders')
      let line = await helper.getCmdline()
      expect(line).toMatch('coc.nvim')
    })

    it('should write writeHeapSnapshot', async () => {
      const v8 = require('v8')
      let called = false
      let spy = jest.spyOn(v8, 'writeHeapSnapshot').mockImplementation(() => {
        called = true
      })
      let filepath = await commands.executeCommand('workspace.writeHeapSnapshot')
      spy.mockRestore()
      expect(filepath).toBeDefined()
      expect(called).toBe(true)
    })

    it('should show output', async () => {
      window.createOutputChannel('foo')
      window.createOutputChannel('bar')
      let p = commands.executeCommand('workspace.showOutput')
      await helper.waitFloat()
      await nvim.input('<esc>')
      await p
      let bufname = await nvim.call('bufname', ['%'])
      expect(bufname).toBe('')
      await commands.executeCommand('workspace.showOutput', 'foo')
      bufname = await nvim.call('bufname', ['%'])
      expect(bufname).toMatch('output')
    })

    it('should open location', async () => {
      let winid = await nvim.call('win_getid')
      await commands.executeCommand('workspace.openLocation', winid, Location.create('lsp:/1', Range.create(0, 0, 0, 0)))
      let bufname = await nvim.call('bufname', ['%'])
      expect(bufname).toBe('lsp:/1')
    })

    it('should clear watchman roots', async () => {
      let success = true
      let spy = jest.spyOn(window, 'runTerminalCommand').mockImplementation(() => {
        return Promise.resolve({ success, bufnr: 1 })
      })
      let res = await commands.executeCommand('workspace.clearWatchman')
      expect(res).toBe(true)
      success = false
      res = await commands.executeCommand('workspace.clearWatchman')
      expect(res).toBe(false)
      spy.mockRestore()
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
      expect(name.endsWith('b')).toBe(true)
      p = handler.renameCurrent()
      await helper.waitValue(() => nvim.call('mode'), 'c')
      await nvim.input('<C-u><cr>')
      await p
    })

    it('should rename file', async () => {
      let dir = path.join(os.tmpdir(), uuid())
      fs.mkdirSync(dir, { recursive: true })
      let fsPath = path.join(dir, 'x')
      let newPath = path.join(dir, 'b')
      disposables.push(Disposable.create(() => {
        fs.rmSync(dir, { recursive: true, force: true })
      }))
      fs.writeFileSync(newPath, '', 'utf8')
      fs.writeFileSync(fsPath, 'foo', 'utf8')
      await helper.createDocument(fsPath)
      let spy = jest.spyOn(window, 'showPrompt').mockImplementation(() => {
        return Promise.resolve(true)
      })
      let p = commands.executeCommand('workspace.renameCurrentFile')
      await helper.waitFor('mode', [], 'c')
      await nvim.input('<backspace>b<cr>')
      await p
      spy.mockRestore()
      let name = await nvim.eval('bufname("%")') as string
      expect(name.endsWith('b')).toBe(true)
      expect(fs.existsSync(newPath)).toBe(true)
      let content = fs.readFileSync(newPath, 'utf8')
      expect(content).toMatch(/foo/)
    })

    it('should not rename when reject overwrite', async () => {
      let dir = path.join(os.tmpdir(), uuid())
      fs.mkdirSync(dir, { recursive: true })
      let fsPath = path.join(dir, 'x')
      let newPath = path.join(dir, 'b')
      disposables.push(Disposable.create(() => {
        fs.rmSync(dir, { recursive: true, force: true })
      }))
      fs.writeFileSync(newPath, '', 'utf8')
      await helper.createDocument(fsPath)
      let spy = jest.spyOn(window, 'showPrompt').mockImplementation(() => {
        return Promise.resolve(false)
      })
      let p = handler.renameCurrent()
      await helper.waitFor('mode', [], 'c')
      await nvim.input('<backspace>b<cr>')
      await p
      spy.mockRestore()
      let bufname = await nvim.call('bufname', ['%'])
      expect(bufname).toMatch(/x$/)
    })

    it('should not throw when workspace folder does not exist', async () => {
      helper.updateConfiguration('workspace.rootPatterns', [])
      helper.updateConfiguration('workspace.ignoredFiletypes', ['vim'])
      await nvim.command('enew')
      await (window as any).openLocalConfig()
      await nvim.command(`e ${path.join(os.tmpdir(), 'a')}`)
      await helper.doAction('openLocalConfig')
      await nvim.command(`e t.md`)
      await nvim.command('setf markdown')
      await handler.openLocalConfig()
      await nvim.command(`e ${path.join(os.tmpdir(), 't.vim')}`)
      await nvim.command('setf vim')
      await handler.openLocalConfig()
    })

    it('should open local config', async () => {
      let dir = path.join(os.tmpdir(), '.vim')
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(path.join(os.tmpdir(), '.git'), { recursive: true })
      await helper.edit(path.join(os.tmpdir(), 't'))
      let root = workspace.root
      expect(root).toBe(os.tmpdir())
      let p = handler.openLocalConfig()
      await helper.waitPromptWin()
      await nvim.input('n')
      await p
      p = handler.openLocalConfig()
      await helper.waitPromptWin()
      await nvim.input('y')
      await p
      let bufname = await nvim.call('bufname', ['%'])
      expect(bufname).toMatch('coc-settings.json')
    })

    it('should add workspace folder', async () => {
      expect(() => {
        handler.addWorkspaceFolder(undefined)
      }).toThrow(TypeError)
      expect(() => {
        handler.addWorkspaceFolder(__filename)
      }).toThrow(Error)
      await helper.plugin.cocAction('addWorkspaceFolder', __dirname)
      let folders = workspace.workspaceFolderControl.workspaceFolders
      let uri = URI.file(__dirname).toString()
      let find = folders.find(o => o.uri === uri)
      expect(find).toBeDefined()
    })

    it('should check env on vim resized', async () => {
      await events.fire('VimResized', [80, 80])
      expect(workspace.env.columns).toBe(80)
      await events.fire('VimResized', [160, 80])
      expect(workspace.env.columns).toBe(160)
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

    it('should check json extension', async () => {
      let spy = jest.spyOn(extensions, 'has').mockImplementation(() => {
        return true
      })
      await helper.doAction('checkJsonExtension')
      spy.mockRestore()
      await helper.doAction('checkJsonExtension')
      let line = await helper.getCmdline()
      expect(line).toBeDefined()
    })

    it('should get rootPatterns', async () => {
      let bufnr = await nvim.call('bufnr', ['%'])
      let res = await helper.doAction('rootPatterns', bufnr)
      expect(res).toBeDefined()
    })

    it('should get config by key', async () => {
      let res = await helper.doAction('getConfig', ['suggest'])
      expect(res.autoTrigger).toBeDefined()
    })

    it('should open log', async () => {
      await helper.doAction('openLog')
      let bufname = await nvim.call('bufname', ['%']) as string
      expect(bufname).toMatch('coc-nvim')
    })

    it('should get configuration of current document', async () => {
      let config = await handler.getConfiguration('suggest')
      let wait = config.get<number>('triggerCompletionWait')
      expect(wait).toBe(0)
    })

    it('should get root patterns', async () => {
      let doc = await helper.createDocument()
      let patterns = handler.getRootPatterns(doc.bufnr)
      expect(patterns).toBeDefined()
      patterns = handler.getRootPatterns(999)
      expect(patterns).toBeNull()
    })
  })

  describe('doKeymap()', () => {
    it('should return default value when key mapping does not exist', async () => {
      let res = await helper.doAction('doKeymap', ['not_exists', ''])
      expect(res).toBe('')
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
    it('should return false when coc-snippets not found', async () => {
      let fn = async () => {
        expect(await handler.snippetCheck(true, false)).toBe(false)
      }
      await expect(fn()).rejects.toThrow(Error)
      let spy = jest.spyOn(extensions.manager, 'call').mockImplementation(() => {
        return Promise.resolve(true)
      })
      expect(await handler.snippetCheck(true, false)).toBe(true)
      spy.mockRestore()
    })

    it('should check jump', async () => {
      expect(await handler.snippetCheck(false, true)).toBe(false)
      let spy = jest.spyOn(snippetManager, 'jumpable').mockImplementation(() => {
        return true
      })
      expect(await handler.snippetCheck(false, true)).toBe(true)
      spy.mockRestore()
    })
  })
})
