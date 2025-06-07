import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuid } from 'uuid'
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
    expect(called).toBe(true)
  })
})

describe('documents', () => {
  it('should convert filetype', () => {
    const shouldConvert = (from: string, to: string): void => {
      expect(documents.convertFiletype(from)).toBe(to)
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
    expect(res.uri).toBe(doc.uri)
    let uri = 'file:///' + doc.uri.slice(8).toUpperCase()
    res = documents.getDocument(uri, true)
    expect(res.uri).toBe(doc.uri)
    res = documents.getDocument(uri, false)
    expect(res).toBeNull()
  })

  it('should resolveRoot', async () => {
    let res = documents.resolveRoot(['package.json'])
    expect(res).toBeDefined()
    expect(() => {
      documents.resolveRoot(['unexpected file'], true)
    }).toThrow(Error)
    await helper.edit(__filename)
    res = documents.resolveRoot(['package.json'])
    expect(res).toBeDefined()
  })

  it('should consider lisp option for iskeyword', async () => {
    await nvim.command(`e +setl\\ lisp t`)
    let doc = await workspace.document
    expect(doc.isWord('-')).toBe(true)
  })

  it('should get languageId', async () => {
    await helper.createDocument('t.vim')
    expect(documents.getLanguageId('/a/b')).toBe('')
    expect(documents.getLanguageId('/a/b.vim')).toBe('vim')
    expect(documents.getLanguageId('/a/b.c')).toBe('')
  })

  it('should get lines', async () => {
    let doc = await helper.createDocument('tmp')
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar')])
    let lines = await documents.getLines(doc.uri)
    expect(lines).toEqual(['foo', 'bar'])
    lines = await documents.getLines('lsptest:///1')
    expect(lines).toEqual([])
    lines = await documents.getLines('file:///not_exists_file')
    expect(lines).toEqual([])
    let uri = URI.file(__filename).toString()
    lines = await documents.getLines(uri)
    expect(lines.length).toBeGreaterThan(0)
  })

  it('should read empty string from none file', async () => {
    let res = await documents.readFile('test:///1')
    expect(res).toBe('')
  })

  it('should get empty line from none file', async () => {
    let res = await documents.getLine('test:///1', 1)
    expect(res).toBe('')
    let uri = URI.file(path.join(__dirname, 'not_exists_file')).toString()
    res = await documents.getLine(uri, 1)
    expect(res).toBe('')
  })

  it('should convert filepath', () => {
    Object.assign((documents as any)._env, { isCygwin: true, unixPrefix: '/cygdrive/' })
    let filepath = documents.fixUnixPrefix('C:\\Users\\Local')
    expect(filepath).toBe('/cygdrive/c/Users/Local')
    Object.assign((documents as any)._env, { isCygwin: false })
  })

  it('should get QuickfixItem from location link', async () => {
    let doc = await helper.createDocument('quickfix')
    let loc = LocationLink.create(doc.uri, Range.create(0, 0, 3, 0), Range.create(0, 0, 0, 3))
    let res = await documents.getQuickfixItem(loc, 'text', 'E', 'module')
    expect(res.targetRange).toBeDefined()
    expect(res.type).toBe('E')
    expect(res.module).toBe('module')
    expect(res.bufnr).toBe(doc.bufnr)
  })

  it('should create document', async () => {
    await helper.createDocument()
    let bufnrs = await nvim.call('coc#ui#open_files', [[__filename]]) as number[]
    let bufnr = bufnrs[0]
    let doc = workspace.getDocument(bufnr)
    expect(doc).toBeUndefined()
    doc = await documents.createDocument(bufnr)
    expect(doc).toBeDefined()
  })

  it('should check buffer rename on save', async () => {
    let doc = await workspace.document
    let bufnr = doc.bufnr
    let name = `${uuid()}.vim`
    let tmpfile = path.join(os.tmpdir(), name)
    await nvim.command(`write ${tmpfile}`)
    doc = workspace.getDocument(bufnr)
    expect(doc).toBeDefined()
    expect(doc.filetype).toBe('vim')
    expect(doc.bufname).toMatch(name)
    fs.unlinkSync(tmpfile)
  })

  it('should get current document', async () => {
    let p1 = workspace.document
    let p2 = workspace.document
    let arr = await Promise.all([p1, p2])
    expect(arr[0]).toBe(arr[1])
  })

  it('should get bufnrs', async () => {
    await workspace.document
    let bufnrs = Array.from(documents.bufnrs)
    expect(bufnrs.length).toBe(1)
  })

  it('should get uri', async () => {
    let doc = await workspace.document
    expect(documents.uri).toBe(doc.uri)
  })

  it('should get current uri', async () => {
    let doc = await workspace.document
    documents.detachBuffer(doc.bufnr)
    let uri = await documents.getCurrentUri()
    expect(uri).toBeUndefined()
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
    expect(await workspace.computeWordRanges('file:///1', Range.create(0, 0, 1, 0))).toBeNull()
    let doc = await workspace.document
    expect(await workspace.computeWordRanges(doc.uri, Range.create(0, 0, 1, 0))).toBeDefined()
  })

  it('should try code actions', async () => {
    helper.updateConfiguration('editor.codeActionsOnSave', { 'source.fixAll': false }, disposables)
    let doc = await workspace.document
    let res = await documents.tryCodeActionsOnSave(doc)
    expect(res).toBe(false)
    helper.updateConfiguration('editor.codeActionsOnSave', {
      'source.fixAll.eslint': true,
      'source.organizeImports': 'always'
    }, disposables)
    res = await documents.tryCodeActionsOnSave(doc)
    expect(res).toBe(true)
  })

  it('should not fire document event when filetype not changed', async () => {
    let fn = jest.fn()
    disposables.push(documents.onDidOpenTextDocument(e => {
      fn()
    }))
    let doc = await workspace.document
    doc.setFiletype('javascript')
    documents.onFileTypeChange('javascript', doc.bufnr)
    await helper.wait(10)
    expect(fn).toHaveBeenCalledTimes(0)
    doc.detach()
    documents.onFileTypeChange('javascript', doc.bufnr)
    await helper.wait(10)
    expect(fn).toHaveBeenCalledTimes(0)
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
    expect(lines).toEqual(['  a', '  b', '  c'])
  })

  it('should cancel when timeout', async () => {
    helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', ['*'], disposables)
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
    expect(Date.now() - n).toBeLessThan(1000)
    clearTimeout(timer)
  })

  it('should enable format on save', async () => {
    helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', null)
    helper.updateConfiguration('coc.preferences.formatOnSave', true)
    let doc = await workspace.document
    let res = documents.shouldFormatOnSave(doc)
    expect(res).toBe(false)
    disposables.push(languages.registerDocumentFormatProvider(['*'], {
      provideDocumentFormattingEdits: () => {
        return []
      }
    }))
    res = documents.shouldFormatOnSave(doc)
    expect(res).toBe(true)
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
    expect(lines).toEqual(['a', 'b', 'c'])
  })
})
