import { Neovim } from '@chemzqm/neovim'
import { Disposable, Position, TextEdit } from 'vscode-languageserver-protocol'
import languages from '../../languages'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import helper, { createTmpFile } from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []

beforeAll(async () => {
  let { configurations } = workspace
  configurations.updateUserConfig({ 'coc.preferences.formatOnType': true })
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
    }))
    let doc = await helper.createDocument()
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    await nvim.command('setf text')
    await nvim.command('normal! ggvG')
    await nvim.input('<esc>')
    await helper.doAction('formatSelected', 'v')
    let buf = nvim.createBuffer(doc.bufnr)
    let lines = await buf.lines
    expect(lines).toEqual(['  a', '  b', '  c'])
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
    helper.updateConfiguration('coc.preferences.formatOnSaveFiletypes', [])
  })

  it('should does format on type', async () => {
    disposables.push(languages.registerOnTypeFormattingEditProvider(['text'], {
      provideOnTypeFormattingEdits: () => {
        return [TextEdit.insert(Position.create(0, 0), '  ')]
      }
    }, ['|']))
    await helper.edit()
    await nvim.command('setf text')
    await nvim.input('i|')
    await helper.wait(200)
    let line = await nvim.line
    expect(line).toBe('  |')
    let cursor = await window.getCursorPosition()
    expect(cursor).toEqual({ line: 0, character: 3 })
  })

  it('should format on new line inserted', async () => {
    disposables.push(languages.registerOnTypeFormattingEditProvider(['text'], {
      provideOnTypeFormattingEdits: (doc, position) => {
        let text = doc.getText()
        if (text.startsWith(' ')) return []
        return [TextEdit.insert(Position.create(position.line, 0), '  ')]
      }
    }, ['\n']))
    let buf = await helper.edit()
    await nvim.command('setf text')
    await nvim.setLine('foo')
    await nvim.input('o')
    await helper.wait(100)
    let lines = await buf.lines
    expect(lines).toEqual(['  foo', ''])
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
    await helper.edit()
    await nvim.command('setf text')
    await nvim.setLine('"')
    await nvim.input('i|')
    await helper.wait(100)
    let line = await nvim.line
    expect(line).toBe('  |"end')
    let cursor = await window.getCursorPosition()
    expect(cursor).toEqual({ line: 0, character: 3 })
  })
})
