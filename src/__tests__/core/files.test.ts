import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { Disposable, CancellationTokenSource } from 'vscode-languageserver-protocol'
import { CreateFile, DeleteFile, Position, RenameFile, TextDocumentEdit, TextEdit, VersionedTextDocumentIdentifier, WorkspaceEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import RelativePattern from '../../model/relativePattern'
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

describe('RelativePattern', () => {
  function testThrow(fn: () => void) {
    let err
    try {
      fn()
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  }

  it('should throw for invalid arguments', async () => {
    testThrow(() => {
      new RelativePattern('', undefined)
    })
    testThrow(() => {
      new RelativePattern({ uri: undefined } as any, '')
    })
  })

  it('should create relativePattern', async () => {
    for (let base of [__filename, URI.file(__filename), { uri: URI.file(__dirname).toString(), name: 'test' }]) {
      let p = new RelativePattern(base, '**/*')
      expect(URI.isUri(p.baseUri)).toBe(true)
      expect(p.toJSON()).toBeDefined()
    }
  })
})

describe('findFiles()', () => {
  beforeEach(() => {
    workspace.workspaceFolderControl.setWorkspaceFolders([__dirname])
  })

  it('should use glob pattern', async () => {
    let res = await workspace.findFiles('**/*.ts')
    expect(res.length).toBeGreaterThan(0)
  })

  it('should use relativePattern', async () => {
    let relativePattern = new RelativePattern(URI.file(__dirname), '**/*.ts')
    let res = await workspace.findFiles(relativePattern)
    expect(res.length).toBeGreaterThan(0)
  })

  it('should respect exclude as glob pattern', async () => {
    let arr = await workspace.findFiles('**/*.ts', 'files*')
    let res = arr.find(o => path.relative(__dirname, o.fsPath).startsWith('files'))
    expect(res).toBeUndefined()
  })

  it('should respect exclude as relativePattern', async () => {
    let relativePattern = new RelativePattern(URI.file(__dirname), 'files*')
    let arr = await workspace.findFiles('**/*.ts', relativePattern)
    let res = arr.find(o => path.relative(__dirname, o.fsPath).startsWith('files'))
    expect(res).toBeUndefined()
  })

  it('should respect maxResults', async () => {
    let arr = await workspace.findFiles('**/*.ts', undefined, 1)
    expect(arr.length).toBe(1)
  })

  it('should respect token', async () => {
    let source = new CancellationTokenSource()
    source.cancel()
    let arr = await workspace.findFiles('**/*.ts', undefined, 1, source.token)
    expect(arr.length).toBe(0)
  })

  it('should cancel findFiles', async () => {
    let source = new CancellationTokenSource()
    let p = workspace.findFiles('**/*.ts', undefined, 1, source.token)
    source.cancel()
    let arr = await p
    expect(arr.length).toBe(0)
  })
})

describe('applyEdits()', () => {
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
    disposables.push({
      dispose: () => {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath)
        }
      }
    })
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

describe('createFile()', () => {
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
})

describe('renameFile', () => {
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
})

describe('deleteFile()', () => {
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
})

describe('loadFile()', () => {
  it('should single loadFile', async () => {
    let doc = await helper.createDocument()
    let newFile = URI.file(path.join(__dirname, 'abc')).toString()
    let document = await workspace.loadFile(newFile)
    let bufnr = await nvim.call('bufnr', '%')
    expect(document.uri.endsWith('abc')).toBe(true)
    expect(bufnr).toBe(doc.bufnr)
  })
})

describe('loadFiles', () => {
  it('should loadFiles', async () => {
    let files = ['a', 'b', 'c'].map(key => URI.file(path.join(__dirname, key)).toString())
    let docs = await workspace.loadFiles(files)
    let uris = docs.map(o => o.uri)
    expect(uris).toEqual(files)
  })

  it('should load empty files array', async () => {
    await workspace.loadFiles([])
  })
})

describe('openTextDocument()', () => {
  it('should open document already exists', async () => {
    let doc = await helper.createDocument('a')
    await nvim.command('enew')
    await workspace.openTextDocument(URI.parse(doc.uri))
    let curr = await workspace.document
    expect(curr.uri).toBe(doc.uri)
  })

  it('should throw when file not exists', async () => {
    let err
    try {
      await workspace.openTextDocument('/a/b/c')
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })

  it('should open untitled document', async () => {
    let doc = await workspace.openTextDocument(URI.parse(`untitled:///a/b.js`))
    expect(doc.uri).toBe('file:///a/b.js')
  })

  it('should load file that exists', async () => {
    let doc = await workspace.openTextDocument(URI.file(__filename))
    expect(URI.parse(doc.uri).fsPath).toBe(__filename)
    let curr = await workspace.document
    expect(curr.uri).toBe(doc.uri)
  })
})
