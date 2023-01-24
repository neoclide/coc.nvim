import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, Disposable, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import commands from '../../commands'
import Format from '../../handler/format'
import languages, { ProviderName } from '../../languages'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import helper, { createTmpFile } from '../helper'

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
      expect(res).toBeNull()
    })

    it('should throw when provider not found', async () => {
      let doc = await workspace.document
      await expect(async () => {
        await commands.executeCommand('editor.action.formatDocument')
      }).rejects.toThrow(Error)
      await expect(async () => {
        await commands.executeCommand('editor.action.formatDocument', doc.uri)
      }).rejects.toThrow(Error)
    })

    it('should return false when get empty edits ', async () => {
      disposables.push(languages.registerDocumentFormatProvider(['*'], {
        provideDocumentFormattingEdits: () => {
          return []
        }
      }))
      let doc = await helper.createDocument()
      let res = await format.documentFormat(doc)
      expect(res).toBe(false)
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
      expect(res.length).toBe(1)
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
      expect(line).toBe('  ')
    })
  })

  describe('formatOnSave', () => {
    it('should not throw when provider not found', async () => {
      helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', ['javascript'])
      let filepath = await createTmpFile('')
      await helper.edit(filepath)
      await nvim.command('setf javascript')
      await nvim.setLine('foo')
      await nvim.command('silent w')
    })

    it('should enable format on save', async () => {
      helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', null)
      helper.updateConfiguration('coc.preferences.formatOnSave', true)
      let doc = await workspace.document
      let res = format.shouldFormatOnSave(doc.textDocument)
      expect(res).toBe(true)
    })

    it('should invoke format on save', async () => {
      helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', ['text'])
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
      await nvim.command('setf text')
      await nvim.command('w')
      let lines = await buf.lines
      expect(lines).toEqual(['  a', '  b', '  c'])
    })

    it('should cancel when timeout', async () => {
      helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', ['*'])
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
  })

  describe('rangeFormat', () => {
    it('should return null when provider does not exist', async () => {
      let doc = (await workspace.document).textDocument
      let range = Range.create(0, 0, 1, 0)
      let options = await workspace.getFormatOptions()
      let token = (new CancellationTokenSource()).token
      expect(await languages.provideDocumentRangeFormattingEdits(doc, range, options, token)).toBe(null)
      expect(languages.hasProvider(ProviderName.FormatOnType, doc)).toBe(false)
      expect(languages.hasProvider(ProviderName.OnTypeEdit, doc)).toBe(false)
      let edits = await languages.provideDocumentFormattingEdits(doc, options, token)
      expect(edits).toBe(null)
    })

    it('should return -1 when range not exists', async () => {
      disposables.push(languages.registerDocumentRangeFormatProvider(['*'], {
        provideDocumentRangeFormattingEdits: () => {
          return []
        }
      }, 1))
      let spy = jest.spyOn(window, 'getSelectedRange').mockImplementation(() => {
        return Promise.resolve(null)
      })
      let doc = await workspace.document
      let res = await format.documentRangeFormat(doc, 'v')
      spy.mockRestore()
      expect(res).toBe(-1)
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
      await nvim.call('setline', [1, ['a', 'b', 'c']])
      await nvim.command('setf text')
      await nvim.command('normal! ggvG')
      await nvim.input('<esc>')
      expect(languages.hasFormatProvider(doc.textDocument)).toBe(true)
      expect(languages.hasProvider(ProviderName.Format, doc.textDocument)).toBe(true)
      await helper.doAction('formatSelected', 'v')
      let buf = nvim.createBuffer(doc.bufnr)
      let lines = await buf.lines
      expect(lines).toEqual(['  a', '  b', '  c'])
      let options = await workspace.getFormatOptions(doc.uri)
      let token = (new CancellationTokenSource()).token
      let edits = await languages.provideDocumentFormattingEdits(doc.textDocument, options, token)
      expect(edits.length).toBeGreaterThan(0)
    })

    it('should format range by formatexpr option', async () => {
      let range: Range
      disposables.push(languages.registerDocumentRangeFormatProvider(['text'], {
        provideDocumentRangeFormattingEdits: (_document, r) => {
          range = r
          return []
        }
      }))
      await helper.createDocument()
      await nvim.call('setline', [1, ['a', 'b', 'c']])
      await nvim.command('setf text')
      await nvim.command(`setl formatexpr=CocAction('formatSelected')`)
      await nvim.command('normal! ggvGgq')
      expect(range).toEqual({
        start: { line: 0, character: 0 }, end: { line: 3, character: 0 }
      })
    })
  })

  describe('formatOnType', () => {
    it('should invoke format', async () => {
      disposables.push(languages.registerDocumentFormatProvider(['text'], {
        provideDocumentFormattingEdits: () => {
          return [TextEdit.insert(Position.create(0, 0), '  ')]
        }
      }))
      await helper.createDocument()
      await nvim.setLine('foo')
      await nvim.command('setf text')
      await helper.doAction('format')
      let line = await nvim.line
      expect(line).toEqual('  foo')
    })

    it('should respect formatOnTypeFiletypes', async () => {
      helper.updateConfiguration('coc.preferences.formatOnTypeFiletypes', ['*'])
      expect(format.shouldFormatOnType('vim')).toBe(true)
      helper.updateConfiguration('coc.preferences.formatOnTypeFiletypes', ['txt'])
      let doc = await helper.createDocument('t.vim')
      let res = await format.tryFormatOnType('\n', doc)
      expect(res).toBe(false)
    })

    it('should does format on type', async () => {
      let doc = await workspace.document
      disposables.push(languages.registerOnTypeFormattingEditProvider(['*'], {
        provideOnTypeFormattingEdits: () => {
          return [TextEdit.insert(Position.create(0, 0), '  ')]
        }
      }, ['|']))
      let res = await format.tryFormatOnType(';', doc)
      expect(res).toBe(false)
      await helper.edit()
      await nvim.input('i|')
      await helper.waitFor('getline', ['.'], '  |')
      let cursor = await window.getCursorPosition()
      expect(cursor).toEqual({ line: 0, character: 3 })
    })

    it('should return null when provider not found', async () => {
      let doc = await workspace.document
      let res = await languages.provideDocumentOnTypeEdits('|', doc.textDocument, Position.create(0, 0), CancellationToken.None)
      expect(res).toBeNull()
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
      await helper.edit()
      await nvim.command('setf text')
      await nvim.setLine('"')
      await nvim.input('i|')
      await helper.waitFor('getline', ['.'], '  |"end')
      let cursor = await window.getCursorPosition()
      expect(cursor).toEqual({ line: 0, character: 3 })
    })
  })

  describe('bracketEnterImprove', () => {
    afterEach(() => {
      nvim.command('iunmap <CR>', true)
    })

    it('should not throw for buffer not attached', async () => {
      await nvim.command(`edit +setl\\ buftype=nofile foo`)
      let doc = await workspace.document
      expect(doc.attached).toBe(false)
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
      expect(lines).toEqual(['let foo={', '  \\ ', '  \\ }'])
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
      await helper.waitFor('getline', [2], '  ')
      let lines = await buf.lines
      expect(lines).toEqual(['  {', '  ', '  }'])
    })
  })
})
