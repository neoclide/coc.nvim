// Merged from index.test.ts, documentLinks.test.ts, highlights.test.ts,
// fold.test.ts, linkedEditing.test.ts and search.test.ts to share a single
// nvim session and reduce per-file startup overhead.
import { Neovim } from '../../neovim'
import path from 'path'
import { CancellationToken, CancellationTokenSource, Disposable, DocumentHighlightKind, DocumentLink, FoldingRange, Position, Range, SymbolKind, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import commands from '../../commands'
import events from '../../events'
import FoldHandler from '../../handler/fold'
import Handler from '../../handler/index'
import LinksHandler, { sameLinks } from '../../handler/links'
import LinkedEditingHandler from '../../handler/linkedEditing'
import Refactor from '../../handler/refactor'
import Search, { getPathFromArgs } from '../../handler/refactor/search'
import { toDocumentation } from '../../handler/util'
import Highlights from '../../handler/highlights'
import { ProviderName } from '../../languages'
import languages from '../../languages'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
let handler: Handler
let highlights: Highlights
let folds: FoldHandler
let linkedEditingHandler: LinkedEditingHandler
let links: LinksHandler
let refactor: Refactor
let wordPattern: string | undefined
let cmd = path.resolve(__dirname, '../rg')
let cwd = process.cwd()

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  handler = (helper.plugin as any).handler
  links = helper.plugin.getHandler().links
  highlights = helper.plugin.handler.documentHighlighter
  folds = helper.plugin.getHandler().fold
  linkedEditingHandler = helper.plugin.getHandler().linkedEditingHandler
  refactor = helper.plugin.getHandler().refactor
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  refactor.reset()
  disposeAll(disposables)
  disposables = []
  await helper.reset()
})

function registerHighlightProvider(): void {
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

async function registerLinkedEditingProvider(content: string, position: Position): Promise<void> {
  let doc = await workspace.document
  disposables.push(languages.registerLinkedEditingRangeProvider([{ language: '*' }], {
    provideLinkedEditingRanges: (doc, pos) => {
      let document = workspace.getDocument(doc.uri)
      let range = document.getWordRangeAtPosition(pos)
      if (!range) return null
      let text = doc.getText(range)
      let ranges: Range[] = document.getSymbolRanges(text)
      return { ranges, wordPattern }
    }
  }))
  await nvim.setLine(content)
  await doc.synchronize()
  await linkedEditingHandler.enable(doc, position)
}

async function matches(): Promise<number> {
  let list = await helper.getMatches('CocLinkedEditing')
  return list.length
}

describe('Handler', () => {
  beforeEach(async () => {
    await helper.createDocument()
  })
  describe('util', () => {
    it('should to documentation', () => {
      expect(toDocumentation('doc')).toEqual({ content: 'doc', filetype: 'txt' })
      expect(toDocumentation({ kind: 'markdown', value: 'doc' })).toEqual({ content: 'doc', filetype: 'markdown' })
    })
  })

  describe('hasProvider', () => {
    it('should check provider for document', async () => {
      let res = await helper.doAction('hasProvider', 'definition')
      expect(res).toBe(false)
      await nvim.command(`edit +setl\\ buftype=nofile foo`)
      res = await handler.hasProvider('formatOnType')
      expect(res).toBe(false)
    })
  })

  describe('getIcon', () => {
    it('should get icon', () => {
      helper.updateConfiguration('suggest.completionItemKindLabels', {
        default: 'd'
      })
      let res = handler.getIcon(SymbolKind.Array)
      expect(res).toBeDefined()
      res = handler.getIcon('a' as any)
      expect(res.text).toBe('d')
    })
  })

  describe('commands', () => {
    it('should open url', async () => {
      let fn = vi.fn()
      let spy = vi.spyOn(nvim, 'call').mockImplementation(() => {
        fn()
        return null
      })
      await commands.executeCommand('vscode.open', 'http://www.example.com')
      spy.mockRestore()
      expect(fn).toHaveBeenCalled()
    })

    it('should restart', async () => {
      let fn = vi.fn()
      let spy = vi.spyOn(nvim, 'command').mockImplementation(() => {
        fn()
        return null
      })
      await commands.executeCommand('workbench.action.reloadWindow')
      spy.mockRestore()
      expect(fn).toHaveBeenCalled()
    })
  })

  describe('checkProvider', () => {
    it('should throw error when provider not found', async () => {
      let doc = await helper.createDocument()
      let err
      try {
        handler.checkProvider(ProviderName.Definition, doc.textDocument)
      } catch (e) {
        err = e
      }
      expect(err).toBeDefined()
    })
  })

  describe('withRequestToken', () => {
    it('should cancel previous request when called again', async () => {
      let cancelled = false
      let p = handler.withRequestToken('test', token => {
        return new Promise(s => {
          token.onCancellationRequested(() => {
            cancelled = true
            clearTimeout(timer)
            s(undefined)
          })
          let timer = setTimeout(() => {
            s(undefined)
          }, 3000)
        })
      }, false)
      setTimeout(async () => {
        await handler.withRequestToken('test', () => {
          return Promise.resolve(undefined)
        }, false)
      }, 50)
      await p
      expect(cancelled).toBe(true)
    })

    it('should cancel request on insert start', async () => {
      let cancelled = false
      let p = handler.withRequestToken('test', token => {
        return new Promise(s => {
          token.onCancellationRequested(() => {
            cancelled = true
            clearTimeout(timer)
            s(undefined)
          })
          let timer = setTimeout(() => {
            s(undefined)
          }, 3000)
        })
      }, false)
      await nvim.input('i')
      await p
      expect(cancelled).toBe(true)
    })

    it('should not dispose newer token source when stale request completes', async () => {
      let releaseFirst: (value?: undefined) => void
      let releaseSecond: (value?: undefined) => void
      let p1 = handler.withRequestToken('test', () => new Promise<undefined>(s => {
        releaseFirst = s
      }), false)
      let p2 = handler.withRequestToken('test', () => new Promise<undefined>(s => {
        releaseSecond = s
      }), false)
      let current = (handler as any).requestTokenSource
      expect(current).toBeDefined()
      releaseFirst(undefined)
      await p1
      // The stale request must not tear down the newer request's token source.
      expect((handler as any).requestTokenSource).toBe(current)
      releaseSecond(undefined)
      await p2
      expect((handler as any).requestTokenSource).toBeUndefined()
    })
  })
})

describe('Links', () => {
  it('should check sameLinks', () => {
    expect(sameLinks([], [])).toBe(true)
    expect(sameLinks([{ range: Range.create(0, 0, 0, 1) }], [])).toBe(false)
    expect(sameLinks([{ range: Range.create(0, 0, 0, 1) }], [{ range: Range.create(0, 0, 1, 0) }])).toBe(false)
  })

  it('should get document links', async () => {
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks: (_doc, _token) => {
        return [
          DocumentLink.create(Range.create(0, 0, 0, 5), 'test:///foo'),
          DocumentLink.create(Range.create(1, 0, 1, 5), 'test:///bar')
        ]
      }
    }))
    let res = await helper.doAction('links')
    expect(res.length).toBe(2)
  })

  it('should merge link results', async () => {
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks: () => {
        return [
          DocumentLink.create(Range.create(0, 0, 0, 5), 'test:///foo'),
          DocumentLink.create(Range.create(1, 0, 1, 5), 'test:///bar')
        ]
      }
    }))
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks: () => {
        return [
          DocumentLink.create(Range.create(1, 0, 1, 5), 'test:///bar'),
          DocumentLink.create(Range.create(2, 0, 2, 5), 'test:///x'),
        ]
      }
    }))
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks: () => {
        return null
      }
    }))
    let res = await links.getLinks()
    expect(res.length).toBe(3)
    let link = await languages.resolveDocumentLink(res[0], CancellationToken.None)
    expect(link).toBeDefined()
  })

  it('should throw error when link target not resolved', async () => {
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks(_doc, _token) {
        return [
          DocumentLink.create(Range.create(0, 0, 0, 5))
        ]
      },
      resolveDocumentLink(link) {
        return link
      }
    }))
    let res = await links.getLinks()
    let err
    try {
      await links.openLink(res[0])
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })

  it('should return link when resolve undefined', async () => {
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks(_doc, _token) {
        return [DocumentLink.create(Range.create(0, 0, 0, 5), 'foo://1')]
      },
      resolveDocumentLink() {
        return undefined
      }
    }))
    let res = await links.getLinks()
    let link = await languages.resolveDocumentLink(res[0], CancellationToken.None)
    expect(link).toBeDefined()
  })

  it('should cancel resolve on InsertEnter', async () => {
    helper.updateConfiguration('links.tooltip', true)
    let doc = await workspace.document
    let called = false
    let cancelled = false
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks(_doc, _token) {
        return [DocumentLink.create(Range.create(0, 0, 0, 5))]
      },
      resolveDocumentLink(link, token) {
        called = true
        return new Promise(resolve => {
          token.onCancellationRequested(() => {
            cancelled = true
            clearTimeout(timer)
            resolve(undefined)
          })
          let timer = setTimeout(() => {
            resolve(link)
          }, 500)
        })
      }
    }))
    let p = links.showTooltip()
    await helper.waitValue(() => {
      return called
    }, true)
    await events.fire('InsertEnter', [doc.bufnr])
    await p
    expect(cancelled).toBe(true)
  })

  it('should open link at current position', async () => {
    await nvim.setLine('foo')
    await nvim.command('normal! 0')
    disposables.push(workspace.registerTextDocumentContentProvider('test', {
      provideTextDocumentContent: () => {
        return 'test'
      }
    }))
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks(_doc, _token) {
        return [
          DocumentLink.create(Range.create(0, 0, 0, 5)),
        ]
      },
      resolveDocumentLink(link) {
        link.target = 'test:///foo'
        return link
      }
    }))
    await helper.doAction('openLink')
    let bufname = await nvim.call('bufname', '%')
    expect(bufname).toBe('test:///foo')
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    await nvim.call('cursor', [3, 1])
    let res = await links.openCurrentLink()
    expect(res).toBe(false)
  })

  it('should return false when current links not found', async () => {
    await nvim.setLine('foo')
    await nvim.command('normal! 0')
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks(_doc, _token) {
        return []
      }
    }))
    let res = await links.openCurrentLink()
    expect(res).toBe(false)
  })

  it('should show tooltip', async () => {
    await nvim.setLine('foo')
    await nvim.call('cursor', [1, 1])
    let resolve = false
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks(_doc, _token) {
        let link = DocumentLink.create(Range.create(0, 0, 0, 5))
        link.tooltip = 'test'
        return [link]
      },
      resolveDocumentLink(link) {
        if (!resolve) return
        link.target = 'http://example.com'
        return link
      }
    }))
    await links.showTooltip()
    let win = await helper.getFloat()
    expect(win).toBeUndefined()
    helper.updateConfiguration('links.tooltip', true)
    await links.showTooltip()
    win = await helper.getFloat()
    expect(win).toBeUndefined()
    resolve = true
    await links.showTooltip()
    win = await helper.getFloat()
    let buf = await win.buffer
    let lines = await buf.lines
    expect(lines[0]).toMatch('test')
  })

  it('should enable tooltip on CursorHold', async () => {
    let doc = await workspace.document
    helper.updateConfiguration('links.tooltip', true)
    await nvim.setLine('http://www.baidu.com')
    await nvim.call('cursor', [1, 1])
    let link = await links.getCurrentLink()
    expect(link).toBeDefined()
    await events.fire('CursorHold', [doc.bufnr])
    let win = await helper.getFloat()
    let buf = await win.buffer
    let lines = await buf.lines
    expect(lines[0]).toMatch('baidu')
  })
})

describe('LinkBuffer', () => {
  it('should getLinks', async () => {
    let doc = await workspace.document
    let buf = links.getBuffer(doc.bufnr)
    await buf.getLinks()
    expect(buf.links).toEqual([])
    let timeout = 100
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks: (_doc, token) => {
        return new Promise(resolve => {
          token.onCancellationRequested(() => {
            clearTimeout(timer)
            resolve(undefined)
          })
          let timer = setTimeout(() => {
            resolve([
              DocumentLink.create(Range.create(0, 0, 0, 5), 'test:///foo'),
              DocumentLink.create(Range.create(1, 0, 1, 5), 'test:///bar')
            ])
          }, timeout)
        })
      }
    }))
    let p = buf.getLinks()
    p = buf.getLinks()
    buf.cancel()
    await p
    expect(buf.links).toEqual([])
  })

  it('should do highlight', async () => {
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks: (doc: TextDocument) => {
        let links: DocumentLink[] = []
        for (let i = 0; i < doc.lineCount - 1; i++) {
          links.push(DocumentLink.create(Range.create(i, 0, i, 1), 'test:///bar'))
        }
        return links
      }
    }))
    helper.updateConfiguration('links.highlight', true)
    let doc = await helper.createDocument()
    await nvim.setLine('foo')
    await doc.synchronize()
    let buf = links.getBuffer(doc.bufnr)
    await helper.waitValue(() => {
      return buf.links?.length
    }, 1)
    await nvim.call('append', [0, ['foo']])
    doc._forceSync()
    await helper.waitValue(() => {
      return buf.links?.length
    }, 2)
    await nvim.setLine('foo')
    doc._forceSync()
    let hls = await buf.buffer.getHighlights('links')
    expect(hls.length).toBe(2)
  })
})

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
    let fn = vi.fn()
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
    let fn = vi.fn()
    registerTimerProvider(fn, 3000)
    await helper.edit()
    await nvim.setLine('foo')
    let p = highlights.highlight()
    await helper.wait(20)
    await nvim.call('cursor', [1, 2])
    await p
    expect(fn).toHaveBeenCalled()
  })

  it('should cancel on timeout', async () => {
    helper.updateConfiguration('documentHighlight.timeout', 10)
    let fn = vi.fn()
    registerTimerProvider(fn, 3000)
    await helper.edit()
    await nvim.setLine('foo')
    await highlights.highlight()
    expect(fn).toHaveBeenCalled()
  })

  it('should add highlights to symbols', async () => {
    registerHighlightProvider()
    await helper.createDocument()
    await nvim.setLine('foo bar foo foo bar')
    await helper.doAction('highlight')
    let winid = await nvim.call('win_getid') as number
    expect(highlights.hasHighlights(winid)).toBe(true)
  })

  it('should return highlight ranges', async () => {
    registerHighlightProvider()
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

describe('Folds', () => {
  beforeEach(async () => {
    await helper.createDocument()
  })
  it('should return empty array when provider does not exist', async () => {
    let doc = await workspace.document
    let token = (new CancellationTokenSource()).token
    expect(await languages.provideFoldingRanges(doc.textDocument, {}, token)).toEqual([])
  })

  it('should return false when no fold ranges found', async () => {
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges(_doc) {
        return []
      }
    }))
    await helper.wait(20)
    let res = await helper.doAction('fold')
    expect(res).toBe(false)
  })

  it('should fold all fold ranges', async () => {
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges(_doc) {
        return [FoldingRange.create(1, 3), FoldingRange.create(4, 6, 0, 0, 'comment')]
      }
    }))
    await helper.wait(20)
    await nvim.call('setline', [1, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']])
    let res = await folds.fold()
    expect(res).toBe(true)
    let closed = await nvim.call('foldclosed', [2])
    expect(closed).toBe(2)
    closed = await nvim.call('foldclosed', [5])
    expect(closed).toBe(5)
  })

  it('should merge folds from all providers', async () => {
    let doc = await workspace.document
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges() {
        return [FoldingRange.create(2, 3), FoldingRange.create(4, 6)]
      }
    }))
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges() {
        return [FoldingRange.create(1, 2), FoldingRange.create(5, 6), FoldingRange.create(7, 8)]
      }
    }))
    await helper.wait(20)
    await nvim.call('setline', [1, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']])
    await doc.synchronize()
    let foldingRanges = await languages.provideFoldingRanges(doc.textDocument, {}, CancellationToken.None)
    expect(foldingRanges.length).toBe(4)
  })

  it('should ignore range start at the same line', async () => {
    let doc = await workspace.document
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges() {
        return [FoldingRange.create(2, 3), FoldingRange.create(4, 6)]
      }
    }))
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges() {
        return [FoldingRange.create(4, 5)]
      }
    }))
    await helper.wait(20)
    await nvim.call('setline', [1, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']])
    await doc.synchronize()
    let foldingRanges = await languages.provideFoldingRanges(doc.textDocument, {}, CancellationToken.None)
    expect(foldingRanges.length).toBe(2)
  })

  it('should fold comment ranges', async () => {
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges(_doc) {
        return [FoldingRange.create(1, 3), FoldingRange.create(4, 6, 0, 0, 'comment')]
      }
    }))
    await helper.wait(20)
    await nvim.call('setline', [1, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']])
    let res = await folds.fold('comment')
    expect(res).toBe(true)
    let closed = await nvim.call('foldclosed', [2])
    expect(closed).toBe(-1)
    closed = await nvim.call('foldclosed', [5])
    expect(closed).toBe(5)
  })
})

describe('LinkedEditing', () => {
  beforeEach(async () => {
    helper.updateConfiguration('coc.preferences.enableLinkedEditing', true)
  })
  it('should active and cancel on cursor moved', async () => {
    await registerLinkedEditingProvider('foo foo a ', Position.create(0, 0))
    expect(await matches()).toBe(2)
    await nvim.command(`normal! $`)
    await helper.waitValue(() => {
      return matches()
    }, 0)
  })

  it('should active when moved to another word', async () => {
    await registerLinkedEditingProvider('foo foo bar bar bar', Position.create(0, 0))
    await nvim.call('cursor', [1, 9])
    await helper.waitValue(() => {
      return matches()
    }, 3)
  })

  it('should active on text change', async () => {
    let doc = await workspace.document
    await registerLinkedEditingProvider('foo foo a ', Position.create(0, 0))
    await nvim.call('cursor', [1, 1])
    await nvim.call('nvim_buf_set_text', [doc.bufnr, 0, 0, 0, 0, ['i']])
    await doc.synchronize()
    let line = await nvim.line
    expect(line).toBe('ifoo ifoo a ')
    await nvim.call('nvim_buf_set_text', [doc.bufnr, 0, 0, 0, 1, []])
    await doc.synchronize()
    line = await nvim.line
    expect(line).toBe('foo foo a ')
  })

  it('should cancel when change out of range', async () => {
    let doc = await workspace.document
    await registerLinkedEditingProvider('foo foo bar', Position.create(0, 0))
    await helper.waitValue(() => {
      return matches()
    }, 2)
    await nvim.call('nvim_buf_set_text', [doc.bufnr, 0, 9, 0, 10, ['']])
    await doc.synchronize()
    await helper.waitValue(() => {
      return matches()
    }, 0)
  })

  it('should not cancel when insert line break before range', async () => {
    let doc = await workspace.document
    await registerLinkedEditingProvider('foo foo bar', Position.create(0, 0))
    await helper.waitValue(() => {
      return matches()
    }, 2)
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), '\n')])
    await helper.waitValue(() => matches(), 2)
  })

  it('should cancel when insert line break in range', async () => {
    let doc = await workspace.document
    await registerLinkedEditingProvider('foo foo bar', Position.create(0, 0))
    await helper.waitValue(() => {
      return matches()
    }, 2)
    await doc.applyEdits([TextEdit.insert(Position.create(0, 1), '\n  ')])
    await helper.waitValue(() => {
      return matches()
    }, 0)
  })

  it('should cancel on editor change', async () => {
    await registerLinkedEditingProvider('foo foo a ', Position.create(0, 0))
    await nvim.command(`enew`)
    await helper.wait(20)
    await helper.waitValue(() => {
      return matches()
    }, 0)
  })

  it('should cancel when insert none word character', async () => {
    await registerLinkedEditingProvider('foo foo a ', Position.create(0, 0))
    await nvim.call('cursor', [1, 4])
    await nvim.input('i')
    await nvim.input('a')
    await helper.waitValue(() => {
      return matches()
    }, 2)
    await nvim.input('i')
    await nvim.input('@')
    await helper.waitValue(() => {
      return matches()
    }, 0)
  })

  it('should cancel when insert not match wordPattern', async () => {
    wordPattern = '[A-Z]'
    await registerLinkedEditingProvider('foo foo a ', Position.create(0, 0))
    await nvim.call('cursor', [1, 4])
    await nvim.input('i')
    await nvim.input('A')
    await helper.waitValue(() => {
      return matches()
    }, 2)
    await nvim.input('i')
    await nvim.input('3')
    await helper.waitValue(() => {
      return matches()
    }, 0)
  })

  it('should cancel request on cursor moved', async () => {
    disposables.push(languages.registerLinkedEditingRangeProvider([{ language: '*' }], {
      provideLinkedEditingRanges: (doc, pos, token) => {
        return new Promise(resolve => {
          token.onCancellationRequested(() => {
            clearTimeout(timer)
            resolve(null)
          })
          let timer = setTimeout(() => {
            let document = workspace.getDocument(doc.uri)
            let range = document.getWordRangeAtPosition(pos)
            if (!range) return resolve(null)
            let text = doc.getText(range)
            let ranges: Range[] = document.getSymbolRanges(text)
            resolve({ ranges, wordPattern })
          }, 1000)
        })
      }
    }))
    let doc = await workspace.document
    await nvim.setLine('foo foo  ')
    await doc.synchronize()
    await nvim.call('cursor', [1, 2])
    await helper.wait(20)
    await nvim.call('cursor', [1, 9])
    await helper.waitValue(() => {
      return matches()
    }, 0)
  })
})

describe('getPathFromArgs', () => {
  it('should get undefined path', async () => {
    let res = getPathFromArgs(['a'])
    expect(res).toBeUndefined()
    res = getPathFromArgs(['a', 'b', '-c'])
    expect(res).toBeUndefined()
    res = getPathFromArgs(['a', '-b', 'c'])
    expect(res).toBeUndefined()
  })
})

describe('search', () => {

  it('should open refactor window', async () => {
    let search = new Search(nvim, cmd)
    let buf = await refactor.createRefactorBuffer()
    await search.run([], cwd, buf)
    await helper.wait(20)
    let fileItems = buf.fileItems
    expect(fileItems.length).toBe(2)
    expect(fileItems[0].ranges.length).toBe(2)
  })

  it('should abort task', async () => {
    let search = new Search(nvim, cmd)
    let buf = await refactor.createRefactorBuffer()
    let p = search.run(['--sleep', '1000'], cwd, buf)
    search.abort()
    await p
    let fileItems = buf.fileItems
    expect(fileItems.length).toBe(0)
  })

  it('should work with CocAction search', async () => {
    await helper.doAction('search', ['CocAction'])
    let bufnr = await nvim.call('bufnr', ['%']) as number
    let buf = refactor.getBuffer(bufnr)
    expect(buf).toBeDefined()
  })

  it('should fail on invalid command', async () => {
    let search = new Search(nvim, 'rrg')
    let buf = await refactor.createRefactorBuffer()
    let err
    try {
      await search.run([], cwd, buf)
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
    let msg = await helper.getCmdline()
    expect(msg).toMatch(/Error on command "rrg"/)
  })

  it('should show empty result when no result found', async () => {
    await helper.doAction('search', ['should found ' + ' no result'])
    let bufnr = await nvim.call('bufnr', ['%']) as number
    let buf = refactor.getBuffer(bufnr)
    expect(buf).toBeDefined()
    let buffer = await nvim.buffer
    let lines = await buffer.lines
    expect(lines[1]).toMatch(/No match found/)
  })

  it('should use current search folder for rg', async () => {
    let search = new Search(nvim, 'rg')
    await helper.createDocument()
    let buf = await refactor.createRefactorBuffer()
    await search.run(['-w', 'createRefactorBuffer', 'src/__tests__'], cwd, buf)
    let buffer = await nvim.buffer
    let lines = await buffer.lines
    expect(lines[1].startsWith('Files: ')).toBe(true)
  })
})
