import * as shared from '../sharedUtil'
import commands from '../../commands'
import Files from '../../core/files'
import events from '../../events'
import { getOriginalLine, RecoverFunc } from '../../model/editInspect'
import RelativePattern from '../../model/relativePattern'
import { disposeAll } from '../../util'
import { readFile } from '../../util/fs'
import window from '../../window'
import workspace from '../../workspace'
import { Buffer, Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { CancellationTokenSource, Disposable } from 'vscode-languageserver-protocol'
import { CreateFile, DeleteFile, Position, Range, RenameFile, SnippetTextEdit, StringValue, TextDocumentEdit, TextEdit, VersionedTextDocumentIdentifier, WorkspaceEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import { TestContext } from 'node:test'


let nvim: Neovim
let disposables: Disposable[] = []
const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-files-'))

before(async () => {
  nvim = workspace.nvim
})

after(async () => {
  fs.rmSync(tmpdir, { recursive: true, force: true })
})

afterEach(async () => {
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
    assert.notStrictEqual(err, undefined)
  }

  it('should throw for invalid arguments', async t => {
    testThrow(() => {
      new RelativePattern('', undefined)
    })
    testThrow(() => {
      new RelativePattern({ uri: undefined } as any, '')
    })
  })

  it('should create relativePattern', async t => {
    for (let base of [import.meta.filename, URI.file(import.meta.filename), { uri: URI.file(import.meta.dirname).toString(), name: 'test' }]) {
      let p = new RelativePattern(base, '**/*')
      assert.strictEqual(URI.isUri(p.baseUri), true)
      assert.notStrictEqual(p.toJSON(), undefined)
    }
  })
})

describe('findFiles()', () => {
  afterEach(editorReset)

  beforeEach(() => {
    workspace.workspaceFolderControl.setWorkspaceFolders([import.meta.dirname])
  })

  it('should use glob pattern', async t => {
    let res = await workspace.findFiles('**/*.ts', undefined, 1)
    assert.ok(res.length > 0)
  })

  it('should use relativePattern', async t => {
    let relativePattern = new RelativePattern(URI.file(import.meta.dirname), '**/*.ts')
    let res = await workspace.findFiles(relativePattern)
    assert.ok(res.length > 0)
  })

  it('should respect exclude as glob pattern', async t => {
    let arr = await workspace.findFiles('**/*.ts', 'files*')
    let res = arr.find(o => path.relative(import.meta.dirname, o.fsPath).startsWith('files'))
    assert.strictEqual(res, undefined)
  })

  it('should respect exclude as relativePattern', async t => {
    let relativePattern = new RelativePattern(URI.file(import.meta.dirname), 'files*')
    let arr = await workspace.findFiles('**/*.ts', relativePattern)
    let res = arr.find(o => path.relative(import.meta.dirname, o.fsPath).startsWith('files'))
    assert.strictEqual(res, undefined)

    relativePattern = new RelativePattern(URI.file(path.join(import.meta.dirname, 'foo')), '**/*.ts')
    arr = await workspace.findFiles('**/*.ts', relativePattern, 1)
    assert.strictEqual(arr.length, 1)
  })

  it('should respect maxResults', async t => {
    let arr = await workspace.findFiles('**/*.ts', undefined, 1)
    assert.strictEqual(arr.length, 1)
  })

  it('should respect token', async t => {
    let source = new CancellationTokenSource()
    source.cancel()
    let arr = await workspace.findFiles('**/*.ts', undefined, 2, source.token)
    assert.strictEqual(arr.length, 0)
  })

  it('should cancel findFiles', async t => {
    let source = new CancellationTokenSource()
    let p = workspace.findFiles('**/*.ts', undefined, undefined, source.token)
    setTimeout(() => {
      source.cancel()
    }, 10)
    let arr = await p
    assert.notStrictEqual(arr, undefined)
  })
})

describe('applyEdits()', () => {
  afterEach(editorReset)

  it('should not throw when unable to undo & redo', async t => {
    await commands.executeCommand('workspace.undo')
    await commands.executeCommand('workspace.redo')
  })

  it('should throw for unsupported scheme', t => {
    assert.throws(() => {
      let edit = TextDocumentEdit.create({ uri: 'lsp:/1', version: 1 }, [TextEdit.insert(Position.create(0, 0), ' ')])
      workspace.files.validateChanges([edit])
    }, Error)
    assert.throws(() => {
      let edit = TextDocumentEdit.create({ uri: 'lsp:/1', version: null }, [TextEdit.insert(Position.create(0, 0), ' ')])
      workspace.files.validateChanges([edit])
    }, Error)
    let rename = RenameFile.create('lsp:/1', 'lsp:/2')
    assert.throws(() => {
      workspace.files.validateChanges([rename])
    }, Error)
  })

  it('should show error when document with version not loaded', async t => {
    let uri = 'lsptest:///file'
    let versioned = VersionedTextDocumentIdentifier.create(uri, 1)
    let edit = TextEdit.insert(Position.create(0, 0), 'bar')
    let change = TextDocumentEdit.create(versioned, [edit])
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [change]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    assert.strictEqual(res, false)
    let line = await shared.getCmdline()
    assert.match(line, new RegExp('Error'))
  })

  it('should apply TextEdit of documentChanges', async t => {
    let doc = await shared.createDocument()
    let versioned = VersionedTextDocumentIdentifier.create(doc.uri, doc.version)
    let edit = TextEdit.insert(Position.create(0, 0), 'bar')
    let change = TextDocumentEdit.create(versioned, [edit])
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [change]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    assert.strictEqual(res, true)
    let line = await nvim.getLine()
    assert.strictEqual(line, 'bar')
    await nvim.command('bd!')
    await workspace.files.undoWorkspaceEdit()
  })

  it('should apply edit with out change buffers', async t => {
    let doc = await shared.createDocument()
    await nvim.setLine('bar')
    await doc.synchronize()
    let version = doc.version
    let versioned = VersionedTextDocumentIdentifier.create(doc.uri, doc.version)
    let edit = TextEdit.replace(Range.create(0, 0, 0, 3), 'bar')
    let change = TextDocumentEdit.create(versioned, [edit])
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [change]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    assert.strictEqual(res, true)
    assert.strictEqual(doc.version, version)
  })

  it('should apply snippet edits', async t => {
    let filepath = await shared.createTmpFile('foo\nbar\n')
    let doc = await shared.createDocument(filepath)
    let versioned = VersionedTextDocumentIdentifier.create(doc.uri, doc.version)
    let edit = TextEdit.insert(Position.create(0, 0), 'before\n')
    let snippetEdit: SnippetTextEdit = { range: Range.create(2, 0, 2, 0), snippet: StringValue.createSnippet('after($1)') }
    let change = TextDocumentEdit.create(versioned, [edit, snippetEdit])
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [change]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    assert.strictEqual(res, true)
    let newLines = doc.textDocument.lines
    assert.deepStrictEqual(newLines, ['before', 'foo', 'bar', 'after()'])
    await workspace.files.undoWorkspaceEdit()
    newLines = doc.textDocument.lines
    assert.deepStrictEqual(newLines, ['foo', 'bar'])
  })

  it('should preserve literal text in mixed snippet edits', async t => {
    let filepath = await shared.createTmpFile('foo\nbar\n')
    let doc = await shared.createDocument(filepath)
    let versioned = VersionedTextDocumentIdentifier.create(doc.uri, doc.version)
    let textEdit = TextEdit.insert(Position.create(0, 0), 'echo "$1"\n')
    let snippetEdit: SnippetTextEdit = { range: Range.create(2, 0, 2, 0), snippet: StringValue.createSnippet('after($1)') }
    let change = TextDocumentEdit.create(versioned, [textEdit, snippetEdit])

    assert.strictEqual(await workspace.applyEdit({ documentChanges: [change] }), true)
    assert.deepStrictEqual(doc.textDocument.lines, ['echo "$1"', 'foo', 'bar', 'after()'])
  })

  it('should not apply TextEdit if version miss match', async t => {
    let doc = await shared.createDocument()
    let versioned = VersionedTextDocumentIdentifier.create(doc.uri, 10)
    let edit = TextEdit.insert(Position.create(0, 0), 'bar')
    let change = TextDocumentEdit.create(versioned, [edit])
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [change]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    assert.strictEqual(res, false)
  })

  it('should apply edits with changes to buffer', async t => {
    let doc = await shared.createDocument()
    let changes = {
      [doc.uri]: [TextEdit.insert(Position.create(0, 0), 'bar')]
    }
    let workspaceEdit: WorkspaceEdit = { changes }
    let res = await workspace.applyEdit(workspaceEdit)
    assert.strictEqual(res, true)
    let line = await nvim.getLine()
    assert.strictEqual(line, 'bar')
  })

  it('should apply edits with changes to file not in buffer list', async t => {
    let filepath = await shared.createTmpFile('bar')
    let uri = URI.file(filepath).toString()
    let changes = {
      [uri]: [TextEdit.insert(Position.create(0, 0), 'foo')]
    }
    let res = await workspace.applyEdit({ changes })
    assert.strictEqual(res, true)
    let doc = workspace.getDocument(uri)
    let content = doc.getDocumentContent()
    assert.match(content, /^foobar/)
    await nvim.command('silent! %bwipeout!')
  })

  it('should apply edits when file does not exist', async t => {
    let filepath = path.join(tmpdir, 'not_exists')
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
    assert.strictEqual(res, true)
  })

  it('should adjust cursor position after applyEdits', async t => {
    let doc = await shared.createDocument()
    let pos = await window.getCursorPosition()
    assert.deepStrictEqual(pos, { line: 0, character: 0 })
    let edit = TextEdit.insert(Position.create(0, 0), 'foo\n')
    let versioned = VersionedTextDocumentIdentifier.create(doc.uri, null)
    let documentChanges = [TextDocumentEdit.create(versioned, [edit])]
    let res = await workspace.applyEdit({ documentChanges })
    assert.strictEqual(res, true)
    pos = await window.getCursorPosition()
    assert.deepStrictEqual(pos, { line: 1, character: 0 })
  })

  it('should throw when waitUntil is not synchronize', async t => {
    let err
    workspace.onWillCreateFiles(e => {
      setTimeout(() => {
        try {
          e.waitUntil(Promise.resolve())
        } catch (e) {
          err = e
        }
      }, 0)
    }, null, disposables)
    let file = path.join(os.tmpdir(), crypto.randomUUID())
    await workspace.createFile(file, { overwrite: true })
    assert.notStrictEqual(err, undefined)
    fs.rmSync(file, { force: true })
  })

  it('should apply waitUntil edit within default timeout', async t => {
    let file = await shared.createTmpFile('content')
    await shared.createDocument(file)
    let newFile = path.join(os.tmpdir(), crypto.randomUUID())
    workspace.onWillCreateFiles(e => {
      e.waitUntil(Promise.resolve({
        changes: {
          [URI.file(file).toString()]: [TextEdit.insert(Position.create(0, 0), 'late-')]
        }
      }))
    }, null, disposables)
    await workspace.createFile(newFile, { overwrite: true })
    await nvim.command('wa')
    let content = await readFile(file, 'utf8')
    assert.strictEqual(content, 'late-content\n')
    fs.rmSync(newFile, { force: true })
  })

  it('should drop waitUntil edit after default timeout', async t => {
    shared.updateConfiguration('editor.fileOperationTimeout', 50, disposables)
    let file = await shared.createTmpFile('content')
    await shared.createDocument(file)
    let newFile = path.join(os.tmpdir(), crypto.randomUUID())
    let resolveEdit: (edit: WorkspaceEdit) => void
    workspace.onWillCreateFiles(e => {
      e.waitUntil(new Promise(resolve => {
        resolveEdit = resolve
      }))
    }, null, disposables)
    await workspace.createFile(newFile, { overwrite: true })
    resolveEdit({
      changes: {
        [URI.file(file).toString()]: [TextEdit.insert(Position.create(0, 0), 'late-')]
      }
    })
    await Promise.resolve()
    await nvim.command('wa')
    let content = await readFile(file, 'utf8')
    assert.strictEqual(content, 'content')
    fs.rmSync(newFile, { force: true })
  })

  it('should drop waitUntil edit after fileOperationTimeout', async t => {
    shared.updateConfiguration('editor.fileOperationTimeout', 100, disposables)
    let file = await shared.createTmpFile('content')
    await shared.createDocument(file)
    let newFile = path.join(os.tmpdir(), crypto.randomUUID())
    let resolveEdit: (edit: WorkspaceEdit) => void
    workspace.onWillCreateFiles(e => {
      e.waitUntil(new Promise(resolve => {
        resolveEdit = resolve
      }))
    }, null, disposables)
    await workspace.createFile(newFile, { overwrite: true })
    resolveEdit({
      changes: {
        [URI.file(file).toString()]: [TextEdit.insert(Position.create(0, 0), 'late-')]
      }
    })
    await Promise.resolve()
    await nvim.command('wa')
    let content = await readFile(file, 'utf8')
    assert.strictEqual(content, 'content')
    fs.rmSync(newFile, { force: true })
  })

  it('should support null version of documentChanges', async t => {
    let file = path.join(tmpdir, 'foo')
    await workspace.createFile(file, { ignoreIfExists: true, overwrite: true })
    let uri = URI.file(file).toString()
    let versioned = VersionedTextDocumentIdentifier.create(uri, null)
    let edit = TextEdit.insert(Position.create(0, 0), 'bar')
    let change = TextDocumentEdit.create(versioned, [edit])
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [change]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    assert.strictEqual(res, true)
    await nvim.command('wa')
    let content = await readFile(file, 'utf8')
    assert.match(content, /^bar/)
    await workspace.deleteFile(file, { ignoreIfNotExists: true })
  })

  it('should support CreateFile edit', async t => {
    let file = path.join(tmpdir, 'foo')
    let uri = URI.file(file).toString()
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [CreateFile.create(uri, { overwrite: true })]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    assert.strictEqual(res, true)
    await workspace.deleteFile(file, { ignoreIfNotExists: true })
  })

  it('should support DeleteFile edit', async t => {
    let file = path.join(tmpdir, 'foo')
    await workspace.createFile(file, { ignoreIfExists: true, overwrite: true })
    let uri = URI.file(file).toString()
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [DeleteFile.create(uri)]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    assert.strictEqual(res, true)
  })

  it('should check uri for CreateFile edit', async t => {
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [CreateFile.create('term://.', { overwrite: true })]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    assert.strictEqual(res, false)
  })

  it('should support RenameFile edit', async t => {
    let file = path.join(tmpdir, 'foo')
    await workspace.createFile(file, { ignoreIfExists: true, overwrite: true })
    let newFile = path.join(tmpdir, 'bar')
    let uri = URI.file(file).toString()
    let workspaceEdit: WorkspaceEdit = {
      documentChanges: [RenameFile.create(uri, URI.file(newFile).toString())]
    }
    let res = await workspace.applyEdit(workspaceEdit)
    assert.strictEqual(res, true)
    await workspace.deleteFile(newFile, { ignoreIfNotExists: true })
  })

  it('should support changes with edit and rename', async t => {
    let fsPath = await shared.createTmpFile('test')
    let doc = await shared.createDocument(fsPath)
    let newFile = path.join(tmpdir, `new-${crypto.randomUUID()}`)
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
    assert.strictEqual(res, true)
    await nvim.call('cursor', [1, 1])
    let curr = await workspace.document
    assert.strictEqual(curr.uri, newUri)
    assert.strictEqual(curr.getline(0), 'bar')
    let line = await nvim.line
    assert.strictEqual(line, 'bar')
  })

  it('should support edit new file with CreateFile', async t => {
    let file = path.join(os.tmpdir(), crypto.randomUUID())
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
    assert.strictEqual(res, true)
    let doc = workspace.getDocument(uri)
    assert.notStrictEqual(doc, undefined)
    let line = doc.getline(0)
    assert.strictEqual(line, 'foo bar')
    await workspace.deleteFile(file, { ignoreIfNotExists: true })
  })

  it('should undo and redo workspace edit', async t => {
    const folder = path.join(os.tmpdir(), crypto.randomUUID())
    const pathone = path.join(folder, 'a')
    const pathtwo = path.join(folder, 'b')
    await workspace.files.createFile(pathone, { overwrite: true })
    await workspace.files.createFile(pathtwo, { overwrite: true })
    let uris = [URI.file(pathone).toString(), URI.file(pathtwo).toString()]
    const assertContent = (one: string, two: string) => {
      let doc = workspace.getDocument(uris[0])
      assert.strictEqual(doc.getDocumentContent(), one)
      doc = workspace.getDocument(uris[1])
      assert.strictEqual(doc.getDocumentContent(), two)
    }
    let edits: TextDocumentEdit[] = []
    edits.push(TextDocumentEdit.create({ uri: uris[0], version: null }, [
      TextEdit.insert(Position.create(0, 0), 'foo')
    ]))
    edits.push(TextDocumentEdit.create({ uri: uris[1], version: null }, [
      TextEdit.insert(Position.create(0, 0), 'bar')
    ]))
    await workspace.applyEdit({ documentChanges: edits })
    assertContent('foo\n', 'bar\n')
    await workspace.files.undoWorkspaceEdit()
    assertContent('\n', '\n')
    await workspace.files.redoWorkspaceEdit()
    assertContent('foo\n', 'bar\n')
  })

  it('should undo multiple document changes for the same document', async t => {
    const file = await shared.createTmpFile('first\nsecond\n')
    const doc = await shared.createDocument(file)
    const changes = [
      TextDocumentEdit.create({ uri: doc.uri, version: null }, [
        TextEdit.insert(Position.create(0, 0), 'changed ')
      ]),
      TextDocumentEdit.create({ uri: doc.uri, version: null }, [
        TextEdit.insert(Position.create(1, 0), 'also changed ')
      ])
    ]
    assert.strictEqual(await workspace.applyEdit({ documentChanges: changes }), true)
    assert.strictEqual(doc.getDocumentContent(), 'changed first\nalso changed second\n')

    await workspace.files.undoWorkspaceEdit()

    assert.strictEqual(doc.getDocumentContent(), 'first\nsecond\n')
  })

  it('should undo nested workspace edit returned by onWillRenameFiles', async t => {
    const folder = fs.mkdtempSync(path.join(tmpdir, 'nested-undo-'))
    const oldPath = path.join(folder, 'old.ts')
    const newPath = path.join(folder, 'new.ts')
    const importPath = path.join(folder, 'index.ts')
    fs.writeFileSync(oldPath, 'export {}\n')
    fs.writeFileSync(importPath, 'import "./old"\n')
    const doc = await shared.createDocument(importPath)
    let called = 0
    workspace.onWillRenameFiles(e => {
      called++
      assert.deepStrictEqual(e.files, [{ oldUri: URI.file(oldPath), newUri: URI.file(newPath) }])
      e.waitUntil(Promise.resolve({
        changes: {
          [doc.uri]: [TextEdit.replace(Range.create(0, 0, 0, 14), 'import "./new"')]
        }
      }))
    }, null, disposables)

    assert.strictEqual(await workspace.applyEdit({
      documentChanges: [RenameFile.create(URI.file(oldPath).toString(), URI.file(newPath).toString())]
    }), true)
    assert.strictEqual(called, 1)
    assert.strictEqual(fs.existsSync(oldPath), false)
    assert.strictEqual(fs.readFileSync(newPath, 'utf8'), 'export {}\n')
    assert.deepStrictEqual(await doc.buffer.lines, ['import "./new"'])
    assert.strictEqual(doc.getline(0), 'import "./new"')

    await commands.executeCommand('workspace.undo')

    assert.strictEqual(fs.readFileSync(oldPath, 'utf8'), 'export {}\n')
    assert.strictEqual(fs.existsSync(newPath), false)
    assert.strictEqual(doc.getline(0), 'import "./old"')
    assert.deepStrictEqual(await doc.buffer.lines, ['import "./old"'])
    assert.strictEqual(called, 1)
  })

  it('should revert nested workspace edit when rename fails', async t => {
    // The expected error can open a hit-enter prompt with long Windows paths.
    t.mock.method(window, 'showErrorMessage', async () => undefined)
    const folder = fs.mkdtempSync(path.join(tmpdir, 'nested-revert-'))
    const oldPath = path.join(folder, 'old.ts')
    const newPath = path.join(folder, 'missing', 'new.ts')
    const importPath = path.join(folder, 'index.ts')
    fs.writeFileSync(oldPath, 'export {}\n')
    fs.writeFileSync(importPath, 'import "./old"\n')
    const doc = await shared.createDocument(importPath)
    workspace.onWillRenameFiles(e => {
      e.waitUntil(Promise.resolve({
        changes: {
          [doc.uri]: [TextEdit.replace(Range.create(0, 0, 0, 14), 'import "./new"')]
        }
      }))
    }, null, disposables)

    assert.strictEqual(await workspace.applyEdit({
      documentChanges: [RenameFile.create(URI.file(oldPath).toString(), URI.file(newPath).toString())]
    }), false)

    assert.strictEqual(fs.existsSync(oldPath), true)
    assert.strictEqual(fs.existsSync(newPath), false)
    assert.strictEqual(doc.getline(0), 'import "./old"')
    assert.deepStrictEqual(await doc.buffer.lines, ['import "./old"'])
  })

  it('should restore overwritten files on undo', async t => {
    let created = await shared.createTmpFile('create-original', disposables)
    let source = await shared.createTmpFile('rename-source', disposables)
    let destination = await shared.createTmpFile('rename-original', disposables)
    let edit: WorkspaceEdit = {
      documentChanges: [
        CreateFile.create(URI.file(created).toString(), { overwrite: true }),
        RenameFile.create(URI.file(source).toString(), URI.file(destination).toString(), { overwrite: true })
      ]
    }
    assert.strictEqual(await workspace.applyEdit(edit), true)
    assert.strictEqual(fs.readFileSync(created, 'utf8'), '')
    assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'rename-source')
    await workspace.files.undoWorkspaceEdit()
    assert.strictEqual(fs.readFileSync(created, 'utf8'), 'create-original')
    assert.strictEqual(fs.readFileSync(source, 'utf8'), 'rename-source')
    assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'rename-original')
  })

  it('should restore overwritten files when a later operation fails', async t => {
    let created = await shared.createTmpFile('create-original', disposables)
    let source = await shared.createTmpFile('rename-source', disposables)
    let destination = await shared.createTmpFile('rename-original', disposables)
    let missing = path.join(tmpdir, crypto.randomUUID())
    let edit: WorkspaceEdit = {
      documentChanges: [
        CreateFile.create(URI.file(created).toString(), { overwrite: true }),
        RenameFile.create(URI.file(source).toString(), URI.file(destination).toString(), { overwrite: true }),
        RenameFile.create(URI.file(missing).toString(), URI.file(`${missing}-new`).toString())
      ]
    }
    assert.strictEqual(await workspace.applyEdit(edit), false)
    assert.strictEqual(fs.readFileSync(created, 'utf8'), 'create-original')
    assert.strictEqual(fs.readFileSync(source, 'utf8'), 'rename-source')
    assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'rename-original')
  })

  it('should cleanup recovery storage when edit state is replaced', async t => {
    let first = await shared.createTmpFile('first-original', disposables)
    let second = await shared.createTmpFile('second-original', disposables)
    let firstEdit: WorkspaceEdit = {
      documentChanges: [CreateFile.create(URI.file(first).toString(), { overwrite: true })]
    }
    assert.strictEqual(await workspace.applyEdit(firstEdit), true)
    let files = workspace.files as any
    let firstState = files.editState
    let firstFolder = files.recoveryFolders.get(firstState.recovers) as string
    assert.strictEqual(fs.existsSync(firstFolder), true)

    let secondEdit: WorkspaceEdit = {
      documentChanges: [CreateFile.create(URI.file(second).toString(), { overwrite: true })]
    }
    assert.strictEqual(await workspace.applyEdit(secondEdit), true)
    assert.strictEqual(fs.existsSync(firstFolder), false)
    let secondState = files.editState
    let secondFolder = files.recoveryFolders.get(secondState.recovers) as string
    assert.strictEqual(fs.existsSync(secondFolder), true)
    await workspace.files.undoWorkspaceEdit()
    assert.strictEqual(fs.existsSync(secondFolder), false)
  })

  it('should cleanup recovery storage when files are disposed', t => {
    let files = new Files(undefined, undefined, undefined, undefined)
    let recovers: RecoverFunc[] = []
    let folder = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-edit-test-'))
    let deletedFilesFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-delete-test-'))
    fs.writeFileSync(path.join(deletedFilesFolder, 'backup'), 'deleted content')
    let internal = files as any
    internal.recoveryFolders.set(recovers, folder)
    internal.deletedFilesFolder = deletedFilesFolder
    internal.editState = { edit: {}, changes: {}, recovers, applied: true }
    files.dispose()
    assert.strictEqual(fs.existsSync(folder), false)
    assert.strictEqual(fs.existsSync(deletedFilesFolder), false)
  })

  it('should should support annotations', async t => {
    async function assertEdit(t: TestContext, confirm: boolean, description: string | undefined): Promise<void> {
      let doc = await shared.createDocument(crypto.randomUUID())
      let edit: WorkspaceEdit = {
        documentChanges: [
          {
            textDocument: { version: doc.version, uri: doc.uri },
            edits: [
              {
                range: Range.create(0, 0, 0, 0),
                newText: 'bar',
                annotationId: '85bc78e2-5ef0-4949-b10c-13f476faf430'
              }
            ]
          },
        ],
        changeAnnotations: {
          '85bc78e2-5ef0-4949-b10c-13f476faf430': {
            needsConfirmation: true,
            label: 'Text changes',
            description
          }
        }
      }
      let p = workspace.files.applyEdit(edit)
      await shared.waitPrompt()
      if (confirm) {
        await nvim.input('<cr>')
      } else {
        await nvim.input('<esc>')
      }
      await p
      let content = doc.getDocumentContent()
      if (confirm) {
        assert.strictEqual(content, 'bar\n')
      } else {
        assert.strictEqual(content, '\n')
      }
    }
    await assertEdit(t, true, 'description')
    await assertEdit(t, false, undefined)
  })
})

describe('getOriginalLine', () => {
  afterEach(editorReset)

  it('should get original line', async t => {
    let item = { index: 0, filepath: '' }
    assert.strictEqual(getOriginalLine(item, undefined), undefined)
    assert.strictEqual(getOriginalLine({ index: 0, filepath: '', lnum: 1 }, undefined), 1)
    let doc = await shared.createDocument()
    let change = {
      textDocument: { version: doc.version, uri: doc.uri },
      edits: [
        {
          range: Range.create(0, 0, 0, 0),
          newText: 'bar',
        }, {
          range: Range.create(2, 0, 2, 0),
          snippet: StringValue.createSnippet('foo')
        }
      ]
    }
    assert.strictEqual(getOriginalLine({ index: 0, filepath: '', lnum: 1 }, change), 1)
  })

  describe('inspectEdit', () => {
    async function inspect(edit: WorkspaceEdit): Promise<Buffer> {
      await workspace.applyEdit(edit)
      await commands.executeCommand('workspace.inspectEdit')
      let buf = await nvim.buffer
      return buf
    }

    it('should show warning when edit not exists', async t => {
      (workspace.files as any).editState = undefined
      await workspace.files.inspectEdit()
    })

    it('should render with changes', async t => {
      let fsPath = await shared.createTmpFile('foo\n1\n2\nbar')
      let doc = await shared.createDocument(fsPath)
      let newFile = path.join(tmpdir, `new-${crypto.randomUUID()}`)
      let newUri = URI.file(newFile).toString()
      let createFile = path.join(tmpdir, `create-${crypto.randomUUID()}`)
      let deleteFile = await shared.createTmpFile('delete')
      disposables.push(Disposable.create(() => {
        if (fs.existsSync(newFile)) fs.unlinkSync(newFile)
        if (fs.existsSync(createFile)) fs.unlinkSync(createFile)
        if (fs.existsSync(deleteFile)) fs.unlinkSync(deleteFile)
      }))
      let edit: WorkspaceEdit = {
        documentChanges: [
          {
            textDocument: { version: null, uri: doc.uri, },
            edits: [
              TextEdit.del(Range.create(0, 0, 1, 0)),
              TextEdit.replace(Range.create(3, 0, 3, 3), 'xyz'),
            ]
          },
          {
            kind: 'rename',
            oldUri: doc.uri,
            newUri
          }, {
            kind: 'create',
            uri: URI.file(createFile).toString()
          }, {
            kind: 'delete',
            uri: URI.file(deleteFile).toString()
          }
        ]
      }
      let buf = await inspect(edit)
      let lines = await buf.lines
      let content = lines.join('\n')
      assert.match(content, new RegExp('Change'))
      assert.match(content, new RegExp('Rename'))
      assert.match(content, new RegExp('Create'))
      assert.match(content, new RegExp('Delete'))
      await nvim.command('exe 5')
      await nvim.input('<CR>')
      await shared.waitFor('expand', ['%:p'], newFile)
      let line = await nvim.call('line', ['.'])
      assert.strictEqual(line, 3)
    })

    it('should render annotation label', async t => {
      let filepath = path.join(tmpdir, crypto.randomUUID())
      disposables.push(Disposable.create(() => {
        if (fs.existsSync(filepath)) {
          fs.unlinkSync(filepath)
        }
      }))
      let doc = await shared.createDocument(filepath)
      let edit: WorkspaceEdit = {
        documentChanges: [
          {
            textDocument: { version: doc.version, uri: doc.uri },
            edits: [
              {
                range: Range.create(0, 0, 0, 0),
                newText: 'bar',
                annotationId: 'dd866f37-a24c-4503-9c35-c139fb28e25b'
              }
            ]
          }, {
            textDocument: { version: 1, uri: doc.uri },
            edits: [
              {
                range: Range.create(0, 0, 0, 0),
                newText: 'bar',
                annotationId: '9468b9bf-97b6-4b37-b21f-aba8df3ce658'
              }
            ]
          }],
        changeAnnotations: {
          'dd866f37-a24c-4503-9c35-c139fb28e25b': {
            needsConfirmation: false,
            label: 'Text changes'
          }
        }
      }
      let buf = await inspect(edit)
      await events.fire('BufUnload', [buf.id + 1])
      let winid = await nvim.call('win_getid')
      let lines = await buf.lines
      assert.strictEqual(lines[0], 'Text changes')
      await nvim.command('exe 1')
      await nvim.command('wa')
      await nvim.input('<CR>')
      let bufnr = await nvim.call('bufnr', ['%'])
      assert.strictEqual(bufnr, buf.id)
      await nvim.command('exe 3')
      await nvim.input('<CR>')
      let fsPath = URI.parse(doc.uri).fsPath
      await shared.waitFor('eval', ['expand("%:p")'], fsPath)
      await nvim.call('win_gotoid', [winid])
      await nvim.input('<esc>')
      await shared.wait(20)
    })
  })

  describe('createFile()', () => {
    it('should create and revert parent folder', async t => {
      const folder = path.join(os.tmpdir(), crypto.randomUUID())
      const filepath = path.join(folder, 'a/b/bar')
      disposables.push(Disposable.create(() => {
        fs.rmSync(folder, { recursive: true, force: true })
      }))
      let fns: RecoverFunc[] = []
      assert.strictEqual(fs.existsSync(folder), false)
      await workspace.files.createFile(filepath, {}, fns)
      assert.strictEqual(fs.existsSync(filepath), true)
      for (let i = fns.length - 1; i >= 0; i--) {
        await fns[i]()
      }
      assert.strictEqual(fs.existsSync(folder), false)
    })

    it('should throw when file already exists', async t => {
      let filepath = await shared.createTmpFile('foo', disposables)
      let fn = async () => {
        await workspace.createFile(filepath, {})
      }
      await assert.rejects(fn(), Error)
    })

    it('should not create file if file exists with ignoreIfExists', async t => {
      let file = await shared.createTmpFile('foo')
      await workspace.createFile(file, { ignoreIfExists: true })
      let content = fs.readFileSync(file, 'utf8')
      assert.strictEqual(content, 'foo')
    })

    it('should create file if does not exist', async t => {
      await shared.edit()
      let filepath = path.join(tmpdir, 'foo')
      await workspace.createFile(filepath, { ignoreIfExists: true })
      let exists = fs.existsSync(filepath)
      assert.strictEqual(exists, true)
      fs.unlinkSync(filepath)
    })

    it('should revert file create', async t => {
      let filepath = path.join(os.tmpdir(), crypto.randomUUID())
      disposables.push(Disposable.create(() => {
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
      }))
      let fns: RecoverFunc[] = []
      await workspace.files.createFile(filepath, { overwrite: true }, fns)
      assert.strictEqual(fs.existsSync(filepath), true)
      let bufnr = await nvim.call('bufnr', [filepath]) as number
      assert.ok(bufnr > 0)
      let doc = workspace.getDocument(bufnr)
      assert.notStrictEqual(doc, undefined)
      for (let fn of fns) {
        await fn()
      }
      assert.strictEqual(fs.existsSync(filepath), false)
      let loaded = await nvim.call('bufloaded', [filepath])
      assert.strictEqual(loaded, 0)
    })

    it('should preserve a file created while waiting for will-create edits', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-create-race-'))
      let filepath = path.join(root, 'target')
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      let did = 0
      disposables.push(workspace.files.onWillCreateFiles(e => {
        e.waitUntil(Promise.resolve().then(() => fs.writeFileSync(filepath, 'existing')))
      }))
      disposables.push(workspace.files.onDidCreateFiles(() => did++))
      await assert.rejects(workspace.createFile(filepath), /already exists/)
      assert.strictEqual(fs.readFileSync(filepath, 'utf8'), 'existing')
      assert.strictEqual(did, 0)
    })

    it('should ignore a file created while waiting when ignoreIfExists is set', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-create-race-ignore-'))
      let filepath = path.join(root, 'target')
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      let did = 0
      disposables.push(workspace.files.onWillCreateFiles(e => {
        e.waitUntil(Promise.resolve().then(() => fs.writeFileSync(filepath, 'existing')))
      }))
      disposables.push(workspace.files.onDidCreateFiles(() => did++))
      await workspace.createFile(filepath, { ignoreIfExists: true })
      assert.strictEqual(fs.readFileSync(filepath, 'utf8'), 'existing')
      assert.strictEqual(did, 0)
    })

    it('should restore a file created while waiting when overwrite is set', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-create-race-overwrite-'))
      let filepath = path.join(root, 'target')
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      let recovers: RecoverFunc[] = []
      disposables.push(workspace.files.onWillCreateFiles(e => {
        e.waitUntil(Promise.resolve().then(() => fs.writeFileSync(filepath, 'existing')))
      }))
      await workspace.files.createFile(filepath, { overwrite: true }, recovers)
      assert.strictEqual(fs.readFileSync(filepath, 'utf8'), '')
      for (let i = recovers.length - 1; i >= 0; i--) await recovers[i]()
      assert.strictEqual(fs.readFileSync(filepath, 'utf8'), 'existing')
    })
  })

  describe('createDirectory()', () => {
    it('should create parent directories after will edits and fire did after creation', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-create-directory-'))
      let directory = path.join(root, 'a/b')
      let edited = path.join(root, 'edited')
      fs.writeFileSync(edited, 'content')
      await shared.createDocument(edited)
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      let events: string[] = []
      disposables.push(workspace.files.onWillCreateFiles(e => {
        assert.deepStrictEqual(e.files.map(uri => uri.fsPath), [directory])
        events.push('will')
        e.waitUntil(Promise.resolve({
          changes: { [URI.file(edited).toString()]: [TextEdit.insert(Position.create(0, 0), 'edited-')] }
        }))
      }))
      disposables.push(workspace.files.onDidCreateFiles(e => {
        assert.deepStrictEqual(e.files.map(uri => uri.fsPath), [directory])
        assert.strictEqual(fs.statSync(directory).isDirectory(), true)
        events.push('did')
      }))
      await workspace.createDirectory(directory)
      await nvim.command('wa')
      assert.strictEqual(fs.readFileSync(edited, 'utf8'), 'edited-content\n')
      assert.deepStrictEqual(events, ['will', 'did'])
    })

    it('should reject existing directories and dangling symbolic links before firing events', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-create-existing-'))
      let dangling = path.join(root, 'dangling')
      fs.symlinkSync(path.join(root, 'missing'), dangling)
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      let will = 0
      let did = 0
      disposables.push(workspace.files.onWillCreateFiles(() => will++))
      disposables.push(workspace.files.onDidCreateFiles(() => did++))
      await assert.rejects(workspace.createDirectory(root), /already exists/)
      await assert.rejects(workspace.createDirectory(dangling), /already exists/)
      assert.strictEqual(will, 0)
      assert.strictEqual(did, 0)
    })

    it('should preserve a directory created while waiting for will-create edits', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-create-race-'))
      let directory = path.join(root, 'target')
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      let did = 0
      disposables.push(workspace.files.onWillCreateFiles(e => {
        e.waitUntil(Promise.resolve().then(() => {
          fs.mkdirSync(directory)
          fs.writeFileSync(path.join(directory, 'existing'), 'content')
        }))
      }))
      disposables.push(workspace.files.onDidCreateFiles(() => did++))
      await assert.rejects(workspace.createDirectory(directory), /already exists/)
      assert.strictEqual(fs.readFileSync(path.join(directory, 'existing'), 'utf8'), 'content')
      assert.strictEqual(did, 0)
    })

    it('should propagate errors from a non-directory parent without firing events', { skip: process.platform === 'win32' }, async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-create-invalid-parent-'))
      let parent = path.join(root, 'file')
      fs.writeFileSync(parent, 'content')
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      let will = 0
      disposables.push(workspace.files.onWillCreateFiles(() => will++))
      await assert.rejects(workspace.createDirectory(path.join(parent, 'child')), { code: 'ENOTDIR' })
      assert.strictEqual(will, 0)
    })
  })

  describe('copyFile()', () => {
    it('should recursively copy binary files and fire did after the target tree exists', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-copy-file-'))
      let source = path.join(root, 'source')
      let target = path.join(root, 'target')
      let binary = new Uint8Array([0, 255, 1, 128])
      fs.mkdirSync(path.join(source, 'nested'), { recursive: true })
      fs.writeFileSync(path.join(source, 'nested', 'binary'), binary)
      fs.symlinkSync(path.join('nested', 'binary'), path.join(source, 'link'))
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      let events: string[] = []
      disposables.push(workspace.files.onWillCreateFiles(e => {
        assert.deepStrictEqual(e.files.map(uri => uri.fsPath), [target])
        events.push('will')
      }))
      disposables.push(workspace.files.onDidCreateFiles(e => {
        assert.deepStrictEqual(e.files.map(uri => uri.fsPath), [target])
        assert.deepStrictEqual(Array.from(fs.readFileSync(path.join(target, 'nested', 'binary'))), Array.from(binary))
        assert.strictEqual(fs.lstatSync(path.join(target, 'link')).isSymbolicLink(), true)
        events.push('did')
      }))
      await workspace.copyFile(source, target)
      assert.deepStrictEqual(events, ['will', 'did'])
      assert.strictEqual(fs.readlinkSync(path.join(target, 'link')), path.join('nested', 'binary'))
      fs.rmSync(source, { recursive: true, force: true })
      assert.deepStrictEqual(Array.from(fs.readFileSync(path.join(target, 'link'))), Array.from(binary))
    })

    it('should copy file bytes without loading the target buffer', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-copy-bytes-'))
      let source = path.join(root, 'source')
      let target = path.join(root, 'nested', 'target')
      let binary = new Uint8Array([0, 255, 1, 128])
      fs.writeFileSync(source, binary)
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      await workspace.copyFile(source, target)
      assert.deepStrictEqual(Array.from(fs.readFileSync(target)), Array.from(binary))
      assert.strictEqual(await nvim.call('bufnr', [target]), -1)
    })

    it('should copy a symbolic link without copying its target', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-copy-link-'))
      let source = path.join(root, 'source')
      let target = path.join(root, 'target')
      let linked = path.join(root, 'linked')
      fs.writeFileSync(linked, 'content')
      fs.symlinkSync(linked, source)
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      await workspace.copyFile(source, target)
      assert.strictEqual(fs.lstatSync(target).isSymbolicLink(), true)
      assert.strictEqual(fs.readlinkSync(target), linked)
    })

    it('should reject one of two concurrent copies to the same target', async () => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-copy-concurrent-'))
      let sources = [path.join(root, 'first'), path.join(root, 'second')]
      let target = path.join(root, 'target')
      for (let source of sources) fs.writeFileSync(source, path.basename(source))
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      let did = 0
      disposables.push(workspace.files.onDidCreateFiles(() => did++))
      let results = await Promise.allSettled(sources.map(source => workspace.copyFile(source, target)))
      assert.deepStrictEqual(results.map(result => result.status).sort(), ['fulfilled', 'rejected'])
      let winner = results.findIndex(result => result.status === 'fulfilled')
      assert.strictEqual(fs.readFileSync(target, 'utf8'), path.basename(sources[winner]))
      assert.strictEqual(did, 1)
    })

    it('should reject existing targets including dangling symbolic links without events', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-copy-conflict-'))
      let source = path.join(root, 'source')
      fs.writeFileSync(source, 'source')
      let existing = path.join(root, 'existing')
      let dangling = path.join(root, 'dangling')
      fs.writeFileSync(existing, 'existing')
      fs.symlinkSync(path.join(root, 'missing'), dangling)
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      let will = 0
      let did = 0
      disposables.push(workspace.files.onWillCreateFiles(() => will++))
      disposables.push(workspace.files.onDidCreateFiles(() => did++))
      await assert.rejects(workspace.copyFile(source, existing), /already exists/)
      await assert.rejects(workspace.copyFile(source, dangling), /already exists/)
      assert.strictEqual(will, 0)
      assert.strictEqual(did, 0)
    })

    it('should reject a missing source before firing events', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-copy-missing-'))
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      let will = 0
      disposables.push(workspace.files.onWillCreateFiles(() => will++))
      await assert.rejects(workspace.copyFile(path.join(root, 'missing'), path.join(root, 'target')), /not exists/)
      assert.strictEqual(will, 0)
    })

    it('should preserve a target created while waiting for will-create edits', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-copy-race-'))
      let source = path.join(root, 'source')
      let target = path.join(root, 'target')
      fs.writeFileSync(source, 'source')
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      let did = 0
      disposables.push(workspace.files.onWillCreateFiles(e => {
        e.waitUntil(Promise.resolve().then(() => fs.writeFileSync(target, 'existing')))
      }))
      disposables.push(workspace.files.onDidCreateFiles(() => did++))
      await assert.rejects(workspace.copyFile(source, target), /already exists/)
      assert.strictEqual(fs.readFileSync(target, 'utf8'), 'existing')
      assert.strictEqual(did, 0)
    })

    it('should not fire did when the source disappears before the copy', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-copy-removed-source-'))
      let source = path.join(root, 'source')
      let target = path.join(root, 'target')
      fs.writeFileSync(source, 'source')
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      let did = 0
      disposables.push(workspace.files.onWillCreateFiles(e => {
        e.waitUntil(Promise.resolve().then(() => fs.unlinkSync(source)))
      }))
      disposables.push(workspace.files.onDidCreateFiles(() => did++))
      await assert.rejects(workspace.copyFile(source, target), { code: 'ENOENT' })
      assert.strictEqual(fs.existsSync(target), false)
      assert.strictEqual(did, 0)
    })

    it('should propagate source path errors other than a missing file', { skip: process.platform === 'win32' }, async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-copy-invalid-source-'))
      let source = path.join(root, 'source')
      fs.writeFileSync(source, 'source')
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      await assert.rejects(workspace.copyFile(path.join(source, 'child'), path.join(root, 'target')), { code: 'ENOTDIR' })
    })

    it('should not fire did when copying a directory into its descendant fails', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-copy-self-'))
      let source = path.join(root, 'source')
      let target = path.join(source, 'target')
      fs.mkdirSync(source)
      fs.writeFileSync(path.join(source, 'file'), 'content')
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      let will = 0
      let did = 0
      disposables.push(workspace.files.onWillCreateFiles(() => will++))
      disposables.push(workspace.files.onDidCreateFiles(() => did++))
      await assert.rejects(workspace.copyFile(source, target), /subdirectory of self/)
      assert.strictEqual(will, 1)
      assert.strictEqual(did, 0)
    })
  })

  describe('renameFile', () => {
    async function assertTargetCreatedWhileWaiting(opts: { ignoreIfExists?: boolean }, shouldReject: boolean): Promise<void> {
      for (let loaded of [false, true]) {
        let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-rename-race-'))
        let source = path.join(root, 'source')
        let target = path.join(root, 'target')
        fs.writeFileSync(source, 'source')
        disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
        let doc = loaded ? await shared.createDocument(source) : undefined
        let did = 0
        disposables.push(workspace.files.onWillRenameFiles(e => {
          e.waitUntil(Promise.resolve().then(() => fs.writeFileSync(target, 'existing')))
        }))
        disposables.push(workspace.files.onDidRenameFiles(() => did++))
        let rename = workspace.files.renameFile(source, target, opts)
        if (shouldReject) {
          await assert.rejects(rename, /already exists/)
        } else {
          await rename
        }
        assert.strictEqual(fs.readFileSync(source, 'utf8'), 'source')
        assert.strictEqual(fs.readFileSync(target, 'utf8'), 'existing')
        assert.strictEqual(did, 0)
        if (doc) {
          assert.strictEqual(await nvim.call('bufname', [doc.bufnr]), source)
          assert.strictEqual((await doc.buffer.lines)[0], 'source')
        }
      }
    }

    it('should throw when oldPath not exists', async t => {
      await workspace.renameFile('/foo', '/foo')
      await workspace.renameFile('/foo', import.meta.filename, { ignoreIfExists: true })
      let filepath = path.join(tmpdir, 'not_exists_file')
      let newPath = path.join(tmpdir, 'bar')
      let fn = async () => {
        await workspace.renameFile(filepath, newPath)
      }
      await assert.rejects(fn(), Error)
    })

    it('should throw when new path exists and not overwrite', async t => {
      await assert.rejects(workspace.renameFile('/foo', import.meta.filename, {}), /exists/)
    })

    it('should preserve targets created while waiting without overwrite', async t => {
      await assertTargetCreatedWhileWaiting({}, true)
    })

    it('should ignore targets created while waiting when ignoreIfExists is set', async t => {
      await assertTargetCreatedWhileWaiting({ ignoreIfExists: true }, false)
    })

    it('should restore targets created while waiting when overwrite is set', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-rename-race-overwrite-'))
      let source = path.join(root, 'source')
      let target = path.join(root, 'target')
      let recovers: RecoverFunc[] = []
      fs.writeFileSync(source, 'source')
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      disposables.push(workspace.files.onWillRenameFiles(e => {
        e.waitUntil(Promise.resolve().then(() => fs.writeFileSync(target, 'existing')))
      }))
      try {
        await workspace.files.renameFile(source, target, { overwrite: true }, recovers)
        assert.strictEqual(fs.readFileSync(target, 'utf8'), 'source')
        for (let i = recovers.length - 1; i >= 0; i--) await recovers[i]()
        assert.strictEqual(fs.readFileSync(source, 'utf8'), 'source')
        assert.strictEqual(fs.readFileSync(target, 'utf8'), 'existing')
      } finally {
        let cleanupRecoveryFolder = Reflect.get(workspace.files, 'cleanupRecoveryFolder') as (recovers: RecoverFunc[]) => void
        cleanupRecoveryFolder.call(workspace.files, recovers)
      }
    })

    it('should rename file on disk', async t => {
      let filepath = await shared.createTmpFile('test')
      let newPath = path.join(path.dirname(filepath), 'new_file')
      disposables.push(Disposable.create(() => {
        if (fs.existsSync(newPath)) fs.unlinkSync(newPath)
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
      }))
      let fns: RecoverFunc[] = []
      await workspace.files.renameFile(filepath, newPath, { overwrite: true }, fns)
      assert.strictEqual(fs.existsSync(newPath), true)
      for (let fn of fns) {
        await fn()
      }
      assert.strictEqual(fs.existsSync(newPath), false)
      assert.strictEqual(fs.existsSync(filepath), true)
    })

    it('rename will/did events carry file URIs for old and new paths', async t => {
      let filepath = await shared.createTmpFile('test')
      let newPath = path.join(path.dirname(filepath), 'renamed-events.txt')
      disposables.push(Disposable.create(() => {
        if (fs.existsSync(newPath)) fs.unlinkSync(newPath)
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
      }))
      let will: any[] = []
      let did: any[] = []
      let d1 = workspace.files.onWillRenameFiles(e => will.push(...e.files))
      let d2 = workspace.files.onDidRenameFiles(e => did.push(...e.files))
      disposables.push(d1, d2)
      await workspace.files.renameFile(filepath, newPath, { overwrite: true })
      assert.strictEqual(will.length, 1)
      assert.strictEqual(will[0].oldUri.scheme, 'file')
      assert.strictEqual(will[0].oldUri.fsPath, filepath)
      assert.strictEqual(will[0].newUri.scheme, 'file')
      assert.strictEqual(will[0].newUri.fsPath, newPath)
      assert.strictEqual(did.length, 1)
      assert.strictEqual(did[0].oldUri.scheme, 'file')
      assert.strictEqual(did[0].oldUri.fsPath, filepath)
      assert.strictEqual(did[0].newUri.scheme, 'file')
      assert.strictEqual(did[0].newUri.fsPath, newPath)
    })

    it('should rename if file does not exist', async t => {
      let filepath = path.join(tmpdir, 'foo')
      let newPath = path.join(tmpdir, 'bar')
      await workspace.createFile(filepath)
      await workspace.renameFile(filepath, newPath)
      assert.strictEqual(fs.existsSync(newPath), true)
      assert.strictEqual(fs.existsSync(filepath), false)
      fs.unlinkSync(newPath)
    })

    it('should rename current buffer with same bufnr', async t => {
      let file = await shared.createTmpFile('test')
      let doc = await shared.createDocument(file)
      await nvim.setLine('bar')
      await doc.patchChange()
      let newFile = path.join(tmpdir, `new-${crypto.randomUUID()}`)
      disposables.push(Disposable.create(() => {
        if (fs.existsSync(newFile)) fs.unlinkSync(newFile)
      }))
      await workspace.renameFile(file, newFile)
      let bufnr = await nvim.call('bufnr', ['%'])
      assert.strictEqual(bufnr, doc.bufnr)
      let line = await nvim.line
      assert.strictEqual(line, 'bar')
      let exists = fs.existsSync(newFile)
      assert.strictEqual(exists, true)
    })

    it('should overwrite if file exists', async t => {
      let filepath = await shared.createTmpFile('', disposables)
      let newPath = await shared.createTmpFile('', disposables)
      await workspace.renameFile(filepath, newPath, { overwrite: true })
      assert.strictEqual(fs.existsSync(newPath), true)
      assert.strictEqual(fs.existsSync(filepath), false)
    })

    it('should rename buffer in directory and revert', async t => {
      let folder = path.join(os.tmpdir(), crypto.randomUUID())
      let newFolder = path.join(os.tmpdir(), crypto.randomUUID())
      fs.mkdirSync(folder)
      disposables.push(Disposable.create(() => {
        fs.rmSync(folder, { recursive: true, force: true })
        fs.rmSync(newFolder, { recursive: true, force: true })
      }))
      let filepath = path.join(folder, 'new_file')
      await workspace.createFile(filepath)
      let bufnr = await nvim.call('bufnr', [filepath]) as number
      assert.ok(bufnr > 0)
      let fns: RecoverFunc[] = []
      await workspace.files.renameFile(folder, newFolder, { overwrite: true }, fns)
      bufnr = await nvim.call('bufnr', [path.join(newFolder, 'new_file')]) as number
      assert.ok(bufnr > 0)
      for (let i = fns.length - 1; i >= 0; i--) {
        await fns[i]()
      }
      bufnr = await nvim.call('bufnr', [filepath]) as number
      assert.ok(bufnr > 0)
    })
  })

  describe('loadResource()', () => {
    it('should load file as hidden buffer', async t => {
      shared.updateConfiguration('workspace.openResourceCommand', '')
      let filepath = await shared.createTmpFile('foo')
      let uri = URI.file(filepath).toString()
      let doc = await workspace.files.loadResource(uri)
      let bufnrs = await nvim.call('coc#window#bufnrs') as number[]
      assert.strictEqual(bufnrs.indexOf(doc.bufnr), -1)
    })
  })

  describe('deleteFile()', () => {
    it('should throw when file not exists', async t => {
      let filepath = path.join(tmpdir, 'not_exists')
      let fn = async () => {
        await workspace.deleteFile(filepath)
      }
      await assert.rejects(fn(), Error)
    })

    it('should ignore when ignoreIfNotExists set', async t => {
      let filepath = path.join(tmpdir, 'not_exists')
      let fns: RecoverFunc[] = []
      await workspace.files.deleteFile(filepath, { ignoreIfNotExists: true }, fns)
      assert.strictEqual(fns.length, 0)
    })

    it('should unload loaded buffer', async t => {
      for (let hidden of [false, true]) {
        let filepath = await shared.createTmpFile('file to delete')
        let doc = await shared.createDocument(filepath)
        if (hidden) await nvim.command('enew')
        let fns: RecoverFunc[] = []
        let loadResource = workspace.files.loadResource.bind(workspace.files)
        let loading = t.mock.method(workspace.files, 'loadResource', async uri => {
          assert.strictEqual(fs.readFileSync(filepath, 'utf8'), 'file to delete')
          return await loadResource(uri)
        })
        try {
          await workspace.files.deleteFile(filepath, {}, fns)
          let loaded = await nvim.call('bufloaded', [filepath])
          assert.strictEqual(loaded, 0)
          for (let i = fns.length - 1; i >= 0; i--) await fns[i]()
          assert.strictEqual(loading.mock.calls.length, 1)
          assert.strictEqual(fs.existsSync(filepath), true)
          loaded = await nvim.call('bufloaded', [filepath])
          assert.strictEqual(loaded, 1)
        } finally {
          loading.mock.restore()
          let bufnr = await nvim.call('bufnr', [filepath]) as number
          if (bufnr > 0) await nvim.command(`silent! bwipeout! ${bufnr}`)
          let cleanupRecoveryFolder = Reflect.get(workspace.files, 'cleanupRecoveryFolder') as (recovers: RecoverFunc[]) => void
          cleanupRecoveryFolder.call(workspace.files, fns)
          fs.rmSync(filepath, { force: true })
        }
      }
    })

    it('should preserve current and hidden buffers when backup rename fails', async t => {
      for (let hidden of [false, true]) {
        for (let recovers of [undefined, [] as RecoverFunc[]]) {
          let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-delete-rename-failure-'))
          let filepath = path.join(root, 'file')
          let did = 0
          let unloaded: number[] = []
          fs.writeFileSync(filepath, 'source')
          let doc = await shared.createDocument(filepath)
          await nvim.setLine('dirty')
          if (hidden) await nvim.command('enew')
          let originalRenameSync = fs.renameSync.bind(fs)
          let commandSpy = t.mock.method(nvim, 'command')
          let renameSpy = t.mock.method(fs, 'renameSync', (oldPath, newPath) => {
            if (oldPath === filepath) throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' })
            originalRenameSync(oldPath, newPath)
          })
          disposables.push(workspace.files.onDidDeleteFiles(() => did++))
          disposables.push(events.on('BufUnload', bufnr => { unloaded.push(bufnr) }))
          try {
            await assert.rejects(workspace.files.deleteFile(filepath, {}, recovers), { code: 'EXDEV' })
            assert.strictEqual(fs.readFileSync(filepath, 'utf8'), 'source')
            assert.strictEqual(await nvim.call('bufloaded', [filepath]), 1)
            assert.strictEqual(await nvim.call('bufnr', [filepath]), doc.bufnr)
            assert.strictEqual((await doc.buffer.lines)[0], 'dirty')
            assert.strictEqual(unloaded.includes(doc.bufnr), false)
            assert.strictEqual(commandSpy.mock.calls.some(o => o.arguments[0].includes('bwipeout')), false)
            assert.strictEqual(did, 0)
            assert.strictEqual(recovers?.length ?? 0, 0)
          } finally {
            renameSpy.mock.restore()
            commandSpy.mock.restore()
            let bufnr = await nvim.call('bufnr', [filepath]) as number
            if (bufnr > 0) await nvim.command(`silent! bwipeout! ${bufnr}`)
            let cleanupRecoveryFolder = Reflect.get(workspace.files, 'cleanupRecoveryFolder') as (recovers: RecoverFunc[]) => void
            if (recovers) cleanupRecoveryFolder.call(workspace.files, recovers)
            let deletedFilesFolder = Reflect.get(workspace.files, 'deletedFilesFolder') as string | undefined
            if (deletedFilesFolder) fs.rmSync(deletedFilesFolder, { recursive: true, force: true })
            Reflect.set(workspace.files, 'deletedFilesFolder', undefined)
            fs.rmSync(root, { recursive: true, force: true })
          }
        }
      }
    })

    it('should preserve a loaded buffer when direct backup rename fails', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-delete-rm-failure-'))
      let filepath = path.join(root, 'file')
      let did = 0
      let unloaded: number[] = []
      fs.writeFileSync(filepath, 'source')
      let doc = await shared.createDocument(filepath)
      await nvim.setLine('dirty')
      let originalRenameSync = fs.renameSync.bind(fs)
      let commandSpy = t.mock.method(nvim, 'command')
      let renameSpy = t.mock.method(fs, 'renameSync', (oldPath, newPath) => {
        if (oldPath === filepath) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
        originalRenameSync(oldPath, newPath)
      })
      disposables.push(workspace.files.onDidDeleteFiles(() => did++))
      disposables.push(events.on('BufUnload', bufnr => { unloaded.push(bufnr) }))
      try {
        await assert.rejects(workspace.files.deleteFile(filepath), { code: 'EACCES' })
        assert.strictEqual(fs.readFileSync(filepath, 'utf8'), 'source')
        assert.strictEqual(await nvim.call('bufloaded', [filepath]), 1)
        assert.strictEqual((await doc.buffer.lines)[0], 'dirty')
        assert.strictEqual(unloaded.includes(doc.bufnr), false)
        assert.strictEqual(commandSpy.mock.calls.some(o => o.arguments[0].includes('bwipeout')), false)
        assert.strictEqual(did, 0)
      } finally {
        renameSpy.mock.restore()
        commandSpy.mock.restore()
        let bufnr = await nvim.call('bufnr', [filepath]) as number
        if (bufnr > 0) await nvim.command(`silent! bwipeout! ${bufnr}`)
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('should delete and recover folder', async t => {
      let folder = path.join(os.tmpdir(), crypto.randomUUID())
      disposables.push(Disposable.create(() => {
        if (fs.existsSync(folder)) fs.rmdirSync(folder)
      }))
      fs.mkdirSync(folder)
      assert.strictEqual(fs.existsSync(folder), true)
      let fns: RecoverFunc[] = []
      await workspace.files.deleteFile(folder, {}, fns)
      assert.strictEqual(fs.existsSync(folder), false)
      for (let i = fns.length - 1; i >= 0; i--) {
        await fns[i]()
      }
      assert.strictEqual(fs.existsSync(folder), true)
      await workspace.files.deleteFile(folder, {})
    })

    it('should delete and recover folder recursive', async t => {
      let folder = path.join(os.tmpdir(), crypto.randomUUID())
      disposables.push(Disposable.create(() => {
        fs.rmSync(folder, { recursive: true, force: true })
      }))
      fs.mkdirSync(folder)
      fs.writeFileSync(path.join(folder, 'new_file'), '', 'utf8')
      let fns: RecoverFunc[] = []
      await workspace.files.deleteFile(folder, { recursive: true }, fns)
      assert.strictEqual(fs.existsSync(folder), false)
      for (let i = fns.length - 1; i >= 0; i--) {
        await fns[i]()
      }
      assert.strictEqual(fs.existsSync(folder), true)
      assert.strictEqual(fs.existsSync(path.join(folder, 'new_file')), true)
      await workspace.files.deleteFile(folder, { recursive: true })
    })

    it('should recover repeated file deletions independently', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-delete-repeat-file-'))
      let filepath = path.join(root, 'file')
      let noRecovery = path.join(root, 'no-recovery')
      let recovers: RecoverFunc[] = []
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      let originalRenameSync = fs.renameSync.bind(fs)
      let loadResource = workspace.files.loadResource.bind(workspace.files)
      let renameSpy = t.mock.method(fs, 'renameSync', (oldPath, newPath) => {
        originalRenameSync(oldPath, newPath)
      })
      let loadSpy = t.mock.method(workspace.files, 'loadResource', async uri => {
        return await loadResource(uri)
      })
      try {
        fs.writeFileSync(filepath, 'first')
        await workspace.files.deleteFile(filepath, {}, recovers)
        let firstRecoveryCount = recovers.length
        fs.writeFileSync(filepath, 'second')
        await workspace.files.deleteFile(filepath, {}, recovers)
        fs.writeFileSync(noRecovery, 'discard')
        await workspace.files.deleteFile(noRecovery)
        assert.strictEqual(fs.existsSync(noRecovery), false)
        assert.strictEqual(renameSpy.mock.calls.length, 3)
        assert.notStrictEqual(renameSpy.mock.calls[0].arguments[1], renameSpy.mock.calls[1].arguments[1])
        let noRecoveryBackup = renameSpy.mock.calls.find(o => o.arguments[0] === noRecovery)!.arguments[1]
        assert.strictEqual(fs.readFileSync(noRecoveryBackup, 'utf8'), 'discard')
        for (let i = recovers.length - 1; i >= firstRecoveryCount; i--) {
          await recovers[i]()
        }
        assert.strictEqual(fs.readFileSync(filepath, 'utf8'), 'second')
        for (let i = firstRecoveryCount - 1; i >= 0; i--) await recovers[i]()
        assert.strictEqual(fs.readFileSync(filepath, 'utf8'), 'first')
        assert.strictEqual(loadSpy.mock.calls.length, 0)
      } finally {
        let bufnr = await nvim.call('bufnr', [filepath]) as number
        if (bufnr > 0) await nvim.command(`silent! bwipeout ${bufnr}`)
        let cleanupRecoveryFolder = Reflect.get(workspace.files, 'cleanupRecoveryFolder') as (recovers: RecoverFunc[]) => void
        cleanupRecoveryFolder.call(workspace.files, recovers)
      }
    })

    it('should retain recoverable backups of direct deletions', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-delete-direct-'))
      let filepath = path.join(root, 'file')
      let folder = path.join(root, 'folder')
      let target = path.join(root, 'target')
      let link = path.join(root, 'link')
      let destinations = new Map<string, string[]>()
      let originalRenameSync = fs.renameSync.bind(fs)
      let renameSpy = t.mock.method(fs, 'renameSync', (oldPath, newPath) => {
        let entries = destinations.get(oldPath) ?? []
        entries.push(newPath)
        destinations.set(oldPath, entries)
        originalRenameSync(oldPath, newPath)
      })
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      try {
        fs.writeFileSync(filepath, 'first')
        await workspace.deleteFile(filepath)
        fs.writeFileSync(filepath, 'second')
        await workspace.deleteFile(filepath)
        let fileBackups = destinations.get(filepath)!
        assert.strictEqual(fileBackups.length, 2)
        assert.notStrictEqual(fileBackups[0], fileBackups[1])
        fs.renameSync(fileBackups[1], filepath)
        assert.strictEqual(fs.readFileSync(filepath, 'utf8'), 'second')
        fs.rmSync(filepath)
        fs.renameSync(fileBackups[0], filepath)
        assert.strictEqual(fs.readFileSync(filepath, 'utf8'), 'first')

        fs.mkdirSync(folder)
        fs.writeFileSync(path.join(folder, 'child'), 'content')
        await workspace.deleteFile(folder, { recursive: true })
        let folderBackup = destinations.get(folder)![0]
        fs.renameSync(folderBackup, folder)
        assert.strictEqual(fs.readFileSync(path.join(folder, 'child'), 'utf8'), 'content')

        fs.writeFileSync(target, 'target')
        try {
          fs.symlinkSync('target', link, process.platform === 'win32' ? 'file' : undefined)
        } catch (_e) {
          return t.skip('symbolic links unavailable')
        }
        await workspace.deleteFile(link)
        let linkBackup = destinations.get(link)![0]
        fs.renameSync(linkBackup, link)
        assert.strictEqual(fs.lstatSync(link).isSymbolicLink(), true)
        assert.strictEqual(fs.readlinkSync(link), 'target')
        assert.strictEqual(fs.readFileSync(target, 'utf8'), 'target')
      } finally {
        renameSpy.mock.restore()
        let deletedFilesFolder = Reflect.get(workspace.files, 'deletedFilesFolder') as string | undefined
        if (deletedFilesFolder) fs.rmSync(deletedFilesFolder, { recursive: true, force: true })
        Reflect.set(workspace.files, 'deletedFilesFolder', undefined)
      }
    })

    it('should recover repeated recursive directory deletions independently', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-delete-repeat-directory-'))
      let folder = path.join(root, 'folder')
      let recovers: RecoverFunc[] = []
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      try {
        fs.mkdirSync(folder)
        fs.writeFileSync(path.join(folder, 'first'), 'first')
        await workspace.files.deleteFile(folder, { recursive: true }, recovers)
        let firstRecoveryCount = recovers.length
        fs.mkdirSync(folder)
        fs.writeFileSync(path.join(folder, 'second'), 'second')
        await workspace.files.deleteFile(folder, { recursive: true }, recovers)
        for (let i = recovers.length - 1; i >= firstRecoveryCount; i--) await recovers[i]()
        assert.strictEqual(fs.existsSync(path.join(folder, 'second')), true)
        assert.strictEqual(fs.existsSync(path.join(folder, 'first')), false)
        for (let i = firstRecoveryCount - 1; i >= 0; i--) await recovers[i]()
        assert.strictEqual(fs.existsSync(path.join(folder, 'first')), true)
        assert.strictEqual(fs.existsSync(path.join(folder, 'second')), false)
      } finally {
        let cleanupRecoveryFolder = Reflect.get(workspace.files, 'cleanupRecoveryFolder') as (recovers: RecoverFunc[]) => void
        cleanupRecoveryFolder.call(workspace.files, recovers)
      }
    })

    it('should recover repeated symbolic link deletions independently', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-delete-repeat-link-'))
      let firstTarget = path.join(root, 'first')
      let secondTarget = path.join(root, 'second')
      let link = path.join(root, 'link')
      let recovers: RecoverFunc[] = []
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      fs.writeFileSync(firstTarget, 'first')
      fs.writeFileSync(secondTarget, 'second')
      try {
        fs.symlinkSync(firstTarget, link, process.platform === 'win32' ? 'file' : undefined)
      } catch (_e) {
        return t.skip('symbolic links unavailable')
      }
      try {
        await workspace.files.deleteFile(link, {}, recovers)
        let firstRecoveryCount = recovers.length
        fs.symlinkSync(secondTarget, link, process.platform === 'win32' ? 'file' : undefined)
        await workspace.files.deleteFile(link, {}, recovers)
        for (let i = recovers.length - 1; i >= firstRecoveryCount; i--) await recovers[i]()
        assert.strictEqual(fs.lstatSync(link).isSymbolicLink(), true)
        assert.strictEqual(fs.readlinkSync(link), secondTarget)
        for (let i = firstRecoveryCount - 1; i >= 0; i--) await recovers[i]()
        assert.strictEqual(fs.lstatSync(link).isSymbolicLink(), true)
        assert.strictEqual(fs.readlinkSync(link), firstTarget)
        assert.strictEqual(fs.readFileSync(firstTarget, 'utf8'), 'first')
        assert.strictEqual(fs.readFileSync(secondTarget, 'utf8'), 'second')
        await workspace.files.deleteFile(link)
        assert.strictEqual(fs.existsSync(link), false)
        assert.strictEqual(fs.readFileSync(firstTarget, 'utf8'), 'first')
      } finally {
        let bufnr = await nvim.call('bufnr', [link]) as number
        if (bufnr > 0) await nvim.command(`silent! bwipeout ${bufnr}`)
        let cleanupRecoveryFolder = Reflect.get(workspace.files, 'cleanupRecoveryFolder') as (recovers: RecoverFunc[]) => void
        cleanupRecoveryFolder.call(workspace.files, recovers)
      }
    })

    it('should delete file if exists', async t => {
      let filepath = await shared.createTmpFile('', disposables)
      assert.strictEqual(fs.existsSync(filepath), true)
      await workspace.deleteFile(filepath)
      assert.strictEqual(fs.existsSync(filepath), false)
    })

    it('should delete symbolic links without deleting their targets', async t => {
      let root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-delete-link-'))
      let file = path.join(root, 'file')
      let folder = path.join(root, 'folder')
      let links = [path.join(root, 'file-link'), path.join(root, 'folder-link'), path.join(root, 'dangling-link')]
      fs.writeFileSync(file, 'content')
      fs.mkdirSync(folder)
      fs.writeFileSync(path.join(folder, 'child'), 'content')
      disposables.push(Disposable.create(() => fs.rmSync(root, { recursive: true, force: true })))
      try {
        fs.symlinkSync(file, links[0], process.platform === 'win32' ? 'file' : undefined)
        fs.symlinkSync(folder, links[1], process.platform === 'win32' ? 'junction' : undefined)
        fs.symlinkSync(path.join(root, 'missing'), links[2], process.platform === 'win32' ? 'file' : undefined)
      } catch (_e) {
        return t.skip('symbolic links unavailable')
      }
      let events: string[] = []
      disposables.push(workspace.files.onWillDeleteFiles(e => events.push(`will:${e.files[0].fsPath}`)))
      disposables.push(workspace.files.onDidDeleteFiles(e => events.push(`did:${e.files[0].fsPath}`)))
      let recovers: RecoverFunc[] = []
      for (let link of links) await workspace.files.deleteFile(link, {}, recovers)
      for (let link of links) assert.throws(() => fs.lstatSync(link), { code: 'ENOENT' })
      assert.strictEqual(fs.readFileSync(file, 'utf8'), 'content')
      assert.strictEqual(fs.readFileSync(path.join(folder, 'child'), 'utf8'), 'content')
      assert.deepStrictEqual(events, links.flatMap(link => [`will:${link}`, `did:${link}`]))
      for (let i = recovers.length - 1; i >= 0; i--) await recovers[i]()
      for (let link of links) assert.strictEqual(fs.lstatSync(link).isSymbolicLink(), true)
    })
  })

  describe('loadFile()', () => {
    it('should single loadFile', async t => {
      let doc = await shared.createDocument()
      let newFile = URI.file(path.join(tmpdir, 'abc')).toString()
      let document = await workspace.loadFile(newFile)
      let bufnr = await nvim.call('bufnr', '%')
      assert.strictEqual(document.uri.endsWith('abc'), true)
      assert.strictEqual(bufnr, doc.bufnr)
    })
  })

  describe('loadFiles', () => {
    it('should loadFiles', async t => {
      let files = ['a', 'b', 'c'].map(key => URI.file(path.join(tmpdir, key)).toString())
      let docs = await workspace.loadFiles(files)
      let uris = docs.map(o => o.uri)
      assert.deepStrictEqual(uris, files)
      await workspace.loadFiles([])
    })

    it('should load uri', async t => {
      let res = await workspace.loadFiles(['deno:/foo'])
      assert.strictEqual(res[0].uri, 'deno:/foo')
    })
  })

  describe('openTextDocument()', () => {
    it('should open document already exists', async t => {
      let doc = await shared.createDocument('a')
      await nvim.command('enew')
      await workspace.openTextDocument(URI.parse(doc.uri))
      let curr = await workspace.document
      assert.strictEqual(curr.uri != doc.uri, true)
    })

    it('should throw when file does not exist', async t => {
      await assert.rejects(workspace.openTextDocument('/a/b/c'), Error)
    })

    it('should open untitled document', async t => {
      let uri = URI.file(path.resolve('/a/b.js'))
      let doc = await workspace.openTextDocument(uri.with({ scheme: 'untitled' }))
      assert.strictEqual(doc.uri, uri.toString())
    })

    it('should load file that exists', async t => {
      let doc = await workspace.openTextDocument(URI.file(import.meta.filename))
      assert.strictEqual(URI.parse(doc.uri).fsPath, URI.file(import.meta.filename).fsPath)
    })
  })
})
