import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { Disposable, Emitter } from 'vscode-languageserver-protocol'
import { CreateFile, DeleteFile, Location, Position, Range, RenameFile, TextDocumentEdit, TextEdit, VersionedTextDocumentIdentifier, WorkspaceEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import events from '../../events'
import { TextDocumentContentProvider } from '../../provider'
import { ConfigurationTarget } from '../../types'
import { disposeAll } from '../../util'
import { readFile } from '../../util/fs'
import window from '../../window'
import workspace from '../../workspace'
import helper, { createTmpFile } from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []

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

describe('workspace properties', () => {

  it('should have initialized', () => {
    let { nvim, rootPath, cwd, documents, initialized, textDocuments } = workspace
    expect(nvim).toBeTruthy()
    expect(initialized).toBe(true)
    expect(documents.length).toBe(1)
    expect(textDocuments.length).toBe(1)
    expect(rootPath).toBe(process.cwd())
    expect(cwd).toBe(process.cwd())
  })

  it('should add workspaceFolder', async () => {
    await helper.edit()
    let { workspaceFolders, workspaceFolder } = workspace
    expect(workspaceFolders.length).toBe(1)
    expect(workspaceFolders[0].name).toBe('coc.nvim')
    expect(workspaceFolder.name).toBe('coc.nvim')
  })

  it('should check isVim and isNvim', async () => {
    let { isVim, isNvim } = workspace
    expect(isVim).toBe(false)
    expect(isNvim).toBe(true)
  })

  it('should return plugin root', () => {
    let { pluginRoot } = workspace
    expect(typeof pluginRoot).toBe('string')
  })

  it('should ready', async () => {
    (workspace as any)._initialized = false
    let p = workspace.ready
      ; (workspace as any)._initialized = true
      ; (workspace as any)._onDidWorkspaceInitialized.fire(void 0)
    await p
  })

  it('should get filetyps', async () => {
    await helper.edit('f.js')
    let filetypes = workspace.filetypes
    expect(filetypes.has('javascript')).toBe(true)
  })
})

describe('workspace applyEdits', () => {
  it('should apply TextEdit of documentChanges', async () => {
    let doc = await helper.createDocument()
    let versioned = VersionedTextDocumentIdentifier.create(doc.uri, doc.version)
    let edit = TextEdit.insert(Position.create(0, 0), 'bar')
    let change = TextDocumentEdit.create(versioned, [edit])
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [change]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(true)
    let line = await nvim.getLine()
    expect(line).toBe('bar')
  })

  it('should not apply TextEdit if version miss match', async () => {
    let doc = await helper.createDocument()
    let versioned = VersionedTextDocumentIdentifier.create(doc.uri, 10)
    let edit = TextEdit.insert(Position.create(0, 0), 'bar')
    let change = TextDocumentEdit.create(versioned, [edit])
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [change]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(false)
  })

  it('should apply edits with changes to buffer', async () => {
    let doc = await helper.createDocument()
    let changes = {
      [doc.uri]: [TextEdit.insert(Position.create(0, 0), 'bar')]
    }
    let workspaceEdit: WorkspaceEdit = { changes }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(true)
    let line = await nvim.getLine()
    expect(line).toBe('bar')
  })

  it('should apply edits with changes to file not in buffer list', async () => {
    let filepath = await createTmpFile('bar')
    let uri = URI.file(filepath).toString()
    let changes = {
      [uri]: [TextEdit.insert(Position.create(0, 0), 'foo')]
    }
    let res = await workspace.applyEdit({ changes })
    expect(res).toBe(true)
    let doc = workspace.getDocument(uri)
    let content = doc.getDocumentContent()
    expect(content).toMatch(/^foobar/)
    await nvim.command('silent! %bwipeout!')
  })

  it('should apply edits when file not exists', async () => {
    let filepath = path.join(__dirname, 'not_exists')
    let uri = URI.file(filepath).toString()
    let changes = {
      [uri]: [TextEdit.insert(Position.create(0, 0), 'foo')]
    }
    let res = await workspace.applyEdit({ changes })
    expect(res).toBe(true)
  })

  it('should adjust cursor position after applyEdits', async () => {
    let doc = await helper.createDocument()
    let pos = await window.getCursorPosition()
    expect(pos).toEqual({ line: 0, character: 0 })
    let edit = TextEdit.insert(Position.create(0, 0), 'foo\n')
    let versioned = VersionedTextDocumentIdentifier.create(doc.uri, null)
    let documentChanges = [TextDocumentEdit.create(versioned, [edit])]
    let res = await workspace.applyEdit({ documentChanges })
    expect(res).toBe(true)
    pos = await window.getCursorPosition()
    expect(pos).toEqual({ line: 1, character: 0 })
  })

  it('should support null version of documentChanges', async () => {
    let file = path.join(__dirname, 'foo')
    await workspace.createFile(file, { ignoreIfExists: true, overwrite: true })
    let uri = URI.file(file).toString()
    let versioned = VersionedTextDocumentIdentifier.create(uri, null)
    let edit = TextEdit.insert(Position.create(0, 0), 'bar')
    let change = TextDocumentEdit.create(versioned, [edit])
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [change]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(true)
    await nvim.command('wa')
    let content = await readFile(file, 'utf8')
    expect(content).toMatch(/^bar/)
    await workspace.deleteFile(file, { ignoreIfNotExists: true })
  })

  it('should support CreateFile edit', async () => {
    let file = path.join(__dirname, 'foo')
    let uri = URI.file(file).toString()
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [CreateFile.create(uri, { overwrite: true })]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(true)
    await workspace.deleteFile(file, { ignoreIfNotExists: true })
  })

  it('should support DeleteFile edit', async () => {
    let file = path.join(__dirname, 'foo')
    await workspace.createFile(file, { ignoreIfExists: true, overwrite: true })
    let uri = URI.file(file).toString()
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [DeleteFile.create(uri)]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(true)
  })

  it('should check uri for CreateFile edit', async () => {
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [CreateFile.create('term://.', { overwrite: true })]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(false)
  })

  it('should support RenameFile edit', async () => {
    let file = path.join(__dirname, 'foo')
    await workspace.createFile(file, { ignoreIfExists: true, overwrite: true })
    let newFile = path.join(__dirname, 'bar')
    let uri = URI.file(file).toString()
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [RenameFile.create(uri, URI.file(newFile).toString())]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(true)
    await workspace.deleteFile(newFile, { ignoreIfNotExists: true })
  })

  it('should support changes with edit and rename', async () => {
    let file = await createTmpFile('test')
    let doc = await helper.createDocument(file)
    let newFile = path.join(os.tmpdir(), `coc-${process.pid}/new-${uuid()}`)
    let newUri = URI.file(newFile).toString()
    let edit: WorkspaceEdit = {
      documentChanges: [
        {
          textDocument: {
            version: null,
            uri: doc.uri,
          },
          edits: [
            {
              range: {
                start: {
                  line: 0,
                  character: 0
                },
                end: {
                  line: 0,
                  character: 4
                }
              },
              newText: 'bar'
            }
          ]
        },
        {
          oldUri: doc.uri,
          newUri,
          kind: 'rename'
        }
      ]
    }
    let res = await workspace.applyEdit(edit)
    expect(res).toBe(true)
    let curr = await workspace.document
    expect(curr.uri).toBe(newUri)
    expect(curr.getline(0)).toBe('bar')
    let line = await nvim.line
    expect(line).toBe('bar')
  })

  it('should support edit new file with CreateFile', async () => {
    let file = path.join(os.tmpdir(), 'foo')
    let uri = URI.file(file).toString()
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [
        CreateFile.create(uri, { overwrite: true }),
        TextDocumentEdit.create({ uri, version: 0 }, [
          TextEdit.insert(Position.create(0, 0), 'foo bar')
        ])
      ]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    expect(res).toBe(true)
    let doc = workspace.getDocument(uri)
    expect(doc).toBeDefined()
    let line = doc.getline(0)
    expect(line).toBe('foo bar')
    await workspace.deleteFile(file, { ignoreIfNotExists: true })
  })
})

describe('workspace methods', () => {
  it('should selected range', async () => {
    let buf = await helper.edit()
    await nvim.setLine('foobar')
    await nvim.command('normal! viw')
    await nvim.eval(`feedkeys("\\<Esc>", 'in')`)
    let doc = workspace.getDocument(buf.id)
    let range = await workspace.getSelectedRange('v', doc)
    expect(range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 6 } })
  })

  it('should get the document', async () => {
    let buf = await helper.edit()
    let doc = workspace.getDocument(buf.id)
    expect(doc.buffer.equals(buf)).toBeTruthy()
    doc = workspace.getDocument(doc.uri)
    expect(doc.buffer.equals(buf)).toBeTruthy()
  })

  it('should get format options', async () => {
    let opts = await workspace.getFormatOptions()
    expect(opts.insertSpaces).toBe(true)
    expect(opts.tabSize).toBe(2)
  })

  it('should get format options of current buffer', async () => {
    let buf = await helper.edit()
    await buf.setOption('shiftwidth', 8)
    await buf.setOption('expandtab', false)
    let doc = workspace.getDocument(buf.id)
    let opts = await workspace.getFormatOptions(doc.uri)
    expect(opts.insertSpaces).toBe(false)
    expect(opts.tabSize).toBe(8)
  })

  it('should get format options when uri not exists', async () => {
    let uri = URI.file('/tmp/foo').toString()
    let opts = await workspace.getFormatOptions(uri)
    expect(opts.insertSpaces).toBe(true)
    expect(opts.tabSize).toBe(2)
  })

  it('should get config files', async () => {
    let file = workspace.getConfigFile(ConfigurationTarget.Global)
    expect(file).toBeFalsy()
    file = workspace.getConfigFile(ConfigurationTarget.User)
    expect(file).toBeTruthy()
  })

  it('should create file watcher', async () => {
    let watcher = workspace.createFileSystemWatcher('**/*.ts')
    expect(watcher).toBeTruthy()
  })

  it('should get quickfix item from Location', async () => {
    let filepath = await createTmpFile('quickfix')
    let uri = URI.file(filepath).toString()
    let p = Position.create(0, 0)
    let loc = Location.create(uri, Range.create(p, p))
    let item = await workspace.getQuickfixItem(loc)
    expect(item.filename).toBe(filepath)
    expect(item.text).toBe('quickfix')
  })

  it('should get line of document', async () => {
    let doc = await helper.createDocument()
    await nvim.setLine('abc')
    let line = await workspace.getLine(doc.uri, 0)
    expect(line).toBe('abc')
  })

  it('should get line of file', async () => {
    let filepath = await createTmpFile('quickfix')
    let uri = URI.file(filepath).toString()
    let line = await workspace.getLine(uri, 0)
    expect(line).toBe('quickfix')
  })

  it('should read content from buffer', async () => {
    let doc = await helper.createDocument()
    await doc.applyEdits([{ range: Range.create(0, 0, 0, 0), newText: 'foo' }])
    let line = await workspace.readFile(doc.uri)
    expect(line).toBe('foo\n')
  })

  it('should read content from file', async () => {
    let filepath = await createTmpFile('content')
    let content = await workspace.readFile(URI.file(filepath).toString())
    expect(content).toBe(content)
  })

  it('should get current document', async () => {
    let buf = await helper.edit('foo')
    let doc = await workspace.document
    expect(doc.bufnr).toBe(buf.id)
    buf = await helper.edit('tmp')
    doc = await workspace.document
    expect(doc.bufnr).toBe(buf.id)
  })

  it('should expand filepath', async () => {
    let home = os.homedir()
    let res = workspace.expand('~/$NODE_ENV/')
    expect(res.startsWith(home)).toBeTruthy()
    expect(res).toContain(process.env.NODE_ENV)

    res = workspace.expand('$HOME/$NODE_ENV/')
    expect(res.startsWith(home)).toBeTruthy()
    expect(res).toContain(process.env.NODE_ENV)
  })

  it('should expand variables', async () => {
    expect(workspace.expand('${workspace}/foo')).toBe(`${workspace.root}/foo`)
    expect(workspace.expand('${env:NODE_ENV}')).toBe(process.env.NODE_ENV)
    expect(workspace.expand('${cwd}')).toBe(workspace.cwd)
    let folder = path.dirname(workspace.root)
    expect(workspace.expand('${workspaceFolderBasename}')).toBe(folder)
    await helper.edit('bar.ts')
    expect(workspace.expand('${file}')).toContain('bar')
    expect(workspace.expand('${fileDirname}')).toBe(path.dirname(__dirname))
    expect(workspace.expand('${fileExtname}')).toBe('.ts')
    expect(workspace.expand('${fileBasename}')).toBe('bar.ts')
    expect(workspace.expand('${fileBasenameNoExtension}')).toBe('bar')
  })

  it('should run command', async () => {
    let res = await workspace.runCommand('ls', __dirname, 1)
    expect(res).toMatch('workspace')
  })

  it('should resolve module path if exists', async () => {
    let res = await workspace.resolveModule('typescript')
    expect(res).toBeTruthy()
  })

  it('should not resolve module if not exists', async () => {
    let res = await workspace.resolveModule('foo')
    expect(res).toBeFalsy()
  })

  it('should return match score for document', async () => {
    let doc = await helper.createDocument('tmp.xml')
    expect(workspace.match(['xml'], doc.textDocument)).toBe(10)
    expect(workspace.match(['wxml'], doc.textDocument)).toBe(0)
    expect(workspace.match([{ language: 'xml' }], doc.textDocument)).toBe(10)
    expect(workspace.match([{ language: 'wxml' }], doc.textDocument)).toBe(0)
    expect(workspace.match([{ pattern: '**/*.xml' }], doc.textDocument)).toBe(5)
    expect(workspace.match([{ pattern: '**/*.html' }], doc.textDocument)).toBe(0)
    expect(workspace.match([{ scheme: 'file' }], doc.textDocument)).toBe(5)
    expect(workspace.match([{ scheme: 'term' }], doc.textDocument)).toBe(0)
    expect(workspace.match([{ language: 'xml' }, { scheme: 'file' }], doc.textDocument)).toBe(10)
  })

  it('should create terminal', async () => {
    let terminal = await workspace.createTerminal({ name: 'test' })
    let pid = await terminal.processId
    expect(typeof pid == 'number').toBe(true)
    terminal.dispose()
  })

  it('should rename buffer', async () => {
    await helper.createDocument('a')
    let p = workspace.renameCurrent()
    await helper.wait(30)
    await nvim.input('<backspace>b<cr>')
    await p
    let name = await nvim.eval('bufname("%")') as string
    expect(name.endsWith('b')).toBe(true)
  })

  it('should rename file', async () => {
    let cwd = await nvim.call('getcwd')
    let file = path.join(cwd, 'a')
    fs.writeFileSync(file, 'foo', 'utf8')
    await helper.createDocument('a')
    let p = workspace.renameCurrent()
    await helper.wait(30)
    await nvim.input('<backspace>b<cr>')
    await p
    let name = await nvim.eval('bufname("%")') as string
    expect(name.endsWith('b')).toBe(true)
    expect(fs.existsSync(path.join(cwd, 'b'))).toBe(true)
    fs.unlinkSync(path.join(cwd, 'b'))
  })
})

describe('workspace utility', () => {

  it('should support float', async () => {
    let floatSupported = workspace.floatSupported
    expect(floatSupported).toBe(true)
  })

  it('should loadFile', async () => {
    let doc = await helper.createDocument()
    let newFile = URI.file(path.join(__dirname, 'abc')).toString()
    let document = await workspace.loadFile(newFile)
    let bufnr = await nvim.call('bufnr', '%')
    expect(document.uri.endsWith('abc')).toBe(true)
    expect(bufnr).toBe(doc.bufnr)
  })

  it('should loadFiles', async () => {
    let files = ['a', 'b', 'c'].map(key => URI.file(path.join(__dirname, key)).toString())
    await workspace.loadFiles(files)
    for (let file of files) {
      let uri = URI.file(file).toString()
      let doc = workspace.getDocument(uri)
      expect(doc).toBeDefined()
    }
  })

  it('should not create file if document exists', async () => {
    let doc = await helper.createDocument()
    let filepath = URI.parse(doc.uri).fsPath
    await workspace.createFile(filepath, { ignoreIfExists: false })
    let exists = fs.existsSync(filepath)
    expect(exists).toBe(false)
  })

  it('should create file if parent folder not exists', async () => {
    const folder = path.join(__dirname, 'foo')
    const filepath = path.join(folder, 'bar')
    await workspace.createFile(filepath)
    const exists = fs.existsSync(filepath)
    expect(exists).toBe(true)
    fs.unlinkSync(filepath)
    fs.rmdirSync(folder)
  })

  it('should not create file if file exists with ignoreIfExists', async () => {
    let file = await createTmpFile('foo')
    await workspace.createFile(file, { ignoreIfExists: true })
    let content = fs.readFileSync(file, 'utf8')
    expect(content).toBe('foo')
  })

  it('should create file if not exists', async () => {
    await helper.edit()
    let filepath = path.join(__dirname, 'foo')
    await workspace.createFile(filepath, { ignoreIfExists: true })
    let exists = fs.existsSync(filepath)
    expect(exists).toBe(true)
    fs.unlinkSync(filepath)
  })

  it('should create folder if not exists', async () => {
    let filepath = path.join(__dirname, 'bar/')
    await workspace.createFile(filepath)
    expect(fs.existsSync(filepath)).toBe(true)
    fs.rmdirSync(filepath)
  })

  it('should not throw on folder create if overwrite is true', async () => {
    let filepath = path.join(__dirname, 'bar/')
    await workspace.createFile(filepath)
    await workspace.createFile(filepath, { overwrite: true })
    expect(fs.existsSync(filepath)).toBe(true)
    fs.rmdirSync(filepath)
  })

  it('should rename if file not exists', async () => {
    let filepath = path.join(__dirname, 'foo')
    let newPath = path.join(__dirname, 'bar')
    await workspace.createFile(filepath)
    await workspace.renameFile(filepath, newPath)
    expect(fs.existsSync(newPath)).toBe(true)
    expect(fs.existsSync(filepath)).toBe(false)
    fs.unlinkSync(newPath)
  })

  it('should rename current buffer with another buffer', async () => {
    let file = await createTmpFile('test')
    let doc = await helper.createDocument(file)
    await nvim.setLine('bar')
    await helper.wait(50)
    let newFile = path.join(os.tmpdir(), `coc-${process.pid}/new-${uuid()}`)
    await workspace.renameFile(file, newFile)
    let bufnr = await nvim.call('bufnr', ['%'])
    expect(bufnr).toBeGreaterThan(doc.bufnr)
    let line = await nvim.line
    expect(line).toBe('bar')
    let exists = fs.existsSync(newFile)
    expect(exists).toBe(true)
  })

  it('should overwrite if file exists', async () => {
    let filepath = path.join(os.tmpdir(), uuid())
    let newPath = path.join(os.tmpdir(), uuid())
    await workspace.createFile(filepath)
    await workspace.createFile(newPath)
    await workspace.renameFile(filepath, newPath, { overwrite: true })
    expect(fs.existsSync(newPath)).toBe(true)
    expect(fs.existsSync(filepath)).toBe(false)
    fs.unlinkSync(newPath)
  })

  it('should delete file if exists', async () => {
    let filepath = path.join(__dirname, 'foo')
    await workspace.createFile(filepath)
    expect(fs.existsSync(filepath)).toBe(true)
    await workspace.deleteFile(filepath)
    expect(fs.existsSync(filepath)).toBe(false)
  })

  it('should delete folder if exists', async () => {
    let filepath = path.join(__dirname, 'foo/')
    await workspace.createFile(filepath)
    expect(fs.existsSync(filepath)).toBe(true)
    await workspace.deleteFile(filepath, { recursive: true })
    expect(fs.existsSync(filepath)).toBe(false)
  })

  it('should open resource', async () => {
    let uri = URI.file(path.join(os.tmpdir(), 'bar')).toString()
    await workspace.openResource(uri)
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toMatch('bar')
  })

  it('should open none file uri', async () => {
    let uri = 'jdi://abc'
    await workspace.openResource(uri)
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toBe('jdi://abc')
  })

  it('should open opened buffer', async () => {
    let buf = await helper.edit()
    let doc = workspace.getDocument(buf.id)
    await workspace.openResource(doc.uri)
    await helper.wait(30)
    let bufnr = await nvim.call('bufnr', '%')
    expect(bufnr).toBe(buf.id)
  })

  it('should open url', async () => {
    await helper.mockFunction('coc#util#open_url', 0)
    let buf = await helper.edit()
    let uri = 'http://example.com'
    await workspace.openResource(uri)
    await helper.wait(30)
    let bufnr = await nvim.call('bufnr', '%')
    expect(bufnr).toBe(buf.id)
  })

  it('should create database', async () => {
    let db = workspace.createDatabase('test')
    let res = db.exists('xyz')
    expect(res).toBe(false)
    db.destroy()
  })

  it('should get current state', async () => {
    let buf = await helper.edit()
    await buf.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false })
    await nvim.call('cursor', [2, 2])
    let doc = workspace.getDocument(buf.id)
    let state = await workspace.getCurrentState()
    expect(doc.uri).toBe(state.document.uri)
    expect(state.position).toEqual({ line: 1, character: 1 })
  })

  it('should jumpTo position', async () => {
    let uri = URI.file('/tmp/foo').toString()
    await workspace.jumpTo(uri, { line: 1, character: 1 })
    await nvim.command('setl buftype=nofile')
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toMatch('/foo')
    await buf.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false })
    await workspace.jumpTo(uri, { line: 1, character: 1 })
    let pos = await nvim.call('getcurpos')
    expect(pos.slice(1, 3)).toEqual([2, 2])
  })

  it('should jumpTo uri without normalize', async () => {
    let uri = 'zipfile:///tmp/clojure-1.9.0.jar::clojure/core.clj'
    await workspace.jumpTo(uri)
    let buf = await nvim.buffer
    let name = await buf.name
    expect(name).toBe(uri)
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

  it('should findUp to tsconfig.json from current file', async () => {
    await helper.edit(path.join(__dirname, 'edit'))
    let filepath = await workspace.findUp('tsconfig.json')
    expect(filepath).toMatch('tsconfig.json')
  })

  it('should findUp from current file ', async () => {
    await helper.edit('foo')
    let filepath = await workspace.findUp('tsconfig.json')
    expect(filepath).toMatch('tsconfig.json')
  })

  it('should not findUp from file in other directory', async () => {
    await nvim.command(`edit ${path.join(os.tmpdir(), 'foo')}`)
    let filepath = await workspace.findUp('tsconfig.json')
    expect(filepath).toBeNull()
  })

  it('should resolveRootPath', async () => {
    let file = path.join(__dirname, 'foo')
    let uri = URI.file(file)
    let res = await workspace.resolveRootFolder(uri, ['.git'])
    expect(res).toMatch('coc.nvim')
  })

  it('should register autocmd', async () => {
    let event: any
    let eventCount = 0
    let disposables = []
    disposables.push(workspace.registerAutocmd({
      event: 'TextYankPost',
      arglist: ['v:event'],
      callback: ev => {
        eventCount += 1
        event = ev
      }
    }))
    disposables.push(workspace.registerAutocmd({
      event: ['InsertEnter', 'CursorMoved'],
      callback: () => {
        eventCount += 1
      }
    }))
    await nvim.setLine('foo')
    await helper.wait(30)
    await nvim.command('normal! yy')
    await helper.wait(30)
    await nvim.command('normal! Abar')
    await helper.wait(30)
    expect(event.regtype).toBe('V')
    expect(event.operator).toBe('y')
    expect(event.regcontents).toEqual(['foo'])
    expect(eventCount).toBeGreaterThan(2)
    disposables.forEach(d => d.dispose())
  })

  it('should regist keymap', async () => {
    let fn = jest.fn()
    await nvim.command('nmap go <Plug>(coc-echo)')
    let disposable = workspace.registerKeymap(['n', 'v'], 'echo', fn, { sync: true })
    await helper.wait(30)
    let { mode } = await nvim.mode
    expect(mode).toBe('n')
    await nvim.call('feedkeys', ['go', 'i'])
    await helper.wait(10)
    expect(fn).toBeCalledTimes(1)
    disposable.dispose()
    await nvim.call('feedkeys', ['go', 'i'])
    await helper.wait(10)
    expect(fn).toBeCalledTimes(1)
  })

  it('should regist expr keymap', async () => {
    let called = false
    let fn = () => {
      called = true
      return '""'
    }
    await nvim.input('i')
    let { mode } = await nvim.mode
    expect(mode).toBe('i')
    let disposable = workspace.registerExprKeymap('i', '"', fn)
    await helper.wait(30)
    await nvim.call('feedkeys', ['"', 't'])
    await helper.wait(30)
    expect(called).toBe(true)
    let line = await nvim.line
    expect(line).toBe('""')
    disposable.dispose()
  })

  it('should regist buffer expr keymap', async () => {
    let fn = () => '""'
    await nvim.input('i')
    let disposable = workspace.registerExprKeymap('i', '"', fn, true)
    await helper.wait(30)
    await nvim.call('feedkeys', ['"', 't'])
    await helper.wait(30)
    let line = await nvim.line
    expect(line).toBe('""')
    disposable.dispose()
  })

  it('should watch options', async () => {
    let fn = jest.fn()
    workspace.watchOption('showmode', fn, disposables)
    await helper.wait(30)
    await nvim.command('set showmode')
    await helper.wait(30)
    expect(fn).toBeCalled()
    await nvim.command('noa set noshowmode')
  })

  it('should watch global', async () => {
    let fn = jest.fn()
    workspace.watchGlobal('x', fn, disposables)
    await nvim.command('let g:x = 1')
    await helper.wait(30)
  })
})

describe('workspace events', () => {

  it('should listen to fileType change', async () => {
    let buf = await helper.edit()
    await nvim.command('setf xml')
    await helper.wait(40)
    let doc = workspace.getDocument(buf.id)
    expect(doc.filetype).toBe('xml')
  })

  it('should listen optionSet', async () => {
    let opt = workspace.completeOpt
    expect(opt).toMatch('menuone')
    await nvim.command('set completeopt=menu,preview')
    await helper.wait(50)
    opt = workspace.completeOpt
    expect(opt).toBe('menu,preview')
  })

  it('should fire onDidOpenTextDocument', async () => {
    let fn = jest.fn()
    workspace.onDidOpenTextDocument(fn, null, disposables)
    await helper.edit()
    await helper.wait(30)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should fire onDidChangeTextDocument', async () => {
    let fn = jest.fn()
    await helper.edit()
    workspace.onDidChangeTextDocument(fn, null, disposables)
    await nvim.setLine('foo')
    let doc = await workspace.document
    doc.forceSync()
    await helper.wait(20)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should fire onDidChangeConfiguration', async () => {
    await helper.createDocument()
    let fn = jest.fn()
    let disposable = workspace.onDidChangeConfiguration(e => {
      disposable.dispose()
      expect(e.affectsConfiguration('tsserver')).toBe(true)
      expect(e.affectsConfiguration('tslint')).toBe(false)
      fn()
    })
    let config = workspace.getConfiguration('tsserver')
    config.update('enable', false)
    await helper.wait(100)
    expect(fn).toHaveBeenCalledTimes(1)
    config.update('enable', undefined)
  })

  it('should get empty configuration for none exists section', () => {
    let config = workspace.getConfiguration('notexists')
    let keys = Object.keys(config)
    expect(keys.length).toBe(0)
  })

  it('should fire onWillSaveUntil', async () => {
    let doc = await helper.createDocument()
    let filepath = URI.parse(doc.uri).fsPath
    let fn = jest.fn()
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
    await helper.wait(100)
    await nvim.setLine('bar')
    await helper.wait(30)
    await events.fire('BufWritePre', [doc.bufnr])
    await helper.wait(30)
    let content = doc.getDocumentContent()
    expect(content.startsWith('foobar')).toBe(true)
    disposable.dispose()
    expect(fn).toBeCalledTimes(1)
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }
  })

  it('should not work for async waitUntil', async () => {
    let doc = await helper.createDocument()
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
    await helper.wait(30)
    await nvim.command('wa')
    let content = doc.getDocumentContent()
    expect(content).toMatch('bar')
    disposable.dispose()
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }
  })

  it('should only use first returned textEdits', async () => {
    let doc = await helper.createDocument()
    let filepath = URI.parse(doc.uri).fsPath
    let disposables: Disposable[] = []
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
    await helper.wait(30)
    await nvim.command('wa')
    let content = doc.getDocumentContent()
    expect(content).toMatch('foo')
    disposeAll(disposables)
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath)
    }
  })

  it('should attach & detach', async () => {
    let buf = await helper.edit()
    await nvim.command('CocDisable')
    await helper.wait(100)
    let doc = workspace.getDocument(buf.id)
    expect(doc).toBeUndefined()
    await nvim.command('CocEnable')
    await helper.wait(100)
    doc = workspace.getDocument(buf.id)
    expect(doc.bufnr).toBe(buf.id)
  })

  it('should create document with same bufnr', async () => {
    await nvim.command('tabe')
    let buf = await helper.edit()
    await helper.wait(100)
    let doc = workspace.getDocument(buf.id)
    expect(doc).toBeDefined()
  })
})

describe('workspace textDocument content provider', () => {

  it('should regist document content provider', async () => {
    let provider: TextDocumentContentProvider = {
      provideTextDocumentContent: (_uri, _token): string => 'sample text'
    }
    workspace.registerTextDocumentContentProvider('test', provider)
    await helper.wait(100)
    await nvim.command('edit test://1')
    let buf = await nvim.buffer
    let lines = await buf.lines
    expect(lines).toEqual(['sample text'])
  })

  it('should react onChagne event of document content provider', async () => {
    let text = 'foo'
    let emitter = new Emitter<URI>()
    let event = emitter.event
    let provider: TextDocumentContentProvider = {
      onDidChange: event,
      provideTextDocumentContent: (_uri, _token): string => text
    }
    workspace.registerTextDocumentContentProvider('jdk', provider)
    await helper.wait(80)
    await nvim.command('edit jdk://1')
    await helper.wait(100)
    text = 'bar'
    emitter.fire(URI.parse('jdk://1'))
    await helper.wait(200)
    let buf = await nvim.buffer
    let lines = await buf.lines
    expect(lines).toEqual(['bar'])
  })
})

describe('workspace registerBufferSync', () => {
  it('should regist', async () => {
    await helper.createDocument()
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
    let doc = await helper.createDocument()
    expect(created).toBe(2)
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo')])
    expect(changed).toBe(1)
    await nvim.command('bd!')
    await helper.wait(50)
    expect(deleted).toBe(1)
  })
})
