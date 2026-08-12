import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Disposable } from 'vscode-languageserver-protocol'
import { LocationLink, Position, Range, TextEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import Documents from '../../core/documents'
import events from '../../events'
import languages from '../../languages'
import BufferSync from '../../model/bufferSync'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import helper, { createTmpFile } from '../helper'

let documents: Documents
let nvim: Neovim
let disposables: Disposable[] = []

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  documents = workspace.documentsManager
})

afterEach(async () => {
  disposeAll(disposables)
  await helper.reset()
})

afterAll(async () => {
  await helper.shutdown()
})

describe('BufferSync', () => {
  it('should recreate document', async () => {
    let doc = documents.getDocument(documents.bufnr)
    let called = false
    let sync = new BufferSync(doc => {
      return {
        bufnr: doc.bufnr,
        dispose: () => {
          called = true
        }
      }
    }, documents)
    sync.create(doc)
    assert.strictEqual(called, true)
  })
})

describe('documents', () => {
  it('should convert filetype', () => {
    const shouldConvert = (from: string, to: string): void => {
      assert.strictEqual(documents.convertFiletype(from), to)
    }
    shouldConvert('javascript.jsx', 'javascriptreact')
    shouldConvert('typescript.jsx', 'typescriptreact')
    shouldConvert('typescript.tsx', 'typescriptreact')
    shouldConvert('tex', 'latex')
    Object.assign(documents['_env']['filetypeMap'], { foo: 'bar' })
    shouldConvert('foo', 'bar')
  })

  it('should get document', async () => {
    await helper.createDocument('bar')
    let doc = await helper.createDocument('foo')
    let res = documents.getDocument(doc.uri)
    assert.strictEqual(res.uri, doc.uri)
    let uri = 'file:///' + doc.uri.slice(8).toUpperCase()
    res = documents.getDocument(uri, true)
    assert.strictEqual(res.uri, doc.uri)
    res = documents.getDocument(uri, false)
    assert.strictEqual(res, null)
  })

  it('should resolveRoot', async () => {
    let res = documents.resolveRoot(['package.json'])
    assert.notStrictEqual(res, undefined)
    assert.throws(() => {
      documents.resolveRoot(['unexpected file'], true)
    }, Error)
    await helper.edit(__filename)
    res = documents.resolveRoot(['package.json'])
    assert.notStrictEqual(res, undefined)
  })

  it('should consider lisp option for iskeyword', async () => {
    await nvim.command(`e +setl\\ lisp t`)
    let doc = await workspace.document
    assert.strictEqual(doc.isWord('-'), true)
  })

  it('should get languageId', async () => {
    await helper.createDocument('t.vim')
    assert.strictEqual(documents.getLanguageId('/a/b'), '')
    assert.strictEqual(documents.getLanguageId('/a/b.vim'), 'vim')
    assert.strictEqual(documents.getLanguageId('/a/b.c'), '')
  })

  it('should get lines', async () => {
    let doc = await helper.createDocument('tmp')
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar')])
    let lines = await documents.getLines(doc.uri)
    assert.deepStrictEqual(lines, ['foo', 'bar'])
    lines = await documents.getLines('lsptest:///1')
    assert.deepStrictEqual(lines, [])
    lines = await documents.getLines('file:///not_exists_file')
    assert.deepStrictEqual(lines, [])
    let uri = URI.file(__filename).toString()
    lines = await documents.getLines(uri)
    assert.ok((lines.length) > (0))
  })

  it('should read empty string from none file', async () => {
    let res = await documents.readFile('test:///1')
    assert.strictEqual(res, '')
  })

  it('should get empty line from none file', async () => {
    let res = await documents.getLine('test:///1', 1)
    assert.strictEqual(res, '')
    let uri = URI.file(path.join(__dirname, 'not_exists_file')).toString()
    res = await documents.getLine(uri, 1)
    assert.strictEqual(res, '')
  })

  it('should convert filepath', () => {
    Object.assign((documents as any)._env, { isCygwin: true, unixPrefix: '/cygdrive/' })
    let filepath = documents.fixUnixPrefix('C:\\Users\\Local')
    assert.strictEqual(filepath, '/cygdrive/c/Users/Local')
    Object.assign((documents as any)._env, { isCygwin: false })
  })

  it('should get QuickfixItem from location link', async () => {
    let doc = await helper.createDocument('quickfix')
    let loc = LocationLink.create(doc.uri, Range.create(0, 0, 3, 0), Range.create(0, 0, 0, 3))
    let res = await documents.getQuickfixItem(loc, 'text', 'E', 'module')
    assert.notStrictEqual(res.targetRange, undefined)
    assert.strictEqual(res.type, 'E')
    assert.strictEqual(res.module, 'module')
    assert.strictEqual(res.bufnr, doc.bufnr)
  })

  it('should create document', async () => {
    await helper.createDocument()
    let bufnrs = await nvim.call('coc#ui#open_files', [[__filename]]) as number[]
    let bufnr = bufnrs[0]
    let doc = workspace.getDocument(bufnr)
    assert.strictEqual(doc, undefined)
    doc = await documents.createDocument(bufnr)
    assert.notStrictEqual(doc, undefined)
  })

  it('should check buffer rename on save', async () => {
    let doc = await workspace.document
    let bufnr = doc.bufnr
    let name = `${crypto.randomUUID()}.vim`
    let tmpfile = path.join(os.tmpdir(), name)
    await nvim.command(`write ${tmpfile}`)
    doc = workspace.getDocument(bufnr)
    assert.notStrictEqual(doc, undefined)
    assert.strictEqual(doc.filetype, 'vim')
    assert.ok((doc.bufname).includes(name))
    fs.unlinkSync(tmpfile)
  })

  it('should get current document', async () => {
    let p1 = workspace.document
    let p2 = workspace.document
    let arr = await Promise.all([p1, p2])
    assert.strictEqual(arr[0], arr[1])
  })

  it('should get bufnrs', async () => {
    await workspace.document
    let bufnrs = Array.from(documents.bufnrs)
    assert.strictEqual(bufnrs.length, 1)
  })

  it('should get uri', async () => {
    let doc = await workspace.document
    assert.strictEqual(documents.uri, doc.uri)
  })

  it('should get current uri', async () => {
    let doc = await workspace.document
    documents.detachBuffer(doc.bufnr)
    let uri = await documents.getCurrentUri()
    assert.strictEqual(uri, undefined)
  })

  it('should attach events on vim', async () => {
    await documents.attach(nvim, workspace.env)
    let env = Object.assign(workspace.env, { isVim: true })
    documents.detach()
    await documents.attach(nvim, env)
    documents.detach()
    await events.fire('CursorMoved', [1, [1, 1]])
  })

  it('should compute word ranges', async () => {
    assert.strictEqual(await workspace.computeWordRanges('file:///1', Range.create(0, 0, 1, 0)), null)
    let doc = await workspace.document
    assert.notStrictEqual(await workspace.computeWordRanges(doc.uri, Range.create(0, 0, 1, 0)), undefined)
  })

  it('should try code actions', async () => {
    helper.updateConfiguration('editor.codeActionsOnSave', { 'source.fixAll': false }, disposables)
    let doc = await workspace.document
    let res = await documents.tryCodeActionsOnSave(doc)
    assert.strictEqual(res, false)
    helper.updateConfiguration('editor.codeActionsOnSave', {
      'source.fixAll.eslint': true,
      'source.organizeImports': 'always'
    }, disposables)
    res = await documents.tryCodeActionsOnSave(doc)
    assert.strictEqual(res, true)
  })

  it('should not fire document event when filetype not changed', async (t) => {
    let fn = t.mock.fn()
    disposables.push(documents.onDidOpenTextDocument(e => {
      fn()
    }))
    let doc = await workspace.document
    doc.setFiletype('javascript')
    documents.onFileTypeChange('javascript', doc.bufnr)
    await helper.wait(20)
    assert.strictEqual((fn).mock.callCount(), 0)
    doc.detach()
    documents.onFileTypeChange('javascript', doc.bufnr)
    await helper.wait(20)
    assert.strictEqual((fn).mock.callCount(), 0)
  })

  it('should fire document create once on reload', async () => {
    await helper.createDocument('t.vim')
    let called = false
    disposables.push(documents.onDidOpenTextDocument(e => {
      called = true
    }))
    await nvim.command('edit')
    await helper.waitValue(() => called, true)
  })
})

describe('formatOnSave', () => {
  it('should not throw when provider not found', async () => {
    helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', ['javascript'], disposables)
    let filepath = await createTmpFile('')
    await helper.edit(filepath)
    await nvim.command('setf javascript')
    await nvim.setLine('foo')
    await nvim.command('silent w')
  })

  it('should invoke format on save', async () => {
    helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', ['text'], disposables)
    disposables.push(languages.registerDocumentFormatProvider(['text'], {
      provideDocumentFormattingEdits: document => {
        let lines = document.getText().replace(/\n$/, '').split(/\n/)
        let edits: TextEdit[] = []
        for (let i = 0; i < lines.length; i++) {
          let text = lines[i]
          if (!text.startsWith(' ')) {
            edits.push(TextEdit.insert(Position.create(i, 0), '  '))
          }
        }
        return edits
      }
    }))
    let filepath = await createTmpFile('a\nb\nc\n')
    let buf = await helper.edit(filepath)
    let doc = workspace.getDocument(buf.id)
    doc.setFiletype('text')
    await documents.tryFormatOnSave(doc)
    let lines = await buf.lines
    assert.deepStrictEqual(lines, ['  a', '  b', '  c'])
  })

  it('should cancel when timeout', async () => {
    helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', ['*'], disposables)
    helper.updateConfiguration('coc.preferences.formatOnSaveTimeout', 100, disposables)
    let timer
    disposables.push(languages.registerDocumentFormatProvider(['*'], {
      provideDocumentFormattingEdits: () => {
        return new Promise(resolve => {
          timer = setTimeout(() => {
            resolve(undefined)
          }, 2000)
        })
      }
    }))
    let filepath = await createTmpFile('a\nb\nc\n')
    await helper.edit(filepath)
    let n = Date.now()
    await nvim.command('w')
    assert.ok((Date.now() - n) < (1000))
    clearTimeout(timer)
  })

  it('should enable format on save', async () => {
    helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', null)
    let doc = await workspace.document

    helper.updateConfiguration('coc.preferences.formatOnSave', false)
    let res = documents.shouldFormatOnSave(doc)
    assert.strictEqual(res, false)

    helper.updateConfiguration('coc.preferences.formatOnSave', true)
    res = documents.shouldFormatOnSave(doc)
    assert.strictEqual(res, false)

    helper.updateConfiguration('coc.preferences.formatOnSave', false)
    disposables.push(languages.registerDocumentFormatProvider(['*'], {
      provideDocumentFormattingEdits: () => {
        return []
      }
    }))
    res = documents.shouldFormatOnSave(doc)
    assert.strictEqual(res, false)

    helper.updateConfiguration('coc.preferences.formatOnSave', true)
    res = documents.shouldFormatOnSave(doc)
    assert.strictEqual(res, true)
  })

  it('should prefer formatOnSaveFiletypes over formatOnSave', async () => {
    let doc = await workspace.document
    doc.setFiletype('text')
    disposables.push(languages.registerDocumentFormatProvider(['text'], {
      provideDocumentFormattingEdits: () => []
    }))

    helper.updateConfiguration('coc.preferences.formatOnSave', true, disposables)
    helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', ['javascript'], disposables)
    assert.strictEqual(documents.shouldFormatOnSave(doc), false)

    helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', [], disposables)
    assert.strictEqual(documents.shouldFormatOnSave(doc), false)

    helper.updateConfiguration('coc.preferences.formatOnSave', false, disposables)
    helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', ['text'], disposables)
    assert.strictEqual(documents.shouldFormatOnSave(doc), true)
  })

  it('should ignore non-array formatOnSaveFiletypes', async () => {
    helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', 'text', disposables)
    let doc = await workspace.document
    doc.setFiletype('text')
    assert.strictEqual(documents.shouldFormatOnSave(doc), false)

    helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', 123, disposables)
    assert.strictEqual(documents.shouldFormatOnSave(doc), false)
  })

  it('should not format on save when disabled', async () => {
    helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', ['text'])
    disposables.push(languages.registerDocumentFormatProvider(['text'], {
      provideDocumentFormattingEdits: document => {
        let lines = document.getText().replace(/\n$/, '').split(/\n/)
        let edits: TextEdit[] = []
        for (let i = 0; i < lines.length; i++) {
          edits.push(TextEdit.insert(Position.create(0, 0), '  '))
        }
        return edits
      }
    }))
    let filepath = await createTmpFile('a\nb\nc\n')
    nvim.pauseNotification()
    nvim.command('e ' + filepath, true)
    nvim.command('let b:coc_disable_autoformat = 1', true)
    nvim.command('setf text', true)
    await nvim.resumeNotification()
    await nvim.command('w')
    let buf = await nvim.buffer
    let lines = await buf.lines
    assert.deepStrictEqual(lines, ['a', 'b', 'c'])
  })
})
