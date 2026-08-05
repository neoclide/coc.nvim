// Merged from editors.test.ts, locations.test.ts and workspaceFolder.test.ts
// to share a single nvim session and reduce per-file startup overhead.
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Disposable, Location, Position, Range, WorkspaceFolder, WorkspaceFoldersChangeEvent } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import commands from '../../commands'
import Configurations from '../../configuration/index'
import Editors, { TextEditor, renamed } from '../../core/editors'
import WorkspaceFolderController, { PatternType } from '../../core/workspaceFolder'
import events from '../../events'
import { disposeAll } from '../../util'
import { CancellationError } from '../../util/errors'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

let editors: Editors
let nvim: Neovim
let disposables: Disposable[] = []
let workspaceFolder: WorkspaceFolderController
let configurations: Configurations

function updateConfiguration(key: string, value: any, defaults: any): void {
  configurations.updateMemoryConfig({ [key]: value })
  disposables.push({
    dispose: () => {
      configurations.updateMemoryConfig({ [key]: defaults })
    }
  })
}

function createLocations(): Location[] {
  let uri = URI.file(__filename).toString()
  return [Location.create(uri, Range.create(0, 0, 1, 0)), Location.create(uri, Range.create(2, 0, 3, 0))]
}

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  editors = workspace.editors
  await nvim.command(`source ${path.join(process.cwd(), 'autoload/coc/ui.vim')}`)
  let userConfigFile = path.join(process.env.COC_VIMCONFIG, 'coc-settings.json')
  configurations = new Configurations(userConfigFile, undefined)
  workspaceFolder = new WorkspaceFolderController(configurations)
})

afterAll(async () => {
  disposeAll(disposables)
  await helper.shutdown()
})

afterEach(async () => {
  workspaceFolder?.reset()
  disposeAll(disposables)
  await helper.reset()
})

describe('util', () => {
  it('should check renamed', async () => {
    await helper.edit('foo')
    let editor = editors.activeTextEditor
    expect(renamed(editor, {
      bufnr: 0,
      fullpath: '',
      tabid: 1,
      winid: 1000,
    })).toBe(false)
    expect(renamed(editor, {
      bufnr: editor.document.bufnr,
      fullpath: '',
      tabid: 1,
      winid: 1000,
    })).toBe(true)
    expect(renamed(editor, {
      bufnr: editor.document.bufnr,
      fullpath: URI.parse(editor.document.uri).fsPath,
      tabid: 1,
      winid: 1000,
    })).toBe(false)
    Object.assign(editor, { uri: 'lsp:///1' })
    expect(renamed(editor, {
      bufnr: editor.document.bufnr,
      fullpath: '',
      tabid: 1,
      winid: 1000,
    })).toBe(false)
  })
})

describe('editors', () => {

  function assertEditor(editor: TextEditor, tabpagenr: number, winid: number) {
    expect(editor).toBeDefined()
    expect(editor.tabpageid).toBe(tabpagenr)
    expect(editor.winid).toBe(winid)
  }

  it('should have active editor', async () => {
    let winid = await nvim.call('win_getid') as number
    let editor = window.activeTextEditor
    assertEditor(editor, 1, winid)
    let editors = window.visibleTextEditors
    expect(editors.length).toBe(1)
    workspace.editors.checkTabs([])
    workspace.editors.checkUnloadedBuffers([])
  })

  it('should get winids of bufnr', () => {
    let res = workspace.editors.getBufWinids(1000)
    expect(res).toEqual([])
  })

  it('should retry editor creation after get_editoroption failure', async () => {
    let editors: any = workspace.editors
    let winid = await nvim.call('win_getid') as number
    // Simulate a window that is not tracked by the editors yet.
    editors.editors.delete(winid)
    let calls = 0
    let original: any = nvim.call
    let spy = vi.spyOn(nvim, 'call').mockImplementation(((method: string, args?: any[]) => {
      if (method == 'coc#util#get_editoroption' && args && args[0] === winid) {
        calls++
        if (calls == 1) return Promise.reject(new Error('request failed'))
      }
      return original.call(nvim, method, args)
    }) as any)
    await expect(editors.createTextEditor(winid)).rejects.toThrow('request failed')
    let changed = await editors.createTextEditor(winid)
    expect(calls).toBe(2)
    expect(changed).toBe(true)
    expect(workspace.editors.activeTextEditor).toBeDefined()
    spy.mockRestore()
  })

  it('should create editor not created', async () => {
    await nvim.command(`edit +setl\\ buftype=nofile foo`)
    let doc = await workspace.document
    await nvim.command('setl buftype=')
    await events.fire('BufDetach', [doc.bufnr])
    await events.fire('CursorHold', [doc.bufnr])
    expect(window.activeTextEditor).toBeDefined()
    expect(window.visibleTextEditors.length).toBe(1)
  })

  it('should detect buffer rename', async () => {
    let doc = await helper.createDocument('foo')
    await doc.buffer.setName('bar')
    await events.fire('CursorHold', [doc.bufnr])
    expect(window.activeTextEditor).toBeDefined()
    expect(window.activeTextEditor.id).toMatch(/bar$/)
  })

  it('should detect buffer switch', async () => {
    let doc = await helper.createDocument('foo')
    await helper.createDocument('bar')
    await nvim.command('noa b ' + doc.bufnr)
    await events.fire('CursorHold', [doc.bufnr])
    expect(window.activeTextEditor).toBeDefined()
    expect(window.activeTextEditor.id).toMatch(/foo$/)
  })

  it('should change active editor on split', async () => {
    let promise = new Promise<TextEditor>(resolve => {
      editors.onDidChangeActiveTextEditor(e => {
        resolve(e)
      }, null, disposables)
    })
    await nvim.command('vnew')
    let editor = await promise
    let winid = await nvim.call('win_getid')
    expect(editor.winid).toBe(winid)
  })

  it('should change active editor on tabe', async () => {
    let promise = new Promise<TextEditor>(resolve => {
      editors.onDidChangeActiveTextEditor(e => {
        if (e.document.uri.includes('foo')) {
          resolve(e)
        }
      }, null, disposables)
    })
    await nvim.command('tabe a | tabe b | tabe foo')
    let editor = await promise
    let winid = await nvim.call('win_getid')
    expect(editor.winid).toBe(winid)
  })

  it('should change active editor on edit', async () => {
    await nvim.call('win_getid')
    let n = 0
    let promise = new Promise<TextEditor>(resolve => {
      window.onDidChangeVisibleTextEditors(() => {
        n++
      }, null, disposables)
      editors.onDidChangeActiveTextEditor(e => {
        n++
        resolve(e)
      })
    })
    await nvim.command('edit editors')
    let editor = await promise
    expect(editor.document.uri).toMatch('editors')
    await helper.waitValue(() => {
      return n >= 2
    }, true)
  })

  it('should change active editor on window switch', async () => {
    let winid = await nvim.call('win_getid')
    await nvim.command('vs foo')
    await nvim.command('wincmd p')
    let curr = editors.activeTextEditor
    expect(curr.winid).toBe(winid)
    expect(editors.visibleTextEditors.length).toBe(2)
  })

  it('should cleanup on CursorHold', async () => {
    let promise = new Promise<TextEditor>(resolve => {
      editors.onDidChangeActiveTextEditor(e => {
        if (e.document.uri.includes('foo')) {
          resolve(e)
        }
      }, null, disposables)
    })
    await nvim.command('sp foo')
    await promise
    await nvim.command('noa close')
    let bufnr = await nvim.eval("bufnr('%')")
    await events.fire('CursorHold', [bufnr])
    expect(editors.visibleTextEditors.length).toBe(1)
  })

  it('should cleanup on create', async () => {
    let winid = await nvim.call('win_getid')
    let promise = new Promise<TextEditor>(resolve => {
      editors.onDidChangeActiveTextEditor(e => {
        if (e.document.uri.includes('foo')) {
          resolve(e)
        }
      }, null, disposables)
    })
    await nvim.command('tabe foo')
    await promise
    await nvim.call('win_execute', [winid, 'noa close'])
    await nvim.command('edit bar')
  })

  it('should have current tabpageid after tab changed', async () => {
    await nvim.command('tabe')
    await events.fire('CursorHold', [await nvim.call('bufnr', ['%'])])
    await helper.waitValue(() => {
      return editors.visibleTextEditors.length
    }, 2)
    let ids: number[] = []
    editors.visibleTextEditors.forEach(editor => {
      ids.push(editor.tabpageid)
    })
    let editor = editors.visibleTextEditors[editors.visibleTextEditors.length - 1]
    let previousId = editor.tabpageid
    await nvim.command('normal! 1gt')
    await nvim.command('tabe')
    await helper.waitValue(() => {
      return editors.visibleTextEditors.length
    }, 3)
    expect(editor.tabpageid).toBe(previousId)
    let tid: number
    let disposable = editors.onDidTabClose(id => {
      tid = id
    })
    await nvim.command('tabc')
    await helper.waitValue(() => {
      return editors.visibleTextEditors.length
    }, 2)
    disposable.dispose()
    expect(editor.tabpageid).toBe(previousId)
    expect(tid).toBeDefined()
    editor = editors.visibleTextEditors.find(o => o.tabpageid == tid)
    expect(editor).toBeUndefined()
  })

  it('should recreate editor on document reload', async () => {
    let doc = await helper.createDocument('foo')
    let bufnr = doc.bufnr
    await nvim.command('edit!')
    await helper.waitValue(() => {
      return workspace.getDocument(bufnr) !== doc
    }, true)
    doc = workspace.getDocument(bufnr)
    expect(editors.activeTextEditor.document.bufnr).toBe(bufnr)
    expect(editors.activeTextEditor.document === doc).toBe(true)
    await nvim.command('setf javascript')
    await helper.waitValue(() => {
      return doc.filetype
    }, 'javascript')
    expect(editors.activeTextEditor.document.filetype).toBe('javascript')
  })
})

describe('Tabs', () => {
  it('should attach tabs', async () => {
    let doc = await workspace.document
    expect(workspace.tabs.isActive(doc.textDocument)).toBe(true)
    expect(workspace.tabs.isActive(URI.parse(doc.uri))).toBe(true)
    expect(workspace.tabs.isVisible(doc.textDocument)).toBe(true)
    expect(workspace.tabs.isVisible(URI.parse(doc.uri))).toBe(true)
    workspace.editors['winid'] = 1
    expect(workspace.tabs.isActive(URI.parse(doc.uri))).toBe(false)
    let resources = workspace.tabs.getTabResources()
    expect(resources.size).toBeGreaterThan(0)
  })

  it('should fire open and close event', async () => {
    let tabs = workspace.tabs
    let fn = vi.fn()
    let disposable = tabs.onOpen(() => {
      fn()
    })
    nvim.command('tabe foo', true)
    nvim.command('tabe foo', true)
    await helper.waitValue(() => {
      return tabs.getTabResources().size
    }, 2)
    disposable.dispose()
    expect(fn).toHaveBeenCalledTimes(1)
    nvim.command('bd', true)
    fn = vi.fn()
    disposable = tabs.onClose(() => {
      fn()
    })
    await helper.waitValue(() => {
      return tabs.getTabResources().size
    }, 1)
    disposable.dispose()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('showLocations()', () => {
  it('should show locations by editor.action.showReferences', async () => {
    let doc = await workspace.document
    let uri = doc.uri
    let locations = createLocations()
    await commands.executeCommand('editor.action.showReferences', uri, Position.create(0, 0), locations)
    await helper.waitValue(async () => {
      let wins = await nvim.windows
      return wins.length > 1
    }, true)
  })

  it('should show location list by default', async () => {
    let locations = createLocations()
    await workspace.showLocations(locations)
    await helper.waitFor('bufname', ['%'], 'list:///location')
  })

  it('should fire autocmd when location list disabled', async () => {
    Object.assign(workspace.env, {
      locationlist: false
    })
    await nvim.exec(`
function OnLocationsChange()
  let g:called = 1
endfunction
autocmd User CocLocationsChange :call OnLocationsChange()`)
    let locations = createLocations()
    await workspace.showLocations(locations)
    await helper.waitFor('eval', [`get(g:,'called',0)`], 1)
  })

  it('should show quickfix when quickfix enabled', async () => {
    helper.updateConfiguration('coc.preferences.useQuickfixForLocations', true)
    let locations = createLocations()
    await workspace.showLocations(locations)
    await helper.waitFor('eval', [`&buftype`], 'quickfix')
  })

  it('should use customized quickfix open command', async () => {
    await nvim.setVar('coc_quickfix_open_command', 'copen 1')
    helper.updateConfiguration('coc.preferences.useQuickfixForLocations', true)
    let locations = createLocations()
    await workspace.showLocations(locations)
    await helper.waitFor('eval', [`&buftype`], 'quickfix')
    let win = await nvim.window
    let height = await win.height
    expect(height).toBe(1)
  })
})

describe('jumpTo()', () => {
  it('should jumpTo position', async () => {
    let uri = URI.file('/tmp/foo')
    await workspace.jumpTo(uri, { line: 1, character: 1 })
    await nvim.command('setl buftype=nofile')
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toMatch('/foo')
    await buf.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false })
    await workspace.jumpTo(uri, { line: 1, character: 1 })
    let pos = await nvim.call('getcurpos') as number[]
    expect(pos.slice(1, 3)).toEqual([2, 2])
  })

  it('should jumpTo uri without normalize', async () => {
    let uri = 'zipfile:///tmp/clojure-1.9.0.jar::clojure/core.clj'
    await workspace.jumpTo(uri)
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toBe(uri)
    let doc = await workspace.document
    expect(doc.uri.startsWith('zipfile:/tmp')).toBe(true)
  })

  it('should jump without position', async () => {
    let uri = URI.file('/tmp/foo').toString()
    await workspace.jumpTo(uri)
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toMatch('/foo')
  })

  it('should jumpTo custom uri scheme', async () => {
    let uri = 'jdt://foo'
    await workspace.jumpTo(uri, { line: 1, character: 1 })
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toBe(uri)
  })

  it('should jump with uri fragment', async () => {
    let uri = URI.file(__filename).with({ fragment: '3,3' }).toString()
    await workspace.jumpTo(uri)
    let cursor = await nvim.call('coc#util#cursor')
    expect(cursor).toEqual([2, 2])
    uri = URI.file(__filename).with({ fragment: '1' }).toString()
    await workspace.jumpTo(uri)
    cursor = await nvim.call('coc#util#cursor')
    expect(cursor).toEqual([0, 0])
  })
})

describe('openResource()', () => {
  it('should open resource', async () => {
    let uri = URI.file(path.join(os.tmpdir(), 'bar')).toString()
    await workspace.openResource(uri)
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toMatch('bar')
  })

  it('should open none file uri', async () => {
    workspace.registerTextDocumentContentProvider('jd', {
      provideTextDocumentContent: () => 'jd'
    })
    let uri = 'jd://abc'
    await workspace.openResource(uri)
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toBe('jd://abc')
  })

  it('should open opened buffer', async () => {
    let buf = await helper.edit()
    let doc = workspace.getDocument(buf.id)
    await workspace.openResource(doc.uri)
    await helper.waitFor('bufnr', ['%'], buf.id)
  })

  it('should open url', async () => {
    await helper.mockFunction('coc#ui#open_url', 0)
    let buf = await helper.edit()
    let uri = 'http://example.com'
    await workspace.openResource(uri)
    await helper.waitFor('bufnr', ['%'], buf.id)
  })
})

describe('WorkspaceFolderController', () => {
  describe('asRelativePath()', () => {
    function assertAsRelativePath(input: string | URI, expected: string, includeWorkspace?: boolean) {
      const actual = workspaceFolder.getRelativePath(input, includeWorkspace)
      expect(actual).toBe(expected)
    }

    it('should get relative path', async () => {
      workspaceFolder.addWorkspaceFolder(`/Coding/Applications/NewsWoWBot`, false)
      assertAsRelativePath('/Coding/Applications/NewsWoWBot/bernd/das/brot', 'bernd/das/brot')
      assertAsRelativePath('/Apps/DartPubCache/hosted/pub.dartlang.org/convert-2.0.1/lib/src/hex.dart',
        '/Apps/DartPubCache/hosted/pub.dartlang.org/convert-2.0.1/lib/src/hex.dart')
      assertAsRelativePath('', '')
      assertAsRelativePath('/foo/bar', '/foo/bar')
      assertAsRelativePath('in/out', 'in/out')
      assertAsRelativePath(null, '')
      assertAsRelativePath(URI.file('/tmp'), '/tmp')
    })

    it('should asRelativePath, same paths, #11402', async () => {
      const root = '/home/aeschli/workspaces/samples/docker'
      const input = '/home/aeschli/workspaces/samples/docker'
      workspaceFolder.addWorkspaceFolder(root, false)
      assertAsRelativePath(input, input)
      const input2 = '/home/aeschli/workspaces/samples/docker/a.file'
      assertAsRelativePath(input2, 'a.file')
    })

    it('should asRelativePath, not workspaceFolder', async () => {
      expect(workspace.asRelativePath('')).toBe('')
      assertAsRelativePath('/foo/bar', '/foo/bar')
    })

    it('should asRelativePath, multiple folders', () => {
      workspaceFolder.addWorkspaceFolder(`/Coding/One`, false)
      workspaceFolder.addWorkspaceFolder(`/Coding/Two`, false)
      assertAsRelativePath('/Coding/One/file.txt', 'One/file.txt')
      assertAsRelativePath('/Coding/Two/files/out.txt', 'Two/files/out.txt')
      assertAsRelativePath('/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt')
    })

    it('should slightly inconsistent behaviour of asRelativePath and getWorkspaceFolder, #31553', async () => {
      workspaceFolder.addWorkspaceFolder(`/Coding/One`, false)
      workspaceFolder.addWorkspaceFolder(`/Coding/Two`, false)

      assertAsRelativePath('/Coding/One/file.txt', 'One/file.txt')
      assertAsRelativePath('/Coding/One/file.txt', 'One/file.txt', true)
      assertAsRelativePath('/Coding/One/file.txt', 'file.txt', false)
      assertAsRelativePath('/Coding/Two/files/out.txt', 'Two/files/out.txt')
      assertAsRelativePath('/Coding/Two/files/out.txt', 'Two/files/out.txt', true)
      assertAsRelativePath('/Coding/Two/files/out.txt', 'files/out.txt', false)
      assertAsRelativePath('/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt')
      assertAsRelativePath('/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt', true)
      assertAsRelativePath('/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt', false)
    })
  })

  describe('setWorkspaceFolders()', () => {
    it('should set valid folders', async () => {
      workspaceFolder.setWorkspaceFolders([os.tmpdir(), '/a/not_exists'])
      let folders = workspaceFolder.workspaceFolders
      expect(folders.length).toBe(2)
    })
  })

  describe('getWorkspaceFolder()', () => {
    it('should get workspaceFolder by uri', async () => {
      let res = workspaceFolder.getWorkspaceFolder(URI.parse('untitled://1'))
      expect(res).toBeUndefined()
      res = workspaceFolder.getWorkspaceFolder(URI.file('/a/b'))
      expect(res).toBeUndefined()
      let filepath = path.join(process.cwd(), 'a/b')
      workspaceFolder.setWorkspaceFolders([process.cwd()])
      res = workspaceFolder.getWorkspaceFolder(URI.file(filepath))
      expect(URI.parse(res.uri).fsPath).toBe(process.cwd())

      const nonWorkspaceFolderFilePath = path.join(path.dirname(process.cwd()), 'NonWorkspaceFolder/file')
      res = workspaceFolder.getWorkspaceFolder(URI.file(nonWorkspaceFolderFilePath))
      expect(res).toBeUndefined()
    })
  })

  describe('getRootPatterns()', () => {
    it('should get patterns from b:coc_root_patterns', async () => {
      await nvim.command('edit t.vim | let b:coc_root_patterns=["foo"]')
      await nvim.command('setf vim')
      let doc = await workspace.document
      let res = workspaceFolder.getRootPatterns(doc, PatternType.Buffer)
      expect(res).toEqual(['foo'])
    })

    it('should add patterns from languageserver', () => {
      updateConfiguration('languageserver.test', {
        filetypes: ['vim'],
        rootPatterns: ['bar']
      }, undefined)
      workspaceFolder.addRootPattern('vim', ['foo'])
      let res = workspaceFolder.getServerRootPatterns('vim')
      expect(res.includes('foo')).toBe(true)
      expect(res.includes('bar')).toBe(true)
    })

    it('should get patterns from user configuration', async () => {
      let doc = await workspace.document
      let res = workspaceFolder.getRootPatterns(doc, PatternType.Global)
      expect(res.includes('.git')).toBe(true)
    })
  })

  describe('resolveRoot()', () => {
    const cwd = process.cwd()
    const expand = (input: string) => {
      return workspace.expand(input)
    }

    it('should resolve to cwd for file in cwd', async () => {
      updateConfiguration('workspace.rootPatterns', [], ['.git', '.hg', '.projections.json'])
      let file = path.join(os.tmpdir(), 'foo')
      let doc = await helper.createDocument(file)
      let res = workspaceFolder.resolveRoot(doc, os.tmpdir(), false, expand)
      expect(res).toBe(os.tmpdir())
    })

    it('should ignore cwd by ignore pattern', async () => {
      updateConfiguration('workspace.rootPatterns', [], ['.git', '.hg', '.projections.json'])
      updateConfiguration('workspace.ignoredFolders', ['**/*'], ['$HOME'])
      let file = path.join(os.tmpdir(), 'foo')
      let doc = await helper.createDocument(file)
      let res = workspaceFolder.resolveRoot(doc, os.tmpdir(), false, expand)
      expect(res).toBeNull()
    })

    it('should not fallback to cwd as workspace folder', async () => {
      updateConfiguration('workspace.rootPatterns', [], ['.git', '.hg', '.projections.json'])
      updateConfiguration('workspace.workspaceFolderFallbackCwd', false, true)
      let file = path.join(os.tmpdir(), 'foo')
      await nvim.command(`edit ${file}`)
      let doc = await workspace.document
      let res = workspaceFolder.resolveRoot(doc, os.tmpdir(), false, expand)
      expect(res).toBe(null)
    })

    it('should return null for untitled buffer', async () => {
      await nvim.command('enew')
      let doc = await workspace.document
      let res = workspaceFolder.resolveRoot(doc, cwd, false, expand)
      expect(res).toBe(null)
    })

    it('should respect ignored filetypes', async () => {
      updateConfiguration('workspace.ignoredFiletypes', ['vim'], [])
      await nvim.command('edit t.vim')
      await nvim.command('setf vim')
      let doc = await workspace.document
      let res = workspaceFolder.resolveRoot(doc, cwd, false, expand)
      expect(res).toBe(null)
    })

    it('should respect workspaceFolderCheckCwd', async () => {
      let called = 0
      disposables.push(workspaceFolder.onDidChangeWorkspaceFolders(() => {
        called++
      }))
      workspaceFolder.addRootPattern('vim', ['.vim'])
      await nvim.command('edit a/.vim/t.vim')
      await nvim.command('setf vim')
      let doc = await workspace.document
      let res = workspaceFolder.resolveRoot(doc, cwd, true, expand)
      expect(res).toBe(process.cwd())
      await nvim.command('edit a/foo')
      doc = await workspace.document
      res = workspaceFolder.resolveRoot(doc, cwd, true, expand)
      expect(res).toBe(process.cwd())
      expect(called).toBe(1)
    })

    it('should respect ignored folders', async () => {
      updateConfiguration('workspace.ignoredFolders', ['$HOME/foo', '$HOME'], [])
      let file = path.join(os.homedir(), '.vim/bar')
      workspaceFolder.addRootPattern('vim', ['.vim'])
      await nvim.command(`edit ${file}`)
      await nvim.command('setf vim')
      let doc = await workspace.document
      let res = workspaceFolder.resolveRoot(doc, path.join(os.homedir(), 'foo'), true, expand)
      expect(res).toBe(null)
    })

    it('should respect specific filetype for bottomUpFileTypes', async () => {
      updateConfiguration('workspace.rootPatterns', ['.vim'], ['.git', '.hg', '.projections.json'])
      updateConfiguration('workspace.bottomUpFiletypes', ['vim'], [])
      let root = path.join(os.tmpdir(), 'a')
      let dir = path.join(root, '.vim')
      fs.mkdirSync(dir, { recursive: true })
      let file = path.join(dir, 'foo.vim')
      await nvim.command(`edit ${file}`)
      let doc = await workspace.document
      expect(doc.filetype).toBe('vim')
      let res = workspaceFolder.resolveRoot(doc, file, true, expand)
      expect(res).toBe(root)
    })

    it('should respect wildcard', async () => {
      updateConfiguration('workspace.rootPatterns', ['.vim'], ['.git', '.hg', '.projections.json'])
      updateConfiguration('workspace.bottomUpFiletypes', ['*'], [])
      let root = path.join(os.tmpdir(), 'a')
      let dir = path.join(root, '.vim')
      fs.mkdirSync(dir, { recursive: true })
      let file = path.join(dir, 'foo')
      await nvim.command(`edit ${file}`)
      let doc = await workspace.document
      let res = workspaceFolder.resolveRoot(doc, file, true, expand)
      expect(res).toBe(root)
    })
  })

  describe('renameWorkspaceFolder()', () => {
    it('should rename workspaceFolder', async () => {
      let e: WorkspaceFoldersChangeEvent
      disposables.push(workspaceFolder.onDidChangeWorkspaceFolders(ev => {
        e = ev
      }))
      let cwd = process.cwd()
      workspaceFolder.addWorkspaceFolder(cwd, false)
      workspaceFolder.addWorkspaceFolder(cwd, false)
      workspaceFolder.renameWorkspaceFolder(cwd, path.join(cwd, '.vim'))
      expect(e.removed.length).toBe(1)
      expect(e.added.length).toBe(1)
    })
  })

  describe('removeWorkspaceFolder()', () => {
    it('should remote workspaceFolder', async () => {
      let e: WorkspaceFoldersChangeEvent
      disposables.push(workspaceFolder.onDidChangeWorkspaceFolders(ev => {
        e = ev
      }))
      let cwd = process.cwd()
      workspaceFolder.addWorkspaceFolder(cwd, false)
      workspaceFolder.removeWorkspaceFolder(cwd)
      workspaceFolder.removeWorkspaceFolder('/a/b')
      expect(e.removed.length).toBe(1)
      expect(e.added.length).toBe(0)
    })

    it('should not throw for invalid folder', async () => {
      workspaceFolder.addWorkspaceFolder('tmp', false)
      workspaceFolder.removeWorkspaceFolder('tmp')
      workspaceFolder.renameWorkspaceFolder('tmp', 'other')
    })
  })

  describe('checkPatterns()', () => {
    it('should check if pattern exists', async () => {
      expect(await workspaceFolder.checkPatterns([], ['p'])).toBe(false)
      let folderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-wsfolder-'))
      try {
        fs.writeFileSync(path.join(folderPath, 'package.json'), '{}')
        let folder: WorkspaceFolder = { name: '', uri: URI.file(folderPath).toString() }
        let res = await workspaceFolder.checkPatterns([folder], ['package.json', '**/not_exists'])
        expect(res).toBe(true)
        res = await workspaceFolder.checkPatterns([folder], ['**/not_exists'])
        expect(res).toBe(false)
      } finally {
        fs.rmSync(folderPath, { recursive: true, force: true })
      }
    })

    it('should not throw on timeout', async () => {
      let spy = vi.spyOn(workspaceFolder, 'checkFolder').mockImplementation((_dir, _patterns, token) => {
        return new Promise((resolve, reject) => {
          let timer = setTimeout(() => {
            resolve(undefined)
          }, 200)
          token.onCancellationRequested(() => {
            clearTimeout(timer)
            reject(new CancellationError())
          })
        })
      })
      let folder: WorkspaceFolder = { name: '', uri: URI.file(process.cwd()).toString() }
      try {
        let res = await workspaceFolder.checkPatterns([folder], ['**/schema.json'])
        expect(res).toBe(false)
        // the timed-out token source must be released, not kept forever
        expect((workspaceFolder as any)._tokenSources.size).toBe(0)
        await workspaceFolder.checkPatterns([folder], ['**/schema.json'])
        expect((workspaceFolder as any)._tokenSources.size).toBe(0)
      } finally {
        spy.mockRestore()
      }
    })
  })

  describe('onDocumentDetach()', () => {
    it('should check uris', async () => {
      updateConfiguration('workspace.removeEmptyWorkspaceFolder', true, false)
      let folder = os.tmpdir()
      workspaceFolder.addWorkspaceFolder(folder, false)
      workspaceFolder.onDocumentDetach([URI.parse('untitled:/1'), URI.parse('file:///foo/bar')])
      expect(workspaceFolder.workspaceFolders.length).toBe(0)
      workspaceFolder.addWorkspaceFolder(folder, false)
      workspaceFolder.onDocumentDetach([URI.parse('untitled:/1'), URI.file(path.join(os.tmpdir(), 'foo'))])
      expect(workspaceFolder.workspaceFolders.length).toBe(1)
    })

  })
})
