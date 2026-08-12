import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, Disposable, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import commands from '../../commands'
import Format from '../../handler/format'
import languages, { ProviderName } from '../../languages'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
let format: Format

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  format = helper.plugin.getHandler().format
})

beforeEach(() => {
  helper.updateConfiguration('coc.preferences.formatOnType', true)
})

afterEach(async () => {
  await helper.reset()
  disposeAll(disposables)
})

afterAll(async () => {
  await helper.shutdown()
})

describe('format handler', () => {
  describe('documentFormat', () => {
    it('should return null when format provider not exists', async () => {
      let doc = await workspace.document
      let res = await languages.provideDocumentFormattingEdits(doc.textDocument, { insertSpaces: false, tabSize: 2 }, CancellationToken.None)
      assert.strictEqual(res, null)
    })

    it('should throw when provider not found', async () => {
      await assert.rejects(commands.executeCommand('editor.action.formatDocument', 999), Error)
      await assert.rejects(commands.executeCommand('editor.action.formatDocument'), Error)
      await assert.rejects(async () => {
        let doc = await workspace.document
        await commands.executeCommand('editor.action.formatDocument', doc.uri)
      }, Error)
    })

    it('should return false when get empty edits', async () => {
      disposables.push(languages.registerDocumentFormatProvider(['*'], {
        provideDocumentFormattingEdits: () => {
          return []
        }
      }))
      let doc = await helper.createDocument()
      let res = await format.documentFormat(doc)
      assert.strictEqual(res, false)
    })

    it('should use provider that have higher score', async () => {
      disposables.push(languages.registerDocumentFormatProvider([{ language: 'vim' }], {
        provideDocumentFormattingEdits: () => {
          return [TextEdit.insert(Position.create(0, 0), '  ')]
        }
      }))
      disposables.push(languages.registerDocumentFormatProvider(['*'], {
        provideDocumentFormattingEdits: () => {
          return []
        }
      }))
      let doc = await helper.createDocument('t.vim')
      let res = await languages.provideDocumentFormattingEdits(doc.textDocument, { tabSize: 2, insertSpaces: false }, CancellationToken.None)
      assert.strictEqual(res.length, 1)
    })

    it('should not fallback to range formatter when document formatter returns null', async () => {
      let called = false
      disposables.push(languages.registerDocumentFormatProvider([{ language: 'text' }], {
        provideDocumentFormattingEdits: () => {
          return null
        }
      }))
      disposables.push(languages.registerDocumentRangeFormatProvider([{ language: 'text' }], {
        provideDocumentRangeFormattingEdits: () => {
          called = true
          return [TextEdit.insert(Position.create(0, 0), '  ')]
        }
      }))
      let doc = await helper.createDocument('t.txt')
      let edits = await languages.provideDocumentFormattingEdits(doc.textDocument, { tabSize: 2, insertSpaces: false }, CancellationToken.None)
      assert.strictEqual(edits, null)
      assert.strictEqual(called, false)
    })

    it('should fallback to range formatter when document formatter not exists', async () => {
      let called = false
      disposables.push(languages.registerDocumentRangeFormatProvider([{ language: 'text' }], {
        provideDocumentRangeFormattingEdits: () => {
          called = true
          return [TextEdit.insert(Position.create(0, 0), '  ')]
        }
      }))
      let doc = await helper.createDocument('t.txt')
      let edits = await languages.provideDocumentFormattingEdits(doc.textDocument, { tabSize: 2, insertSpaces: false }, CancellationToken.None)
      assert.strictEqual(called, true)
      assert.strictEqual(edits.length, 1)
    })

    it('should format current buffer', async () => {
      disposables.push(languages.registerDocumentFormatProvider([{ language: 'vim' }], {
        provideDocumentFormattingEdits: () => {
          return [TextEdit.insert(Position.create(0, 0), '  ')]
        }
      }))
      await helper.createDocument('t.vim')
      await commands.executeCommand('editor.action.format')
      let line = await nvim.line
      assert.strictEqual(line, '  ')
    })

    it('should use specified format provider', async () => {
      helper.updateConfiguration('coc.preferences.formatterExtension', 'foo', disposables)
      disposables.push(languages.registerDocumentFormatProvider([{ language: '*' }], {
        provideDocumentFormattingEdits: () => {
          return [TextEdit.insert(Position.create(0, 0), '  ')]
        }
      }))
      let doc = await workspace.document
      let res = await format.documentFormat(doc)
      assert.strictEqual(res, true)
      let provider = {
        provideDocumentFormattingEdits: doc => {
          let line = doc.lines[0] as string
          return [TextEdit.replace(Range.create(0, 0, 0, line.length), 'foo')]
        }
      }
      provider['__extensionName'] = 'foo'
      disposables.push(languages.registerDocumentFormatProvider([{ language: '*' }], provider))
      await format.documentFormat(doc)
      let line = doc.getline(0)
      assert.strictEqual(line, 'foo')
    })
  })

  describe('rangeFormat', () => {
    it('should return null when provider does not exist', async () => {
      let doc = (await workspace.document).textDocument
      let range = Range.create(0, 0, 1, 0)
      let options = await workspace.getFormatOptions()
      let token = (new CancellationTokenSource()).token
      assert.strictEqual(await languages.provideDocumentRangeFormattingEdits(doc, range, options, token), null)
      assert.strictEqual(await languages.provideDocumentRangesFormattingEdits(doc, [range], options, token), null)
      assert.strictEqual(languages.hasProvider(ProviderName.FormatOnType, doc), false)
      assert.strictEqual(languages.hasProvider(ProviderName.OnTypeEdit, doc), false)
      let edits = await languages.provideDocumentFormattingEdits(doc, options, token)
      assert.strictEqual(edits, null)
    })

    it('should return -1 when range not exists', async (t) => {
      disposables.push(languages.registerDocumentRangeFormatProvider(['*'], {
        provideDocumentRangeFormattingEdits: () => {
          return []
        }
      }, 1))
      let spy = t.mock.method(window, 'getSelectedRange', () => {
        return Promise.resolve(null)
      })
      let doc = await workspace.document
      let res = await format.documentRangeFormat(doc, 'v')
      spy.mock.restore()
      assert.strictEqual(res, -1)
    })

    it('should invoke range format', async () => {
      disposables.push(languages.registerDocumentRangeFormatProvider(['text'], {
        provideDocumentRangeFormattingEdits: (_document, range) => {
          let lines: number[] = []
          for (let i = range.start.line; i <= range.end.line; i++) {
            lines.push(i)
          }
          return lines.map(i => {
            return TextEdit.insert(Position.create(i, 0), '  ')
          })
        }
      }, 1))
      let doc = await helper.createDocument()
      doc.setFiletype('text')
      await nvim.call('setline', [1, ['a', 'b', 'c']])
      await nvim.command('normal! ggvG')
      await nvim.input('<esc>')
      assert.strictEqual(languages.hasFormatProvider(doc.textDocument), true)
      assert.strictEqual(languages.hasProvider(ProviderName.Format, doc.textDocument), true)
      await helper.doAction('formatSelected', 'v')
      let buf = nvim.createBuffer(doc.bufnr)
      let lines = await buf.lines
      assert.deepStrictEqual(lines, ['  a', '  b', '  c'])
      let options = await workspace.getFormatOptions(doc.bufnr)
      let token = (new CancellationTokenSource()).token
      let edits = await languages.provideDocumentFormattingEdits(doc.textDocument, options, token)
      assert.ok((edits.length) > (0))
    })

    it('should format range by formatexpr option', async () => {
      let range: Range
      disposables.push(languages.registerDocumentRangeFormatProvider(['text'], {
        provideDocumentRangeFormattingEdits: (_document, r) => {
          range = r
          return []
        }
      }))
      let doc = await helper.createDocument()
      doc.setFiletype('text')
      await nvim.call('setline', [1, ['a', 'b', 'c']])
      await nvim.command(`setl formatexpr=CocAction('formatSelected')`)
      await nvim.command('normal! ggvGgq')
      assert.deepStrictEqual(range, {
        start: { line: 0, character: 0 }, end: { line: 3, character: 0 }
      })
    })

    it('should provide ranges formatting edits', async () => {
      let called = false
      disposables.push(languages.registerDocumentRangeFormatProvider(['text'], {
        provideDocumentRangeFormattingEdits: () => [],
        provideDocumentRangesFormattingEdits: (_document, ranges) => {
          called = true
          return ranges.map(r => TextEdit.insert(Position.create(r.start.line, r.start.character), '  '))
        }
      }, 1))
      let doc = await helper.createDocument()
      doc.setFiletype('text')
      let options = await workspace.getFormatOptions(doc.bufnr)
      let token = (new CancellationTokenSource()).token
      let edits = await languages.provideDocumentRangesFormattingEdits(
        doc.textDocument,
        [Range.create(0, 0, 0, 1), Range.create(1, 0, 1, 1)],
        options,
        token
      )
      assert.strictEqual(called, true)
      assert.strictEqual(edits.length, 2)
    })

    it('should fallback to per range formatting', async () => {
      let ranges: Range[] = []
      disposables.push(languages.registerDocumentRangeFormatProvider(['text'], {
        provideDocumentRangeFormattingEdits: (_document, range) => {
          ranges.push(range)
          return []
        }
      }, 1))
      let doc = await helper.createDocument()
      doc.setFiletype('text')
      let options = await workspace.getFormatOptions(doc.bufnr)
      let token = (new CancellationTokenSource()).token
      let edits = await languages.provideDocumentRangesFormattingEdits(
        doc.textDocument,
        [Range.create(0, 0, 0, 1), Range.create(1, 0, 1, 1)],
        options,
        token
      )
      assert.strictEqual(ranges.length, 2)
      assert.strictEqual(ranges[0].start.line, 0)
      assert.strictEqual(ranges[1].start.line, 1)
      assert.strictEqual(edits.length, 0)
    })
  })

  describe('formatOnType', () => {
    it('should invoke format', async () => {
      disposables.push(languages.registerDocumentFormatProvider(['text'], {
        provideDocumentFormattingEdits: () => {
          return [TextEdit.insert(Position.create(0, 0), '  ')]
        }
      }))
      let doc = await helper.createDocument()
      doc.setFiletype('text')
      await nvim.setLine('foo')
      await helper.doAction('format')
      let line = await nvim.line
      assert.deepStrictEqual(line, '  foo')
    })

    it('should respect formatOnTypeFiletypes', async () => {
      helper.updateConfiguration('coc.preferences.formatOnTypeFiletypes', ['*'])
      assert.strictEqual(format.shouldFormatOnType('vim'), true)
      helper.updateConfiguration('coc.preferences.formatOnTypeFiletypes', ['txt'])
      let doc = await helper.createDocument('t.vim')
      let res = await format.tryFormatOnType('\n', doc)
      assert.strictEqual(res, false)
    })

    it('should not format on type when disabled by variable', async () => {
      disposables.push(languages.registerDocumentFormatProvider(['*'], {
        provideDocumentFormattingEdits: () => {
          return [TextEdit.insert(Position.create(0, 0), '  ')]
        }
      }))
      nvim.pauseNotification()
      nvim.command('e foo', true)
      nvim.command('let b:coc_disable_autoformat = 1', true)
      await nvim.resumeNotification()
      let doc = await workspace.document
      let res = await format.tryFormatOnType('\n', doc)
      assert.strictEqual(res, false)
    })

    it('should does format on type', async () => {
      let doc = await workspace.document
      disposables.push(languages.registerOnTypeFormattingEditProvider(['*'], {
        provideOnTypeFormattingEdits: () => {
          return [TextEdit.insert(Position.create(0, 0), '  ')]
        }
      }, ['|']))
      let res = await format.tryFormatOnType(';', doc)
      assert.strictEqual(res, false)
      await helper.edit()
      await nvim.input('i|')
      await helper.waitFor('getline', ['.'], '  |')
      let cursor = await window.getCursorPosition()
      assert.deepStrictEqual(cursor, { line: 0, character: 3 })
    })

    it('should return null when provider not found', async () => {
      let doc = await workspace.document
      let res = await languages.provideDocumentOnTypeEdits('|', doc.textDocument, Position.create(0, 0), CancellationToken.None)
      assert.strictEqual(res, null)
    })

    it('should adjust cursor after format on type', async () => {
      disposables.push(languages.registerOnTypeFormattingEditProvider(['text'], {
        provideOnTypeFormattingEdits: () => {
          return [
            TextEdit.insert(Position.create(0, 0), '  '),
            TextEdit.insert(Position.create(0, 2), 'end')
          ]
        }
      }, ['|']))
      disposables.push(languages.registerOnTypeFormattingEditProvider([{ language: '*' }], {
        provideOnTypeFormattingEdits: () => {
          return []
        }
      }))
      let doc = await helper.createDocument()
      doc.setFiletype('text')
      await nvim.setLine('"')
      await nvim.input('i|')
      await helper.waitFor('getline', ['.'], '  |"end')
      let cursor = await window.getCursorPosition()
      assert.deepStrictEqual(cursor, { line: 0, character: 3 })
    })
  })

  describe('bracketEnterImprove', () => {
    afterEach(() => {
      nvim.command('iunmap <CR>', true)
    })

    it('should not throw for buffer not attached', async () => {
      await nvim.command(`edit +setl\\ buftype=nofile foo`)
      let doc = await workspace.document
      assert.strictEqual(doc.attached, false)
      await format.handleEnter(doc.bufnr)
    })

    it('should format vim file on enter', async () => {
      let buf = await helper.edit('foo.vim')
      await buf.setOption('expandtab', true)
      await nvim.command(`inoremap <silent><expr> <cr> pumvisible() ? coc#_select_confirm() : "\\<C-g>u\\<CR>\\<c-r>=coc#on_enter()\\<CR>"`)
      await nvim.setLine('let foo={}')
      await nvim.command(`normal! gg$`)
      await nvim.input('i')
      await nvim.eval(`feedkeys("\\<CR>", 'im')`)
      await helper.waitFor('getline', [2], '  \\ ')
      let lines = await buf.lines
      assert.deepStrictEqual(lines, ['let foo={', '  \\ ', '  \\ }'])
    })

    it('should use tab on format', async () => {
      let buf = await helper.edit('foo.vim')
      await buf.setOption('expandtab', false)
      await nvim.command(`inoremap <silent><expr> <cr> pumvisible() ? coc#_select_confirm() : "\\<C-g>u\\<CR>\\<c-r>=coc#on_enter()\\<CR>"`)
      await nvim.setLine('let foo={}')
      await nvim.command(`normal! gg$`)
      await nvim.input('i')
      await nvim.eval(`feedkeys("\\<CR>", 'im')`)
      await helper.waitFor('getline', ['.'], '\t\\ ')
    })

    it('should add new line between bracket', async () => {
      let buf = await helper.edit()
      await nvim.command(`inoremap <silent><expr> <cr> pumvisible() ? coc#_select_confirm() : "\\<C-g>u\\<CR>\\<c-r>=coc#on_enter()\\<CR>"`)
      await nvim.setLine('  {}')
      await nvim.command(`normal! gg$`)
      await nvim.input('i')
      await nvim.eval(`feedkeys("\\<CR>", 'im')`)
      await helper.waitFor('getline', [2], '    ')
      let lines = await buf.lines
      assert.deepStrictEqual(lines, ['  {', '    ', '  }'])
    })
  })

  describe('logProvider()', () => {
    it('should log provider', () => {
      format.logProvider(1, [])
      format.logProvider(1, null)
      let edits = [TextEdit.insert(Position.create(1, 1), 'foo')]
      format.logProvider(1, edits)
      let called = false
      Object.defineProperty(edits, '__extensionName', {
        get: () => {
          called = true
          return 'name'
        }
      })
      format.logProvider(1, edits)
      assert.strictEqual(called, true)
    })
  })
})
