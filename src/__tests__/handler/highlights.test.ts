import { Neovim } from '@chemzqm/neovim'
import { Disposable, DocumentHighlightKind, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import commands from '../../commands'
import Highlights from '../../handler/highlights'
import languages from '../../languages'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
let highlights: Highlights

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  highlights = helper.plugin.handler.documentHighlighter
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
  disposeAll(disposables)
  disposables = []
})

function registerProvider(): void {
  disposables.push(languages.registerDocumentHighlightProvider([{ language: '*' }], {
    provideDocumentHighlights: async document => {
      let word = await nvim.eval('expand("<cword>")')
      // let word = document.get
      let matches = Array.from((document.getText() as any).matchAll(/\w+/g)) as any[]
      let filtered = matches.filter(o => o[0] == word)
      return filtered.map((o, i) => {
        let start = document.positionAt(o.index)
        let end = document.positionAt(o.index + o[0].length)
        return {
          range: Range.create(start, end),
          kind: i == 0 ? DocumentHighlightKind.Text : i % 2 == 0 ? DocumentHighlightKind.Read : DocumentHighlightKind.Write
        }
      }).concat([{ range: undefined, kind: 2 }])
    }
  }))
}

describe('document highlights', () => {
  function registerTimerProvider(fn: Function, timeout: number): void {
    disposables.push(languages.registerDocumentHighlightProvider([{ language: '*' }], {
      provideDocumentHighlights: (_document, _position, token) => {
        return new Promise(resolve => {
          token.onCancellationRequested(() => {
            clearTimeout(timer)
            fn()
            resolve([])
          })
          let timer = setTimeout(() => {
            resolve([{ range: Range.create(0, 0, 0, 3) }])
          }, timeout)
        })
      }
    }))
  }

  it('should not throw when no range to jump', async () => {
    let fn = jest.fn()
    registerTimerProvider(fn, 10)
    await commands.executeCommand('document.jumpToNextSymbol')
    await commands.executeCommand('document.jumpToPrevSymbol')
  })

  it('should jump to previous range', async () => {
    disposables.push(languages.registerDocumentHighlightProvider([{ language: '*' }], {
      provideDocumentHighlights: () => {
        return [{
          range: Range.create(0, 0, 0, 1),
          kind: DocumentHighlightKind.Read
        }, {
          range: Range.create(0, 2, 0, 3),
          kind: DocumentHighlightKind.Read
        }]
      }
    }))
    await nvim.setLine('foo bar')
    await nvim.command('normal! $')
    await commands.executeCommand('document.jumpToPrevSymbol')
    let cur = await window.getCursorPosition()
    expect(cur).toEqual(Position.create(0, 2))
    await commands.executeCommand('document.jumpToPrevSymbol')
    cur = await window.getCursorPosition()
    expect(cur).toEqual(Position.create(0, 0))
    await commands.executeCommand('document.jumpToPrevSymbol')
    cur = await window.getCursorPosition()
    expect(cur).toEqual(Position.create(0, 2))
  })

  it('should jump to next range', async () => {
    disposables.push(languages.registerDocumentHighlightProvider([{ language: '*' }], {
      provideDocumentHighlights: () => {
        return [{
          range: Range.create(0, 0, 0, 1),
          kind: DocumentHighlightKind.Read
        }, {
          range: Range.create(0, 2, 0, 3),
          kind: DocumentHighlightKind.Read
        }]
      }
    }))
    await nvim.setLine('foo bar')
    await nvim.command('normal! ^')
    await commands.executeCommand('document.jumpToNextSymbol')
    let cur = await window.getCursorPosition()
    expect(cur).toEqual(Position.create(0, 2))
    await commands.executeCommand('document.jumpToNextSymbol')
    cur = await window.getCursorPosition()
    expect(cur).toEqual(Position.create(0, 0))
    await commands.executeCommand('document.jumpToNextSymbol')
    cur = await window.getCursorPosition()
    expect(cur).toEqual(Position.create(0, 2))
  })

  it('should not throw when provide throws', async () => {
    disposables.push(languages.registerDocumentHighlightProvider([{ language: '*' }], {
      provideDocumentHighlights: () => {
        return null
      }
    }))
    disposables.push(languages.registerDocumentHighlightProvider([{ language: '*' }], {
      provideDocumentHighlights: () => {
        throw new Error('fake error')
      }
    }))
    disposables.push(languages.registerDocumentHighlightProvider([{ language: '*' }], {
      provideDocumentHighlights: () => {
        return [{
          range: Range.create(0, 0, 0, 3),
          kind: DocumentHighlightKind.Read
        }]
      }
    }))
    let doc = await workspace.document
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo')])
    let res = await highlights.getHighlights(doc, Position.create(0, 0))
    expect(res).toBeDefined()
  })

  it('should return null when highlights provide not exist', async () => {
    let doc = await workspace.document
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo')])
    let res = await highlights.getHighlights(doc, Position.create(0, 0))
    expect(res).toBeNull()
  })

  it('should cancel request on CursorMoved', async () => {
    let fn = jest.fn()
    registerTimerProvider(fn, 3000)
    await helper.edit()
    await nvim.setLine('foo')
    let p = highlights.highlight()
    await helper.wait(50)
    await nvim.call('cursor', [1, 2])
    await p
    expect(fn).toBeCalled()
  })

  it('should cancel on timeout', async () => {
    helper.updateConfiguration('documentHighlight.timeout', 10)
    let fn = jest.fn()
    registerTimerProvider(fn, 3000)
    await helper.edit()
    await nvim.setLine('foo')
    await highlights.highlight()
    expect(fn).toBeCalled()
  })

  it('should add highlights to symbols', async () => {
    registerProvider()
    await helper.createDocument()
    await nvim.setLine('foo bar foo foo bar')
    await helper.doAction('highlight')
    let winid = await nvim.call('win_getid') as number
    expect(highlights.hasHighlights(winid)).toBe(true)
  })

  it('should return highlight ranges', async () => {
    registerProvider()
    await helper.createDocument()
    await nvim.setLine('foo bar foo')
    let res = await helper.doAction('symbolRanges')
    expect(res.length).toBe(2)
  })

  it('should return null when cursor not in word range', async () => {
    disposables.push(languages.registerDocumentHighlightProvider([{ language: '*' }], {
      provideDocumentHighlights: () => {
        return [{ range: Range.create(0, 0, 0, 3) }]
      }
    }))
    let doc = await helper.createDocument()
    await nvim.setLine('  oo')
    await nvim.call('cursor', [1, 2])
    let res = await highlights.getHighlights(doc, Position.create(0, 0))
    expect(res).toBeNull()
  })

  it('should not throw when document is command line', async () => {
    await nvim.call('feedkeys', ['q:', 'in'])
    let doc = await workspace.document
    expect(doc.isCommandLine).toBe(true)
    await highlights.highlight()
    await nvim.input('<C-c>')
  })

  it('should not throw when provider not found', async () => {
    disposeAll(disposables)
    await helper.createDocument()
    await nvim.setLine('  oo')
    await nvim.call('cursor', [1, 2])
    await highlights.highlight()
  })
})
