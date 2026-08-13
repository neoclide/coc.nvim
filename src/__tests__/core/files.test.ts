import * as shared from '../sharedUtil'
import commands from '../../commands'
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
    let newFile = path.join(os.tmpdir(), `coc-${process.pid}/new-${crypto.randomUUID()}`)
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
      let newFile = path.join(os.tmpdir(), `coc-${process.pid}/new-${crypto.randomUUID()}`)
      let newUri = URI.file(newFile).toString()
      let createFile = path.join(os.tmpdir(), `coc-${process.pid}/create-${crypto.randomUUID()}`)
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
  })

  describe('renameFile', () => {
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
      let newFile = path.join(os.tmpdir(), `coc-${process.pid}/new-${crypto.randomUUID()}`)
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
      let filepath = await shared.createTmpFile('file to delete')
      disposables.push(Disposable.create(() => {
        if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
      }))
      await workspace.files.loadResource(URI.file(filepath).toString())
      let fns: RecoverFunc[] = []
      await workspace.files.deleteFile(filepath, {}, fns)
      let loaded = await nvim.call('bufloaded', [filepath])
      assert.strictEqual(loaded, 0)
      for (let i = fns.length - 1; i >= 0; i--) {
        await fns[i]()
      }
      assert.strictEqual(fs.existsSync(filepath), true)
      loaded = await nvim.call('bufloaded', [filepath])
      assert.strictEqual(loaded, 1)
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

    it('should delete file if exists', async t => {
      let filepath = await shared.createTmpFile('', disposables)
      assert.strictEqual(fs.existsSync(filepath), true)
      await workspace.deleteFile(filepath)
      assert.strictEqual(fs.existsSync(filepath), false)
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
      let doc = await workspace.openTextDocument(URI.parse(`untitled:///a/b.js`))
      assert.strictEqual(doc.uri, 'file:///a/b.js')
    })

    it('should load file that exists', async t => {
      let doc = await workspace.openTextDocument(URI.file(import.meta.filename))
      assert.strictEqual(URI.parse(doc.uri).fsPath, import.meta.filename)
    })
  })
})
