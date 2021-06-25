import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import { URI } from 'vscode-uri'
import Refactor, { FileItem } from '../../handler/refactor/index'
import helper, { createTmpFile } from '../helper'
import languages from '../../languages'
import { WorkspaceEdit, Range } from 'vscode-languageserver-types'
import { Disposable } from '@chemzqm/neovim/lib/api/Buffer'

let nvim: Neovim
let refactor: Refactor

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  refactor = helper.plugin.getHandler().refactor
})

beforeEach(async () => {
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  refactor.reset()
  await helper.reset()
})

describe('refactor', () => {
  describe('create', () => {
    it('should create from workspaceEdit', async () => {
      let changes = {
        [URI.file(__filename).toString()]: [{
          range: Range.create(0, 0, 0, 6),
          newText: ''
        }, {
          range: Range.create(1, 0, 1, 6),
          newText: ''
        }]
      }
      let edit: WorkspaceEdit = { changes }
      let buf = await refactor.fromWorkspaceEdit(edit)
      let shown = await buf.valid
      expect(shown).toBe(true)
      let items = buf.fileItems
      expect(items.length).toBe(1)
    })

    it('should create from locations', async () => {
      let uri = URI.file(__filename).toString()
      let locations = [{
        uri,
        range: Range.create(0, 0, 0, 6),
      }, {
        uri,
        range: Range.create(1, 0, 1, 6),
      }]
      let buf = await refactor.fromLocations(locations)
      let shown = await buf.valid
      expect(shown).toBe(true)
      let items = buf.fileItems
      expect(items.length).toBe(1)
    })
  })

  describe('onChange', () => {
    it('should ignore when change after range', async () => {
      let doc = await helper.createDocument()
      await doc.buffer.append(['foo', 'bar'])
      await refactor.fromLocations([{ uri: doc.uri, range: Range.create(0, 0, 0, 3) }])
      let lines = await nvim.call('getline', [1, '$'])
      await doc.buffer.append(['def'])
      doc.forceSync()
      await helper.wait(100)
      let newLines = await nvim.call('getline', [1, '$'])
      expect(lines).toEqual(newLines)
    })

    it('should adjust when change before range', async () => {
      let doc = await helper.createDocument()
      await doc.buffer.append(['', '', '', '', 'foo', 'bar'])
      await helper.wait(50)
      doc.forceSync()
      let buf = await refactor.fromLocations([{ uri: doc.uri, range: Range.create(4, 0, 4, 3) }])
      await doc.buffer.setLines(['def'], { start: 0, end: 0, strictIndexing: false })
      doc.forceSync()
      await helper.wait(100)
      let fileRange = buf.getFileRange(4)
      expect(fileRange.start).toBe(2)
      expect(fileRange.end).toBe(8)
    })

    it('should removed when lines empty', async () => {
      let doc = await helper.createDocument()
      await doc.buffer.append(['', '', '', '', 'foo', 'bar'])
      await helper.wait(50)
      doc.forceSync()
      let buf = await refactor.fromLocations([{ uri: doc.uri, range: Range.create(4, 0, 4, 3) }])
      await doc.buffer.setLines([], { start: 0, end: -1, strictIndexing: false })
      doc.forceSync()
      await helper.wait(100)
      let lines = await nvim.call('getline', [1, '$'])
      expect(lines.length).toBe(3)
      let items = buf.fileItems
      expect(items.length).toBe(0)
    })

    it('should change when liens changed', async () => {
      let doc = await helper.createDocument()
      await doc.buffer.append(['', '', '', '', 'foo', 'bar'])
      await helper.wait(50)
      doc.forceSync()
      await refactor.fromLocations([{ uri: doc.uri, range: Range.create(4, 0, 4, 3) }])
      await doc.buffer.setLines(['def'], { start: 5, end: 6, strictIndexing: false })
      doc.forceSync()
      await helper.wait(30)
      let lines = await nvim.call('getline', [1, '$'])
      expect(lines[lines.length - 2]).toBe('def')
    })
  })

  describe('refactor#getFileChanges', () => {
    it('should get changes #1', async () => {
      await helper.createDocument()
      let lines = `
Save current buffer to make changes
\u3000
\u3000
\u3000/a.ts
    })
  } `
      let buf = await refactor.fromLines(lines.split('\n'))
      let changes = await buf.getFileChanges()
      expect(changes).toEqual([{ lnum: 5, filepath: '/a.ts', lines: ['    })', '  } '] }])
    })

    it('should get changes #2', async () => {
      let lines = `
\u3000/a.ts
    })
  } `
      let buf = await refactor.fromLines(lines.split('\n'))
      let changes = await buf.getFileChanges()
      expect(changes).toEqual([{ lnum: 2, filepath: '/a.ts', lines: ['    })', '  } '] }])
    })

    it('should get changes #3', async () => {
      let lines = `
\u3000/a.ts
    })
  }
\u3000`
      let buf = await refactor.fromLines(lines.split('\n'))
      let changes = await buf.getFileChanges()
      expect(changes).toEqual([{ lnum: 2, filepath: '/a.ts', lines: ['    })', '  }'] }])
    })

    it('should get changes #4', async () => {
      let lines = `
\u3000/a.ts
foo
\u3000/b.ts
bar
\u3000`
      let buf = await refactor.fromLines(lines.split('\n'))
      let changes = await buf.getFileChanges()
      expect(changes).toEqual([
        { filepath: '/a.ts', lnum: 2, lines: ['foo'] },
        { filepath: '/b.ts', lnum: 4, lines: ['bar'] }
      ])
    })
  })

  describe('Refactor#createRefactorBuffer', () => {
    it('should create refactor buffer', async () => {
      await helper.createDocument()
      let winid = await nvim.call('win_getid')
      let buf = await refactor.createRefactorBuffer()
      let curr = await nvim.call('win_getid')
      expect(curr).toBeGreaterThan(winid)
      let valid = await buf.valid
      expect(valid).toBe(true)
    })

    it('should jump to position by <CR>', async () => {
      await helper.createDocument()
      let buf = await refactor.createRefactorBuffer()
      let fileItem: FileItem = {
        filepath: __filename,
        ranges: [{ start: 10, end: 11 }, { start: 15, end: 20 }]
      }
      await buf.addFileItems([fileItem])
      await nvim.call('cursor', [5, 1])
      await buf.splitOpen()
      let line = await nvim.eval('line(".")')
      let bufname = await nvim.eval('bufname("%")')
      expect(bufname).toMatch('refactor.test.ts')
      expect(line).toBe(11)
    })
  })

  describe('Refactor#saveRefactor', () => {
    it('should adjust line ranges after change', async () => {
      let filename = await createTmpFile('foo\n\nbar\n')
      let fileItem: FileItem = {
        filepath: filename,
        ranges: [{ start: 0, end: 1 }, { start: 2, end: 3 }]
      }
      let buf = await refactor.createRefactorBuffer()
      await buf.addFileItems([fileItem])
      nvim.pauseNotification()
      nvim.call('setline', [5, ['xyz']], true)
      nvim.command('undojoin', true)
      nvim.call('append', [5, ['de']], true)
      nvim.command('undojoin', true)
      nvim.call('append', [8, ['bar']], true)
      await nvim.resumeNotification()
      await helper.wait(100)
      let res = await refactor.save(buf.buffer.id)
      expect(res).toBe(true)
      let content = fs.readFileSync(filename, 'utf8')
      expect(content).toBe('xyz\nde\n\nbar\nbar\n')
    })

    it('should not save when no change made', async () => {
      let buf = await refactor.createRefactorBuffer()
      let fileItem: FileItem = {
        filepath: __filename,
        ranges: [{ start: 10, end: 11 }, { start: 15, end: 20 }]
      }
      await buf.addFileItems([fileItem])
      let res = await buf.save()
      expect(res).toBe(false)
    })

    it('should sync buffer change to file', async () => {
      let doc = await helper.createDocument()
      await doc.buffer.replace(['foo', 'bar', 'line'], 0)
      await helper.wait(30)
      let filename = URI.parse(doc.uri).fsPath
      let fileItem: FileItem = {
        filepath: filename,
        ranges: [{ start: 0, end: 2 }]
      }
      let buf = await refactor.createRefactorBuffer()
      await buf.addFileItems([fileItem])
      await nvim.call('setline', [5, 'changed'])
      let res = await buf.save()
      expect(res).toBe(true)
      expect(fs.existsSync(filename)).toBe(true)
      let content = fs.readFileSync(filename, 'utf8')
      let lines = content.split('\n')
      expect(lines).toEqual(['changed', 'bar', 'line', ''])
      fs.unlinkSync(filename)
    })
  })

  describe('doRefactor', () => {
    let disposable: Disposable

    afterEach(() => {
      if (disposable) disposable.dispose()
      disposable = null
    })

    it('should throw when rename provider not found', async () => {
      await helper.createDocument()
      let err
      try {
        await refactor.doRefactor()
      } catch (e) {
        err = e
      }
      expect(err).toBeDefined()
    })

    it('should show message when prepare failed', async () => {
      await helper.createDocument()
      disposable = languages.registerRenameProvider(['*'], {
        prepareRename: () => {
          return undefined
        },
        provideRenameEdits: () => {
          return null
        }
      })
      await refactor.doRefactor()
      let res = await helper.getCmdline()
      expect(res).toMatch(/unable to rename/)
    })

    it('should show message when returned edits is null', async () => {
      await helper.createDocument()
      disposable = languages.registerRenameProvider(['*'], {
        provideRenameEdits: () => {
          return null
        }
      })
      await refactor.doRefactor()
      let res = await helper.getCmdline()
      expect(res).toMatch(/returns null/)
    })

    it('should open refactor window when edits is valid', async () => {
      let filepath = __filename
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
      await helper.createDocument(filepath)
      let winid = await nvim.call('win_getid')
      await refactor.doRefactor()
      let currWin = await nvim.call('win_getid')
      expect(currWin - winid).toBeGreaterThan(0)
      let bufnr = await nvim.call('bufnr', ['%'])
      let b = refactor.getBuffer(bufnr)
      expect(b).toBeDefined()
    })
  })

  describe('search', () => {
    it('should open refactor buffer from search result', async () => {
      let escaped = await nvim.call('fnameescape', [__dirname])
      await nvim.command(`cd ${escaped}`)
      await helper.createDocument()
      await refactor.search(['registerRenameProvider'])
      let buf = await nvim.buffer
      let name = await buf.name
      expect(name).toMatch(/__coc_refactor__/)
      let lines = await buf.lines
      expect(lines[0]).toMatch(/Save current buffer/)
    })
  })
})
