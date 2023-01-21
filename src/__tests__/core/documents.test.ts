import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { LocationLink, Position, Range, TextEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import Documents from '../../core/documents'
import events from '../../events'
import BufferSync from '../../model/bufferSync'
import workspace from '../../workspace'
import helper from '../helper'

let documents: Documents
let nvim: Neovim

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  documents = workspace.documentsManager
})

afterEach(async () => {
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
})
