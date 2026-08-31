import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import commands from '../../commands'
import RefactorBuffer, { FileItemDef, fixChangeParams } from '../../handler/refactor/buffer'
import Changes from '../../handler/refactor/changes'
import Refactor from '../../handler/refactor/index'
import languages from '../../languages'
import { DidChangeTextDocumentParams } from '../../types'
import { Disposable } from '../../util'
import workspace from '../../workspace'
import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import { Position, Range, TextDocumentEdit, TextEdit, WorkspaceEdit } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'


let nvim: Neovim
let refactor: Refactor

before(async () => {
  nvim = workspace.nvim
  refactor = getCurrentPlugin().getHandler().refactor
})

afterEach(async () => {
  refactor.reset()
})

function createEdit(uri: string): WorkspaceEdit {
  let edit = TextEdit.insert(Position.create(0, 0), 'a')
  let doc = { uri, version: null }
  return { documentChanges: [TextDocumentEdit.create(doc, [edit])] }
}

// assert ranges is expected.
async function assertSynchronized(buf: RefactorBuffer) {
  let buffer = nvim.createBuffer(buf.bufnr)
  let lines = await buffer.lines
  let items: { lnum: number, lines: string[] }[] = []
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (line.includes('\u3000') && line.length > 1) {
      items.push({ lnum: i + 1, lines: [] })
    }
  }
  let curr: { lnum: number, lines: string[] }[] = []
  buf.fileItems.forEach(item => {
    item.ranges.forEach(r => {
      curr.push({ lnum: r.lnum, lines: [] })
    })
  })
  curr.sort((a, b) => a.lnum - b.lnum)
  assert.deepStrictEqual(items, curr)
}

describe('fixChangeParams', () => {
  function createChangeParams(range: Range, text: string, original: string, originalLines: ReadonlyArray<string>): DidChangeTextDocumentParams {
    return {
      textDocument: {
        uri: 'untitled:/1',
        version: 1,
      },
      originalLines,
      original,
      bufnr: 1,
      contentChanges: [{ range, text }]
    } as any
  }

  it('should fix delete change params', async t => {
    let e = createChangeParams(Range.create(0, 4, 2, 4), '', 'x\nfoo\n\u3000bar', [
      '\u3000barx',
      'foo',
      '\u3000bara'
    ])
    e = fixChangeParams(e)
    assert.strictEqual(e.original, '\u3000barx\nfoo\n')
    assert.deepStrictEqual(e.contentChanges[0].range, Range.create(0, 0, 2, 0))
  })

  it('should fix insert change params', async t => {
    let e = createChangeParams(Range.create(0, 4, 0, 4), 'x\nfoo\n\u3000bar', '', [
      '\u3000bara'
    ])
    e = fixChangeParams(e)
    assert.strictEqual(e.original, '')
    let change = e.contentChanges[0]
    assert.deepStrictEqual(change.range, Range.create(0, 0, 0, 0))
    assert.strictEqual(change.text, '\u3000barx\nfoo\n')

    e = createChangeParams(Range.create(1, 0, 1, 0), 'foo\n\u3000bar\n', '', [
      '\u3000bar',
      'baz'
    ])
    e = fixChangeParams(e)
    assert.deepStrictEqual(e.contentChanges[0].range, Range.create(0, 0, 0, 0))
    assert.strictEqual(e.contentChanges[0].text, '\u3000bar\nfoo\n')
  })
})

describe('refactor', () => {
  afterEach(editorReset)

  describe('checkInsert()', () => {
    it('should check inserted ranges', async t => {
      let c = new Changes()
      assert.strictEqual(c.checkInsert([1]), undefined)
      c.add([{ filepath: import.meta.filename, start: 1, lnum: 1, lines: [''] }])
      assert.strictEqual(c.checkInsert([2]), undefined)
    })
  })

  describe('getFileRange()', () => {
    it('should throw when range does not exist', async t => {
      let uri = URI.file(import.meta.filename).toString()
      let locations = [{ uri, range: Range.create(0, 0, 0, 6) }]
      let buf = await refactor.fromLocations(locations)
      let fn = () => {
        buf.getFileRange(1)
      }
      assert.throws(fn, Error)
    })

    it('should find file range', async t => {
      let uri = URI.file(import.meta.filename).toString()
      let locations = [{ uri, range: Range.create(0, 0, 0, 6) }]
      let buf = await commands.executeCommand('editor.action.showRefactor', locations) as any
      let res = buf.getFileRange(4)
      assert.notStrictEqual(res, undefined)
    })
  })

  describe('getRange()', () => {
    it('should get delete range', async t => {
      let filename = await shared.createTmpFile('foo\n\nbar\n')
      let fileItem: FileItemDef = {
        filepath: filename,
        ranges: [{ start: 0, end: 1 }, { start: 2, end: 3 }]
      }
      let buf = await refactor.createRefactorBuffer()
      await buf.addFileItems([fileItem])
      let res = buf.getFileRange(4)
      let r = buf.getDeleteRange(res)
      assert.deepStrictEqual(r, Range.create(3, 0, 6, 0))
      res = buf.getFileRange(7)
      r = buf.getDeleteRange(res)
      assert.deepStrictEqual(r, Range.create(6, 0, 8, 0))
    })

    it('should get replace range', async t => {
      let filename = await shared.createTmpFile('foo\n\nbar\n')
      let fileItem: FileItemDef = {
        filepath: filename,
        ranges: [{ start: 0, end: 1 }, { start: 2, end: 3 }]
      }
      let buf = await refactor.createRefactorBuffer()
      await buf.addFileItems([fileItem])
      let res = buf.getFileRange(4)
      let r = buf.getReplaceRange(res)
      assert.deepStrictEqual(r, Range.create(4, 0, 4, 3))
      res = buf.getFileRange(7)
      r = buf.getReplaceRange(res)
      assert.deepStrictEqual(r, Range.create(7, 0, 7, 3))
    })
  })

  describe('fromWorkspaceEdit()', () => {
    it('should not create from invalid workspaceEdit', async t => {
      let res = await refactor.fromWorkspaceEdit(undefined)
      assert.strictEqual(res, undefined)
      res = await refactor.fromWorkspaceEdit({ documentChanges: [] })
      assert.strictEqual(res, undefined)
    })

    it('should create from document changes', async t => {
      let edit = createEdit(URI.file(import.meta.filename).toString())
      let buf = await refactor.fromWorkspaceEdit(edit)
      let shown = await buf.valid
      assert.strictEqual(shown, true)
      let items = buf.fileItems
      assert.strictEqual(items.length, 1)
      await nvim.command(`bd! ${buf.bufnr}`)
      await shared.waitValue(() => refactor.has(buf.bufnr), false)
      let has = refactor.has(buf.bufnr)
      assert.strictEqual(has, false)
    })

    it('should create from workspaceEdit', async t => {
      let changes = {
        [URI.file(import.meta.filename).toString()]: [{
          range: Range.create(0, 0, 0, 6),
          newText: ''
        }, {
          range: Range.create(1, 0, 1, 6),
          newText: ''
        }, {
          range: Range.create(50, 0, 50, 1),
          newText: ' '
        }, {
          range: Range.create(60, 0, 60, 1),
          newText: ' '
        }]
      }
      let edit: WorkspaceEdit = { changes }
      let buf = await refactor.fromWorkspaceEdit(edit)
      let shown = await buf.valid
      assert.strictEqual(shown, true)
      let items = buf.fileItems
      assert.strictEqual(items.length, 1)
    })
  })

  describe('fromLocations()', () => {
    it('should create from locations', async t => {
      let uri = URI.file(import.meta.filename).toString()
      let locations = [{
        uri,
        range: Range.create(0, 0, 0, 6),
      }, {
        uri,
        range: Range.create(1, 0, 1, 6),
      }]
      let buf = await refactor.fromLocations(locations)
      let shown = await buf.valid
      assert.strictEqual(shown, true)
      let items = buf.fileItems
      assert.strictEqual(items.length, 1)
    })

    it('should not create from empty locations', async t => {
      let buf = await refactor.fromLocations([])
      assert.strictEqual(buf, undefined)
    })
  })

  describe('onChange()', () => {
    async function setup(): Promise<RefactorBuffer> {
      let uri = URI.file(import.meta.filename).toString()
      let locations = [{
        uri,
        range: Range.create(0, 0, 0, 6),
      }, {
        uri,
        range: Range.create(1, 0, 1, 6),
      }, {
        uri,
        range: Range.create(10, 0, 10, 6),
      }]
      return await refactor.fromLocations(locations)
    }

    it('should refresh on empty text change', async t => {
      let buf = await setup()
      let line = await nvim.call('getline', [4])
      let doc = workspace.getDocument(buf.bufnr)
      await nvim.call('setline', [4, line])
      doc._forceSync()
      let srcId = await nvim.createNamespace('coc-refactor')
      let markers = await doc.buffer.getExtMarks(srcId, 0, -1)
      assert.strictEqual(markers.length, 2)
    })

    it('should detect range delete and undo', async t => {
      let buf = await setup()
      let doc = workspace.getDocument(buf.bufnr)
      let r = buf.getFileRange(4)
      let end = r.lnum + r.lines.length
      await nvim.command(`${r.lnum},${end + 1}d`)
      await doc.synchronize()
      await assertSynchronized(buf)
      await nvim.command('undo')
      await doc.synchronize()
      await assertSynchronized(buf)
    })

    it('should detect normal delete', async t => {
      let buf = await setup()
      let doc = workspace.getDocument(buf.bufnr)
      let r = buf.getFileRange(4)
      await nvim.command(`${r.lnum + 1},${r.lnum + 1}d`)
      await doc.synchronize()
      await assertSynchronized(buf)
    })

    it('should detect insert', async t => {
      let buf = await setup()
      let doc = workspace.getDocument(buf.bufnr)
      let buffer = nvim.createBuffer(buf.bufnr)
      await buffer.append(['foo'])
      await doc.synchronize()
      await assertSynchronized(buf)
      await buffer.append(['foo', '\u3000'])
      await doc.synchronize()
      await assertSynchronized(buf)
    })
  })

  describe('onDocumentChange()', () => {
    it('should ignore when change after range', async t => {
      let doc = await shared.createDocument()
      await doc.buffer.append(['foo', 'bar'])
      await doc.synchronize()
      let buf = await refactor.fromLocations([{ uri: doc.uri, range: Range.create(0, 0, 0, 3) }])
      let lines = await nvim.call('getline', [1, '$'])
      await doc.buffer.append(['def'])
      await doc.synchronize()
      let newLines = await nvim.call('getline', [1, '$'])
      assert.deepStrictEqual(lines, newLines)
      await assertSynchronized(buf)
    })

    it('should adjust when change before range', async t => {
      let doc = await shared.createDocument()
      await doc.buffer.append(['', '', '', '', 'foo', 'bar'])
      await doc.synchronize()
      let buf = await refactor.fromLocations([{ uri: doc.uri, range: Range.create(4, 0, 4, 3) }])
      await doc.buffer.setLines(['def'], { start: 0, end: 0, strictIndexing: false })
      await doc.synchronize()
      let fileRange = buf.getFileRange(4)
      assert.strictEqual(fileRange.start, 2)
      assert.strictEqual(fileRange.lines.length, 6)
      await assertSynchronized(buf)
    })

    it('should remove ranges when lines empty', async t => {
      let doc = await shared.createDocument()
      await doc.buffer.append(['', '', '', '', 'foo', 'bar'])
      await doc.synchronize()
      let buf = await refactor.fromLocations([{ uri: doc.uri, range: Range.create(4, 0, 4, 3) }])
      await doc.buffer.setLines([], { start: 0, end: -1, strictIndexing: false })
      await doc.synchronize()
      let lines = await nvim.call('getline', [1, '$']) as string[]
      assert.strictEqual(lines.length, 3)
      let items = buf.fileItems
      assert.strictEqual(items.length, 0)
      await assertSynchronized(buf)
    })

    it('should change when liens changed', async t => {
      let doc = await shared.createDocument()
      await doc.buffer.append(['', '', '', '', 'foo', 'bar'])
      await doc.synchronize()
      let buf = await refactor.fromLocations([{ uri: doc.uri, range: Range.create(4, 0, 4, 3) }])
      await doc.buffer.setLines(['def', 'def'], { start: 5, end: 6, strictIndexing: false })
      await doc.synchronize()
      let lines = await nvim.call('getline', [1, '$']) as string[]
      assert.strictEqual(lines[lines.length - 2], 'def')
      await assertSynchronized(buf)
    })
  })

  describe('getFileChanges()', () => {
    it('should get changes #1', async t => {
      await shared.createDocument()
      let lines = `
Save current buffer to make changes
\u3000
\u3000
\u3000/a.ts
    })
  } `
      let buf = await refactor.fromLines(lines.split('\n'))
      let changes = await buf.getFileChanges()
      assert.deepStrictEqual(changes, [{ lnum: 5, filepath: '/a.ts', lines: ['    })', '  } '] }])
    })

    it('should get changes #2', async t => {
      let lines = `
\u3000/a.ts
    })
  } `
      let buf = await refactor.fromLines(lines.split('\n'))
      let changes = await buf.getFileChanges()
      assert.deepStrictEqual(changes, [{ lnum: 2, filepath: '/a.ts', lines: ['    })', '  } '] }])
    })

    it('should get changes #3', async t => {
      let lines = `
\u3000/a.ts
    })
  }
\u3000`
      let buf = await refactor.fromLines(lines.split('\n'))
      let changes = await buf.getFileChanges()
      assert.deepStrictEqual(changes, [{ lnum: 2, filepath: '/a.ts', lines: ['    })', '  }'] }])
    })

    it('should get changes #4', async t => {
      let lines = `
\u3000/a.ts
foo
\u3000/b.ts
bar
\u3000`
      let buf = await refactor.fromLines(lines.split('\n'))
      let changes = await buf.getFileChanges()
      assert.deepStrictEqual(changes, [
        { filepath: '/a.ts', lnum: 2, lines: ['foo'] },
        { filepath: '/b.ts', lnum: 4, lines: ['bar'] }
      ])
    })
  })

  describe('createRefactorBuffer()', () => {
    it('should create refactor buffer', async t => {
      let winid = await nvim.call('win_getid') as number
      let buf = await refactor.createRefactorBuffer()
      let curr = await nvim.call('win_getid') as number
      assert.ok(curr > winid)
      let valid = await buf.valid
      assert.strictEqual(valid, true)
      buf = await refactor.createRefactorBuffer('vim')
      valid = await buf.valid
      assert.strictEqual(valid, true)
    })

    it('should use conceal for line numbers', async t => {
      let buf = await refactor.createRefactorBuffer(undefined, true)
      let fileItem: FileItemDef = {
        filepath: import.meta.filename,
        ranges: [{ start: 10, end: 11 }, { start: 15, end: 20 }]
      }
      await buf.addFileItems([fileItem])
      let arr = await nvim.call('getmatches') as any[]
      arr = arr.filter(o => o.group == 'Conceal')
      assert.ok(arr.length > 0)
      await buf.addFileItems([{
        filepath: import.meta.filename,
        ranges: [{ start: 1, end: 3 }]
      }])
      await nvim.command('normal! ggdG')
      let doc = workspace.getDocument(buf.bufnr)
      await doc.synchronize()
      let b = nvim.createBuffer(buf.bufnr)
      let res = await b.getVar('line_infos')
      assert.deepStrictEqual(res, {})
    })
  })

  describe('splitOpen()', () => {
    async function setup(): Promise<RefactorBuffer> {
      let buf = await refactor.createRefactorBuffer()
      let fileItem: FileItemDef = {
        filepath: import.meta.filename,
        ranges: [{ start: 10, end: 11 }, { start: 15, end: 20 }]
      }
      await buf.addFileItems([fileItem])
      await nvim.call('cursor', [5, 1])
      return buf
    }

    it('should jump to position by <CR>', async t => {
      let buf = await setup()
      await buf.splitOpen()
      let line = await nvim.eval('line(".")')
      let bufname = await nvim.eval('bufname("%")') as string
      assert.match(bufname, new RegExp('refactor\\.test\\.(?:js|ts)'))
      assert.strictEqual(line, 11)
    })

    it('should jump split window when original window not valid', async t => {
      let win = await nvim.window
      let buf = await setup()
      await nvim.call('nvim_win_close', [win.id, true])
      await buf.splitOpen()
      let line = await nvim.eval('line(".")')
      let bufname = await nvim.eval('bufname("%")') as string
      assert.match(bufname, new RegExp('refactor\\.test\\.(?:js|ts)'))
      assert.strictEqual(line, 11)
    })
  })

  describe('showMenu()', () => {
    async function setup(): Promise<RefactorBuffer> {
      let buf = await refactor.createRefactorBuffer()
      let fileItem: FileItemDef = {
        filepath: import.meta.filename,
        ranges: [{ start: 10, end: 11 }, { start: 15, end: 20 }]
      }
      await buf.addFileItems([fileItem])
      await nvim.call('cursor', [5, 1])
      return buf
    }

    it('should do nothing when cancelled or range not found', async t => {
      let buf = await setup()
      let p = buf.showMenu()
      await shared.waitPrompt()
      await nvim.input('<esc>')
      await p
      let bufnr = await nvim.call('bufnr', ['%'])
      assert.strictEqual(bufnr, buf.bufnr)
      await nvim.call('cursor', [1, 1])
      p = buf.showMenu()
      await shared.waitPrompt()
      await nvim.input('1')
      await p
      bufnr = await nvim.call('bufnr', ['%'])
      assert.strictEqual(bufnr, buf.bufnr)
    })

    it('should open file in new tab', async t => {
      let buf = await setup()
      await nvim.call('cursor', [4, 1])
      let p = buf.showMenu()
      await shared.waitPrompt()
      await nvim.input('1')
      await p
      let nr = await nvim.call('tabpagenr')
      assert.strictEqual(nr, 2)
      let lnum = await nvim.call('line', ['.'])
      assert.strictEqual(lnum, 11)
    })

    it('should remove current block', async t => {
      let buf = await setup()
      await nvim.call('cursor', [4, 1])
      let p = buf.showMenu()
      await shared.waitPrompt()
      await nvim.input('2')
      await p
      let items = buf.fileItems
      assert.strictEqual(items[0].ranges.length, 1)
      await assertSynchronized(buf)
    })
  })

  describe('saveRefactor()', () => {
    it('should adjust line ranges after change', async t => {
      let filename = await shared.createTmpFile('foo\n\nbar\n')
      let fileItem: FileItemDef = {
        filepath: filename,
        ranges: [{ start: 0, end: 1 }, { start: 2, end: 3 }]
      }
      let buf = await refactor.createRefactorBuffer()
      const getRanges = () => {
        let items = buf.fileItems
        let item = items.find(o => o.filepath == filename)
        return item.ranges.map(o => {
          return [o.start, o.start + o.lines.length]
        })
      }
      await buf.addFileItems([fileItem, {
        filepath: import.meta.filename,
        ranges: [{ start: 1, end: 5 }]
      }])
      assert.deepStrictEqual(getRanges(), [[0, 1], [2, 3]])
      nvim.pauseNotification()
      nvim.call('setline', [5, ['xyoo']], true)
      nvim.command('undojoin', true)
      nvim.call('append', [5, ['de']], true)
      nvim.command('undojoin', true)
      nvim.call('setline', [9, ['b']], true)
      await nvim.resumeNotification()
      let doc = workspace.getDocument(buf.bufnr)
      await doc.synchronize()
      let res = await shared.doAction('saveRefactor', doc.bufnr)
      assert.strictEqual(res, true)
      assert.deepStrictEqual(getRanges(), [[0, 2], [3, 4]])
      let content = fs.readFileSync(filename, 'utf8')
      assert.strictEqual(content, 'xyoo\nde\n\nb\n')
    })

    it('should not save when no change made', async t => {
      let buf = await refactor.createRefactorBuffer()
      let fileItem: FileItemDef = {
        filepath: import.meta.filename,
        ranges: [{ start: 10, end: 11 }, { start: 15, end: 20 }]
      }
      await buf.addFileItems([fileItem])
      let res = await buf.save()
      assert.strictEqual(res, false)
    })

    it('should sync buffer change to file', async t => {
      let doc = await shared.createDocument()
      await doc.buffer.replace(['foo', 'bar', 'line'], 0)
      await doc.synchronize()
      let filename = URI.parse(doc.uri).fsPath
      let fileItem: FileItemDef = {
        filepath: filename,
        ranges: [{ start: 0, end: 2 }]
      }
      let buf = await refactor.createRefactorBuffer()
      await buf.addFileItems([fileItem])
      await buf.buffer.setLines(['changed'], { start: 4, end: 5, strictIndexing: true })
      await workspace.getAttachedDocument(buf.bufnr).synchronize()
      let res = await buf.save()
      assert.strictEqual(res, true)
      assert.strictEqual(fs.existsSync(filename), true)
      let content = fs.readFileSync(filename, 'utf8')
      let lines = content.split('\n')
      assert.deepStrictEqual(lines, ['changed', 'bar', 'line', ''])
      fs.unlinkSync(filename)
    })
  })

  describe('doRefactor', () => {
    let disposable: Disposable

    afterEach(() => {
      if (disposable) disposable.dispose()
      disposable = null
    })

    it('should throw when rename provider not found', async t => {
      await shared.createDocument()
      let err
      try {
        await refactor.doRefactor()
      } catch (e) {
        err = e
      }
      assert.notStrictEqual(err, undefined)
    })

    it('should show message when prepare failed', async t => {
      await shared.createDocument()
      disposable = languages.registerRenameProvider(['*'], {
        prepareRename: () => {
          return undefined
        },
        provideRenameEdits: () => {
          return null
        }
      })
      await shared.doAction('refactor')
      let res = await shared.getCmdline()
      assert.match(res, /Error/)
    })

    it('should show message when returned edits is null', async t => {
      await shared.createDocument()
      disposable = languages.registerRenameProvider(['*'], {
        provideRenameEdits: () => {
          return null
        }
      })
      await refactor.doRefactor()
      let res = await shared.getCmdline()
      assert.match(res, /returns null/)
    })

    it('should open refactor window when edits is valid', async t => {
      let filepath = import.meta.filename
      disposable = languages.registerRenameProvider(['*'], {
        provideRenameEdits: () => {
          let changes = {
            [URI.file(filepath).toString()]: [{
              range: Range.create(0, 0, 0, 6),
              newText: ''
            }, {
              range: Range.create(1, 0, 1, 6),
              newText: ''
            }]
          }
          let edit: WorkspaceEdit = { changes }
          return edit
        }
      })
      await shared.createDocument(filepath)
      let winid = await nvim.call('win_getid') as number
      await refactor.doRefactor()
      let currWin = await nvim.call('win_getid') as number
      assert.ok(currWin - winid > 0)
      let bufnr = await nvim.call('bufnr', ['%']) as number
      let b = refactor.getBuffer(bufnr)
      assert.notStrictEqual(b, undefined)
    })
  })

  describe('search', () => {
    it('should open refactor buffer from search result', async t => {
      let escaped = await nvim.call('fnameescape', [import.meta.dirname])
      await nvim.command(`cd ${escaped}`)
      await shared.createDocument()
      await refactor.search(['registerRenameProvider'])
      let buf = await nvim.buffer
      let name = await buf.name
      assert.match(name, /__coc_refactor__/)
      let lines = await buf.lines
      assert.match(lines[0], /Save current buffer/)
    })
  })
})
