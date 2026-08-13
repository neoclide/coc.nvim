import { Neovim } from '@chemzqm/neovim'
import cp from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Disposable } from 'vscode-languageserver-protocol'
import { Location, Position, Range, TextEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { userSettingsSchemaId } from '../../configuration'
import events from '../../events'
import { disposeAll } from '../../util'
import workspace, { Workspace } from '../../workspace'
import * as shared from '../sharedUtil'

let nvim: Neovim
let disposables: Disposable[] = []
let tmpFolder = path.join(os.tmpdir(), `coc-${process.pid}`)

before(async () => {
  nvim = workspace.nvim
  if (!fs.existsSync(tmpFolder)) fs.mkdirSync(tmpFolder)
})

afterEach(async () => {
  disposeAll(disposables)
  disposables = []
})

afterEach(editorReset)

describe('workspace properties', () => {
  it('should have initialized', async t => {
    let { nvim, uri, insertMode, workspaceFolder, cwd, documents, textDocuments } = workspace
    assert.strictEqual(insertMode, false)
    assert.ok(nvim)
    assert.strictEqual(documents.length, 1)
    assert.strictEqual(textDocuments.length, 1)
    assert.strictEqual(cwd, process.cwd())
    let floatSupported = workspace.floatSupported
    assert.strictEqual(floatSupported, true)
    let { pluginRoot } = workspace
    assert.strictEqual(typeof pluginRoot, 'string')
    let { isVim, isNvim } = workspace
    assert.strictEqual(isVim, false)
    assert.strictEqual(isNvim, true)
    assert.notStrictEqual(uri, undefined)
    assert.strictEqual(workspaceFolder, undefined)
    let watchmanPath = workspace.getWatchmanPath()
    assert.strictEqual(watchmanPath == null || typeof watchmanPath === 'string', true)
    let folder = workspace.getWorkspaceFolder(URI.parse('lsp:/1'))
    assert.strictEqual(folder, undefined)
    let rootPath = await shared.doAction('currentWorkspacePath')
    assert.strictEqual(rootPath, process.cwd())
  })

  it('should get filetyps', async t => {
    await shared.edit('f.js')
    let filetypes = workspace.filetypes
    assert.strictEqual(filetypes.has('javascript'), true)
    let languageIds = workspace.languageIds
    assert.strictEqual(languageIds.has('javascript'), true)
  })

  it('should get display width', t => {
    assert.strictEqual(workspace.getDisplayWidth('a'), 1)
  })

  it('should fallback to text length when strWidth not ready', t => {
    let strWidth = workspace['strWidth']
    workspace['strWidth'] = undefined
    try {
      assert.strictEqual(workspace.getDisplayWidth('foo'), 3)
      assert.strictEqual(workspace.getDisplayWidth('嘻嘻'), 2)
    } finally {
      workspace['strWidth'] = strWidth
    }
  })

  it('should get channelNames', async t => {
    let names = workspace.channelNames
    assert.strictEqual(Array.isArray(names), true)
  })

  it('should work with deprecated method', async t => {
    await nvim.setLine('foo')
    await workspace['moveTo'](Position.create(0, 1))
    let col = await nvim.call('col', ['.'])
    assert.strictEqual(col, 2)
  })
})

describe('workspace methods', () => {
  it('should call vim method', async t => {
    let res = await workspace.callAsync('bufnr', ['%'])
    assert.strictEqual(typeof res, 'number')
    let obj: any = workspace.env
    obj.isVim = true
    disposables.push({
      dispose: () => {
        obj.isVim = false
      }
    })
    res = await workspace.callAsync('bufnr', ['%'])
    assert.strictEqual(typeof res, 'number')
  })

  it('should get the document', async t => {
    let doc = await workspace.document
    let buf = await nvim.buffer
    assert.ok(doc.buffer.equals(buf))
    doc = workspace.getDocument(doc.uri)
    assert.ok(doc.buffer.equals(buf))
  })

  it('should get uri', async t => {
    let doc = await workspace.document
    assert.notStrictEqual(workspace.getUri(doc.bufnr, undefined), undefined)
    assert.strictEqual(workspace.getUri(999, null), null)
    assert.strictEqual(workspace.getUri(999), '')
  })

  it('should fixWin32unixPrefix', async t => {
    assert.strictEqual(workspace.fixWin32unixFilepath('/foo'), '/foo')
  })

  it('should get attached document', async t => {
    let fn = () => {
      workspace.getAttachedDocument('file://not_exists')
    }
    assert.throws(fn, Error)
    await nvim.command(`edit +setl\\ buftype=nofile [tree]`)
    let doc = await workspace.document
    assert.strictEqual(doc.attached, false)
    fn = () => {
      workspace.getAttachedDocument(doc.bufnr)
    }
    assert.throws(fn, Error)
  })

  it('should get format options of without bufnr', async t => {
    let opts = await workspace.getFormatOptions()
    assert.strictEqual(opts.insertSpaces, true)
    assert.strictEqual(opts.tabSize, 2)
  })

  it('should get format options of current buffer', async t => {
    let buf = await nvim.buffer
    await buf.setVar('coc_trim_trailing_whitespace', 1)
    await buf.setVar('coc_trim_final_newlines', 1)
    await buf.setOption('shiftwidth', 8)
    await buf.setOption('expandtab', false)
    let doc = workspace.getDocument(buf.id)
    let opts = await workspace.getFormatOptions(doc.uri)
    assert.deepStrictEqual(opts, {
      tabSize: 8,
      insertSpaces: false,
      insertFinalNewline: true,
      trimTrailingWhitespace: true,
      trimFinalNewlines: true
    })
  })

  it('should check document', async t => {
    let doc = await workspace.document
    assert.strictEqual(workspace.hasDocument(doc.uri), true)
    assert.strictEqual(workspace.hasDocument(doc.uri, doc.version), true)
    assert.strictEqual(workspace.hasDocument(doc.uri, doc.version - 1), false)
  })

  it('should get format options when uri does not exist', async t => {
    let uri = URI.file('/tmp/foo').toString()
    let opts = await workspace.getFormatOptions(uri)
    assert.strictEqual(opts.insertSpaces, true)
    assert.strictEqual(opts.tabSize, 2)
  })

  it('should create file watcher', async t => {
    let watcher = workspace.createFileSystemWatcher('**/*.ts')
    assert.notStrictEqual(watcher, undefined)
  })

  it('should get quickfix item from Location', async t => {
    let filepath = await shared.createTmpFile('quickfix')
    let uri = URI.file(filepath).toString()
    let p = Position.create(0, 0)
    let loc = Location.create(uri, Range.create(p, p))
    let item = await workspace.getQuickfixItem(loc)
    assert.strictEqual(item.filename, filepath)
    assert.strictEqual(item.text, 'quickfix')
  })

  it('should get quickfix list from Locations', async t => {
    let filepathA = await shared.createTmpFile('fileA:1\nfileA:2\nfileA:3')
    let uriA = URI.file(filepathA).toString()
    let filepathB = await shared.createTmpFile('fileB:1\nfileB:2\nfileB:3')
    let uriB = URI.file(filepathB).toString()
    let p1 = Position.create(0, 0)
    let p2 = Position.create(1, 0)
    let locations: Location[] = []
    locations.push(Location.create(uriA, Range.create(p1, p1)))
    locations.push(Location.create(uriA, Range.create(p2, p2)))
    locations.push(Location.create(uriB, Range.create(p1, p1)))
    locations.push(Location.create(uriB, Range.create(p2, p2)))
    let items = await workspace.getQuickfixList(locations)
    assert.strictEqual(items[0].filename, filepathA)
    assert.strictEqual(items[0].text, 'fileA:1')
    assert.strictEqual(items[1].filename, filepathA)
    assert.strictEqual(items[1].text, 'fileA:2')
    assert.strictEqual(items[2].filename, filepathB)
    assert.strictEqual(items[2].text, 'fileB:1')
    assert.strictEqual(items[3].filename, filepathB)
    assert.strictEqual(items[3].text, 'fileB:2')
  })

  it('should get line of document', async t => {
    let doc = await workspace.document
    await nvim.setLine('abc')
    let line = await workspace.getLine(doc.uri, 0)
    assert.strictEqual(line, 'abc')
  })

  it('should get line of file', async t => {
    let filepath = await shared.createTmpFile('quickfix')
    let uri = URI.file(filepath).toString()
    let line = await workspace.getLine(uri, 0)
    assert.strictEqual(line, 'quickfix')
  })

  it('should read content from buffer', async t => {
    let doc = await workspace.document
    await doc.applyEdits([{ range: Range.create(0, 0, 0, 0), newText: 'foo' }])
    let line = await workspace.readFile(doc.uri)
    assert.strictEqual(line, 'foo\n')
  })

  it('should read content from file', async t => {
    let filepath = await shared.createTmpFile('content')
    let content = await workspace.readFile(URI.file(filepath).toString())
    assert.strictEqual(content, content)
  })

  it('should expand filepath', async t => {
    let home = os.homedir()
    let res = workspace.expand('~/$NODE_ENV/')
    assert.ok(res.startsWith(home))
    assert.ok(res.includes(process.env.NODE_ENV))

    res = workspace.expand('$HOME/$NODE_ENV/')
    assert.ok(res.startsWith(home))
    assert.ok(res.includes(process.env.NODE_ENV))
  })

  it('should expand variables', async t => {
    assert.strictEqual(workspace.expand('${workspace}/foo'), `${workspace.root}/foo`)
    assert.strictEqual(workspace.expand('${env:NODE_ENV}'), process.env.NODE_ENV)
    assert.strictEqual(workspace.expand('${cwd}'), workspace.cwd)
    let folder = path.basename(workspace.root)
    assert.strictEqual(workspace.expand('${workspaceFolderBasename}'), folder)
    // The old compiled runner created docs relative to the helper's
    // import.meta.dirname (tests root); keep the same anchor with the source-tree
    // import.meta.dirname so ${fileDirname} matches path.dirname(import.meta.dirname).
    await shared.edit(path.join(path.dirname(import.meta.dirname), 'bar.ts'))
    assert.ok(workspace.expand('${file}').includes('bar'))
    assert.strictEqual(workspace.expand('${fileDirname}'), path.dirname(import.meta.dirname))
    assert.strictEqual(workspace.expand('${fileExtname}'), '.ts')
    assert.strictEqual(workspace.expand('${fileBasename}'), 'bar.ts')
    assert.strictEqual(workspace.expand('${fileBasenameNoExtension}'), 'bar')
  })

  it('should run command', async t => {
    let res = await workspace.runCommand('ls', import.meta.dirname, 1000)
    assert.match(res, new RegExp('workspace'))
    res = await workspace.runCommand('ls')
    assert.notStrictEqual(res, undefined)
  })

  it('should export deprecated properties', async t => {
    assert.notStrictEqual(workspace.completeOpt, undefined)
    assert.notStrictEqual(workspace.createNameSpace('name'), undefined)
    assert.notStrictEqual(Workspace, undefined)
    assert.notStrictEqual(workspace['onDidOpenTerminal'], undefined)
    assert.notStrictEqual(workspace['onDidCloseTerminal'], undefined)
    t.mock.method(workspace.nvim, 'call', () => {
      return Promise.resolve(null)
    })
    workspace.checkVersion(0)
  })

  it('should resolve module path if exists', async t => {
    // Mock the npm/yarn global folder lookup to avoid spawning child
    // processes, the resolve logic itself stays untouched.
    let folder = path.join(tmpFolder, 'npm-root')
    fs.mkdirSync(path.join(folder, 'bytes'), { recursive: true })
    fs.writeFileSync(path.join(folder, 'bytes', 'package.json'), '', 'utf8')
    // runCommand's ESM export is a frozen bundle binding; mock the
    // child_process.exec seam it spawns through instead.
    t.mock.method(cp, 'exec', (_cmd: string, _opts: any, cb: any) => {
      cb(null, Buffer.from(folder + '\n'), Buffer.alloc(0))
    })
    let res = await workspace.resolveModule('bytes')
    res = await workspace.resolveModule('bytes')
    assert.ok(res)
  })

  it('should not resolve module if it does not exist', async t => {
    let folder = path.join(tmpFolder, 'npm-root')
    t.mock.method(cp, 'exec', (_cmd: string, _opts: any, cb: any) => {
      cb(null, Buffer.from(folder + '\n'), Buffer.alloc(0))
    })
    let res = await workspace.resolveModule('foo')
    res = await workspace.resolveModule('foo')
    assert.ok(!res)
  })

  it('should return match score for document', async t => {
    let doc = await shared.createDocument('tmp.xml')
    assert.strictEqual(workspace.match(['xml'], doc.textDocument), 10)
    assert.strictEqual(workspace.match(['wxml'], doc.textDocument), 0)
    assert.strictEqual(workspace.match([{ language: 'xml' }], doc.textDocument), 10)
    assert.strictEqual(workspace.match([{ language: 'wxml' }], doc.textDocument), 0)
    assert.strictEqual(workspace.match([{ pattern: '**/*.xml' }], doc.textDocument), 5)
    assert.strictEqual(workspace.match([{ pattern: '**/*.html' }], doc.textDocument), 0)
    assert.strictEqual(workspace.match([{ scheme: 'file' }], doc.textDocument), 5)
    assert.strictEqual(workspace.match([{ scheme: 'term' }], doc.textDocument), 0)
    assert.strictEqual(workspace.match([{ language: 'xml' }, { scheme: 'file' }], doc.textDocument), 10)
    assert.strictEqual(workspace.match([{ language: 'xml', scheme: 'file', pattern: '**/*.xml' }], doc.textDocument), 10)
  })

  it('should handle will save event', async t => {
    async function doRename() {
      let fsPath = await shared.createTmpFile('foo', disposables)
      let newPath = path.join(path.dirname(fsPath), 'new_file')
      disposables.push(Disposable.create(() => {
        if (fs.existsSync(newPath)) fs.unlinkSync(newPath)
      }))
      await workspace.renameFile(fsPath, newPath, { overwrite: true })
      if (fs.existsSync(newPath)) fs.unlinkSync(newPath)
    }
    let called = false
    let disposable = workspace.onWillRenameFiles(e => {
      let p = new Promise<void>(resolve => {
        setTimeout(() => {
          called = true
          resolve()
        }, 10)
      })
      e.waitUntil(p)
    })
    await doRename()
    disposable.dispose()
    assert.strictEqual(called, true)
    called = false
    disposable = workspace.onWillRenameFiles(e => {
      called = true
      e.waitUntil(Promise.resolve({ changes: {} }))
    })
    await doRename()
    assert.strictEqual(called, true)
    disposable.dispose()
  })

  it('should getWatchConfig', async t => {
    shared.updateConfiguration('fileSystemWatch.enable', null, disposables)
    shared.updateConfiguration('fileSystemWatch.watchmanPath', '~/bin/watchman', disposables)
    shared.updateConfiguration('fileSystemWatch.ignoredFolders', ['~'], disposables)
    let config = workspace.getWatchConfig()
    assert.strictEqual(config.enable, false)
    assert.strictEqual(typeof config.watchmanPath, 'string')
    assert.deepStrictEqual(config.ignoredFolders, [os.homedir()])
  })
})

describe('workspace utility', () => {
  it('should create database', async t => {
    let filpath = path.join(process.env.COC_DATA_HOME, 'test.json')
    if (fs.existsSync(filpath)) {
      fs.unlinkSync(filpath)
    }
    let db = workspace.createDatabase('test')
    let res = db.exists('xyz')
    assert.strictEqual(res, false)
    db.destroy()
  })

  it('should get current state', async t => {
    let buf = await shared.edit()
    await buf.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false })
    await nvim.call('cursor', [2, 2])
    let doc = workspace.getDocument(buf.id)
    let state = await workspace.getCurrentState()
    assert.strictEqual(doc.uri, state.document.uri)
    assert.deepStrictEqual(state.position, { line: 1, character: 1 })
  })

  it('should findUp to tsconfig.json from current file', async t => {
    await shared.edit(path.join(import.meta.dirname, 'edit'))
    let filepath = await workspace.findUp('tsconfig.json')
    assert.match(filepath, new RegExp('tsconfig\\.json'))
  })

  it('should findUp from current file', async t => {
    // The runner's nvim cwd now lives in the OS temp tree; anchor the file
    // under the repo root so findUp reaches the repository's tsconfig.json.
    await shared.edit(path.join(process.cwd(), 'foo'))
    let filepath = await workspace.findUp('tsconfig.json')
    assert.match(filepath, new RegExp('tsconfig\\.json'))
  })

  it('should not findUp from file in other directory', async t => {
    await nvim.command(`edit ${path.join(os.tmpdir(), crypto.randomUUID())}`)
    let filepath = await workspace.findUp('tsconfig.json')
    assert.strictEqual(filepath, null)
  })

  it('should register autocmd', async t => {
    let event: any
    let eventCount = 0
    let disposables = []
    workspace.registerAutocmd({
      event: 'TextYankPost',
      request: true,
      arglist: ['v:event'],
      callback: ev => {
        eventCount += 1
        event = ev
      }
    }, disposables)
    await nvim.setLine('foo')
    await nvim.command('normal! yy')
    await shared.waitValue(() => eventCount, 1)
    assert.strictEqual(event.regtype, 'V')
    assert.strictEqual(event.operator, 'y')
    assert.deepStrictEqual(event.regcontents, ['foo'])
    assert.strictEqual(eventCount, 1)
    disposables.forEach(d => d.dispose())
  })

  it('should register keymap', async t => {
    let n = 0
    let fn = () => {
      n++
    }
    await nvim.command('nmap go <Plug>(coc-echo)')
    let disposable = workspace.registerKeymap(['n', 'v'], 'echo', fn, { sync: true })
    let { mode } = await nvim.mode
    assert.strictEqual(mode, 'n')
    await nvim.call('feedkeys', ['go', 'i'])
    await shared.waitValue(() => n, 1)
    disposable.dispose()
    await nvim.call('feedkeys', ['go', 'i'])
    await shared.wait(20)
    assert.strictEqual(n, 1)
  })

  it('should register expr keymap', async t => {
    let called = false
    let fn = () => {
      called = true
      return '""'
    }
    await nvim.input('i')
    let { mode } = await nvim.mode
    assert.strictEqual(mode, 'i')
    let disposable = workspace.registerExprKeymap('i', '"', fn)
    await shared.wait(30)
    await nvim.call('feedkeys', ['"', 't'])
    await shared.waitValue(() => called, true)
    assert.strictEqual(called, true)
    let line = await nvim.line
    assert.strictEqual(line, '""')
    disposable.dispose()
  })

  it('should register buffer expr keymap', async t => {
    let fn = () => '""'
    await nvim.input('i')
    let disposable = workspace.registerExprKeymap('i', '"', fn, true, false)
    await shared.wait(30)
    await nvim.call('feedkeys', ['"', 't'])
    await shared.waitFor('getline', ['.'], '""')
    let line = await nvim.line
    assert.strictEqual(line, '""')
    disposable.dispose()
  })

  it('should resolve dynamic insert keymaps against current state', async t => {
    let state = (value: [string, [number, number]]): [string, number] => {
      return [value[0], value[1][1]]
    }
    let option = { arglist: ['[getline("."), coc#util#cursor()]'] }
    let move = (key: '<Left>' | '<Right>') => [{ key: '<C-G>' }, { text: 'U' }, { key }]
    let mappings: Disposable[] = []
    mappings.push(workspace.registerInsertKeymap('(', () => {
      return [{ text: '()' }, ...move('<Left>')]
    }))
    mappings.push(workspace.registerInsertKeymap("'", value => {
      let [line, index] = state(value)
      return line[index] === "'" ? move('<Right>') : [{ text: "''" }, ...move('<Left>')]
    }, option))
    mappings.push(workspace.registerInsertKeymap(')', value => {
      let [line, index] = state(value)
      return line[index] === ')' ? move('<Right>') : [{ text: ')' }]
    }, option))
    mappings.push(workspace.registerInsertKeymap('[', value => {
      let [line, index] = state(value)
      return [{ text: line.slice(0, index).endsWith('a') ? '[]' : 'stale' }, ...move('<Left>')]
    }, option))
    await shared.waitValue(async () => {
      let output = await nvim.exec('imap (', true)
      return output.includes('coc#_insert_keymap')
    }, true)

    try {
      let outputs: string[] = []
      for (let i = 0; i < 20; i++) {
        await nvim.command('enew!')
        await nvim.setLine('seed')
        await nvim.command("normal O('')")
        await shared.waitValue(async () => await nvim.getLine(), "('')")
        outputs.push(await nvim.getLine())
      }
      assert.deepStrictEqual([...new Set(outputs)], ["('')"])
      await nvim.command('enew!')
      await nvim.command('normal Oa[')
      await shared.waitValue(async () => await nvim.getLine(), 'a[]')
      let local = workspace.registerInsertKeymap(']', () => [{ text: '[]' }, { key: '<Left>' }], { buffer: true })
      mappings.push(local)
      await shared.waitValue(async () => {
        let rhs = await nvim.call('maparg', [']', 'i']) as string
        return rhs.includes('coc#_insert_keymap')
      }, true)
      await nvim.command('normal O]')
      assert.strictEqual(await nvim.getLine(), '[]')
    } finally {
      disposeAll(mappings)
      await nvim.eval('1')
    }
  })

  it('should check nvim version', async t => {
    assert.strictEqual(workspace.has('patch-7.4.248'), false)
    assert.strictEqual(workspace.has('nvim-0.5.0'), true)
    assert.strictEqual(workspace.has('nvim-9.0.0'), false)
  })

  it('should registerLocalKeymap by old API', async t => {
    let called = false
    let fn = workspace.registerLocalKeymap.bind(workspace) as any
    let disposable = fn('n', 'n', () => { called = true })
    await nvim.call('feedkeys', ['n', 't'])
    await shared.waitValue(() => called, true)
    disposable.dispose()
    let res = await nvim.exec('nmap n', true)
    assert.match(res, new RegExp('No mapping found'))
  })
})

describe('workspace events', () => {

  it('should listen to fileType change', async t => {
    let buf = await shared.edit()
    await nvim.command('setf xml')
    await shared.waitValue(() => workspace.getDocument(buf.id)?.filetype, 'xml')
    let doc = workspace.getDocument(buf.id)
    assert.strictEqual(doc.filetype, 'xml')
  })

  it('should fire onDidOpenTextDocument', async t => {
    let fn = t.mock.fn()
    workspace.onDidOpenTextDocument(fn, null, disposables)
    await shared.edit()
    await shared.waitValue(() => fn.mock.calls.length, 1)
    assert.strictEqual(fn.mock.calls.length, 1)
  })

  it('should fire onDidChangeTextDocument', async t => {
    let fn = t.mock.fn()
    await shared.edit()
    workspace.onDidChangeTextDocument(fn, null, disposables)
    await nvim.setLine('foo')
    let doc = await workspace.document
    doc.forceSync()
    await shared.wait(20)
    assert.strictEqual(fn.mock.calls.length, 1)
  })

  it('should fire onDidChangeConfiguration', async t => {
    let fn = t.mock.fn()
    let disposable = workspace.onDidChangeConfiguration(e => {
      disposable.dispose()
      assert.strictEqual(e.affectsConfiguration('tsserver'), true)
      assert.strictEqual(e.affectsConfiguration('tslint'), false)
      fn()
    })
    let config = workspace.getConfiguration('tsserver')
    await config.update('enable', false)
    assert.strictEqual(fn.mock.calls.length, 1)
    await config.update('enable', undefined)
  })

  it('should resolve json schema', async t => {
    assert.notStrictEqual(workspace.resolveJSONSchema(userSettingsSchemaId), undefined)
  })

  it('should get empty configuration for none exists section', t => {
    let config = workspace.getConfiguration('notexists')
    let keys = Object.keys(config)
    assert.strictEqual(keys.length, 0)
  })

  it('should fire onWillSaveUntil', async t => {
    let doc = await workspace.document
    let filepath = URI.parse(doc.uri).fsPath
    let fn = t.mock.fn()
    let disposable = workspace.onWillSaveTextDocument(event => {
      let promise = new Promise<TextEdit[]>(resolve => {
        fn()
        let edit: TextEdit = {
          newText: 'foo',
          range: Range.create(0, 0, 0, 0)
        }
        resolve([edit])
      })
      event.waitUntil(promise)
    })
    await nvim.setLine('bar')
    await doc.synchronize()
    await events.fire('BufWritePre', [doc.bufnr, doc.bufname])
    await shared.waitValue(() => doc.getDocumentContent().startsWith('foobar'), true)
    let content = doc.getDocumentContent()
    assert.strictEqual(content.startsWith('foobar'), true)
    disposable.dispose()
    assert.strictEqual(fn.mock.calls.length, 1)
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }
  })

  it('should not work for async waitUntil', async t => {
    let doc = await shared.createDocument()
    let filepath = URI.parse(doc.uri).fsPath
    let disposable = workspace.onWillSaveTextDocument(event => {
      setTimeout(() => {
        let edit: TextEdit = {
          newText: 'foo',
          range: Range.create(0, 0, 0, 0)
        }
        event.waitUntil(Promise.resolve([edit]))
      }, 30)
    })
    await nvim.setLine('bar')
    await doc.synchronize()
    // The async waitUntil intentionally makes coc echo an error, which
    // aborts the BufWritePre RPC chain. Fire the write as a notification so
    // the expected error does not surface as a request error on this test
    // (and does not leak into the next test's BufWritePre).
    nvim.command('wa', true)
    await shared.waitValue(() => doc.getDocumentContent().includes('bar'), true)
    let content = doc.getDocumentContent()
    assert.match(content, new RegExp('bar'))
    // Wait for the async waitUntil timer to fire while vim is idle, otherwise
    // the error echo could abort a BufWritePre request of the next test.
    await shared.wait(50)
    disposable.dispose()
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }
  })

  it('should only use first returned textEdits', async t => {
    let doc = await shared.createDocument()
    let filepath = URI.parse(doc.uri).fsPath
    disposables.push(Disposable.create(() => {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath)
      }
    }))
    workspace.onWillSaveTextDocument(event => {
      event.waitUntil(Promise.resolve(undefined))
    }, null, disposables)
    workspace.onWillSaveTextDocument(event => {
      let promise = new Promise<TextEdit[]>(resolve => {
        setTimeout(() => {
          let edit: TextEdit = {
            newText: 'foo',
            range: Range.create(0, 0, 0, 0)
          }
          resolve([edit])
        }, 10)
      })
      event.waitUntil(promise)
    }, null, disposables)
    workspace.onWillSaveTextDocument(event => {
      let promise = new Promise<TextEdit[]>(resolve => {
        setTimeout(() => {
          let edit: TextEdit = {
            newText: 'bar',
            range: Range.create(0, 0, 0, 0)
          }
          resolve([edit])
        }, 30)
      })
      event.waitUntil(promise)
    }, null, disposables)
    await nvim.setLine('bar')
    await doc.synchronize()
    await nvim.command('wa')
    await shared.waitValue(() => doc.getDocumentContent().includes('foo'), true)
    let content = doc.getDocumentContent()
    assert.match(content, new RegExp('foo'))
  })

  it('should attach & detach', async t => {
    let buf = await shared.edit()
    await nvim.command('CocDisable')
    let doc = workspace.getDocument(buf.id)
    assert.strictEqual(doc, undefined)
    await nvim.command('CocEnable')
    doc = workspace.getDocument(buf.id)
    assert.strictEqual(doc.bufnr, buf.id)
  })
})

describe('workspace registerBufferSync', () => {
  it('should register', async t => {
    await shared.createDocument()
    let created = 0
    let deleted = 0
    let changed = 0
    let disposable = workspace.registerBufferSync(() => {
      created = created + 1
      return {
        dispose: () => {
          deleted += 1
        },
        onChange: () => {
          changed += 1
        }
      }
    })
    disposables.push(disposable)
    let doc = await shared.createDocument()
    assert.strictEqual(created, 2)
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo')])
    assert.strictEqual(changed, 1)
    await nvim.command('bd!')
    assert.strictEqual(deleted, 1)
  })

  it('should invoke onTextChange', async t => {
    let called = 0
    disposables.push(workspace.registerBufferSync(() => {
      return {
        dispose: () => {
        },
        onTextChange: () => {
          called = called + 1
        }
      }
    }))
    let doc = await shared.createDocument()
    await nvim.setLine('foo')
    await doc.synchronize()
    assert.strictEqual(called, 1)
  })
})
