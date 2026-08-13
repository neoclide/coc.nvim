import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
// Merged from index.test.ts, documentLinks.test.ts, highlights.test.ts,
// fold.test.ts, linkedEditing.test.ts and search.test.ts to share a single
// nvim session and reduce per-file startup overhead.
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
import { Neovim } from '@chemzqm/neovim'
import path from 'path'
import { CancellationToken, CancellationTokenSource, Disposable, DocumentHighlightKind, DocumentLink, FoldingRange, Position, Range, SymbolKind, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'


let nvim: Neovim
let disposables: Disposable[] = []
let handler: Handler
let highlights: Highlights
let folds: FoldHandler
let linkedEditingHandler: LinkedEditingHandler
let links: LinksHandler
let refactor: Refactor
let wordPattern: string | undefined
let cmd = path.resolve(import.meta.dirname, '../rg')
let cwd = process.cwd()

before(async () => {
  nvim = workspace.nvim
  handler = (getCurrentPlugin() as any).handler
  links = getCurrentPlugin().getHandler().links
  highlights = getCurrentPlugin().handler.documentHighlighter
  folds = getCurrentPlugin().getHandler().fold
  linkedEditingHandler = getCurrentPlugin().getHandler().linkedEditingHandler
  refactor = getCurrentPlugin().getHandler().refactor
})

afterEach(async () => {
  refactor.reset()
  disposeAll(disposables)
  disposables = []
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
      // A delayed linked-editing request can arrive after the editor reset
      // wiped the buffer; treat a missing document as no provider result
      // instead of crashing an async continuation after the test ended.
      if (!document) return null
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
  let list = await shared.getMatches('CocLinkedEditing')
  return list.length
}

describe('Handler', () => {
  afterEach(editorReset)

  beforeEach(async () => {
    await shared.createDocument()
  })
  describe('util', () => {
    it('should to documentation', t => {
      assert.deepStrictEqual(toDocumentation('doc'), { content: 'doc', filetype: 'txt' })
      assert.deepStrictEqual(toDocumentation({ kind: 'markdown', value: 'doc' }), { content: 'doc', filetype: 'markdown' })
    })
  })

  describe('hasProvider', () => {
    it('should check provider for document', async t => {
      let res = await shared.doAction('hasProvider', 'definition')
      assert.strictEqual(res, false)
      await nvim.command(`edit +setl\\ buftype=nofile foo`)
      res = await handler.hasProvider('formatOnType')
      assert.strictEqual(res, false)
    })
  })

  describe('getIcon', () => {
    it('should get icon', t => {
      shared.updateConfiguration('suggest.completionItemKindLabels', {
        default: 'd'
      })
      let res = handler.getIcon(SymbolKind.Array)
      assert.notStrictEqual(res, undefined)
      res = handler.getIcon('a' as any)
      assert.strictEqual(res.text, 'd')
    })
  })

  describe('commands', () => {
    it('should open url', async t => {
      let fn = t.mock.fn()
      let spy = t.mock.method(nvim, 'call', () => {
        fn()
        return Promise.resolve(null)
      })
      await commands.executeCommand('vscode.open', 'http://www.example.com')
      assert.ok(fn.mock.calls.length > 0)
    })

    it('should restart', async t => {
      let fn = t.mock.fn()
      let spy = t.mock.method(nvim, 'command', () => {
        fn()
        return Promise.resolve(null)
      })
      await commands.executeCommand('workbench.action.reloadWindow')
      assert.ok(fn.mock.calls.length > 0)
    })
  })

  describe('checkProvider', () => {
    it('should throw error when provider not found', async t => {
      let doc = await shared.createDocument()
      let err
      try {
        handler.checkProvider(ProviderName.Definition, doc.textDocument)
      } catch (e) {
        err = e
      }
      assert.notStrictEqual(err, undefined)
    })
  })

  describe('withRequestToken', () => {
    it('should cancel previous request when called again', async t => {
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
      assert.strictEqual(cancelled, true)
    })

    it('should cancel request on insert start', async t => {
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
      assert.strictEqual(cancelled, true)
    })

    it('should not dispose newer token source when stale request completes', async t => {
      let releaseFirst: (value?: undefined) => void
      let releaseSecond: (value?: undefined) => void
      let p1 = handler.withRequestToken('test', () => new Promise<undefined>(s => {
        releaseFirst = s
      }), false)
      let p2 = handler.withRequestToken('test', () => new Promise<undefined>(s => {
        releaseSecond = s
      }), false)
      let current = (handler as any).requestTokenSource
      assert.notStrictEqual(current, undefined)
      releaseFirst(undefined)
      await p1
      // The stale request must not tear down the newer request's token source.
      assert.strictEqual((handler as any).requestTokenSource, current)
      releaseSecond(undefined)
      await p2
      assert.strictEqual((handler as any).requestTokenSource, undefined)
    })
  })
})

describe('Links', () => {
  afterEach(editorReset)

  it('should check sameLinks', t => {
    assert.strictEqual(sameLinks([], []), true)
    assert.strictEqual(sameLinks([{ range: Range.create(0, 0, 0, 1) }], []), false)
    assert.strictEqual(sameLinks([{ range: Range.create(0, 0, 0, 1) }], [{ range: Range.create(0, 0, 1, 0) }]), false)
  })

  it('should get document links', async t => {
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks: (_doc, _token) => {
        return [
          DocumentLink.create(Range.create(0, 0, 0, 5), 'test:///foo'),
          DocumentLink.create(Range.create(1, 0, 1, 5), 'test:///bar')
        ]
      }
    }))
    let res = await shared.doAction('links')
    assert.strictEqual(res.length, 2)
  })

  it('should merge link results', async t => {
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
    assert.strictEqual(res.length, 3)
    let link = await languages.resolveDocumentLink(res[0], CancellationToken.None)
    assert.notStrictEqual(link, undefined)
  })

  it('should throw error when link target not resolved', async t => {
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
    assert.notStrictEqual(err, undefined)
  })

  it('should return link when resolve undefined', async t => {
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
    assert.notStrictEqual(link, undefined)
  })

  it('should cancel resolve on InsertEnter', async t => {
    shared.updateConfiguration('links.tooltip', true)
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
    await shared.waitValue(() => {
      return called
    }, true)
    await events.fire('InsertEnter', [doc.bufnr])
    await p
    assert.strictEqual(cancelled, true)
  })

  it('should open link at current position', async t => {
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
    await shared.doAction('openLink')
    let bufname = await nvim.call('bufname', '%')
    assert.strictEqual(bufname, 'test:///foo')
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    await nvim.call('cursor', [3, 1])
    let res = await links.openCurrentLink()
    assert.strictEqual(res, false)
  })

  it('should return false when current links not found', async t => {
    await nvim.setLine('foo')
    await nvim.command('normal! 0')
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks(_doc, _token) {
        return []
      }
    }))
    let res = await links.openCurrentLink()
    assert.strictEqual(res, false)
  })

  it('should show tooltip', async t => {
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
    let win = await shared.getFloat()
    assert.strictEqual(win, undefined)
    shared.updateConfiguration('links.tooltip', true)
    await links.showTooltip()
    win = await shared.getFloat()
    assert.strictEqual(win, undefined)
    resolve = true
    await links.showTooltip()
    win = await shared.getFloat()
    let buf = await win.buffer
    let lines = await buf.lines
    assert.match(lines[0], new RegExp('test'))
  })

  it('should enable tooltip on CursorHold', async t => {
    let doc = await workspace.document
    shared.updateConfiguration('links.tooltip', true)
    await nvim.setLine('http://www.baidu.com')
    await nvim.call('cursor', [1, 1])
    let link = await links.getCurrentLink()
    assert.notStrictEqual(link, undefined)
    await events.fire('CursorHold', [doc.bufnr])
    let win = await shared.getFloat()
    let buf = await win.buffer
    let lines = await buf.lines
    assert.match(lines[0], new RegExp('baidu'))
  })
})

describe('LinkBuffer', () => {
  afterEach(editorReset)

  it('should getLinks', async t => {
    let doc = await workspace.document
    let buf = links.getBuffer(doc.bufnr)
    await buf.getLinks()
    assert.deepStrictEqual(buf.links, [])
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
    assert.deepStrictEqual(buf.links, [])
  })

  it('should do highlight', async t => {
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks: (doc: TextDocument) => {
        let links: DocumentLink[] = []
        for (let i = 0; i < doc.lineCount - 1; i++) {
          links.push(DocumentLink.create(Range.create(i, 0, i, 1), 'test:///bar'))
        }
        return links
      }
    }))
    shared.updateConfiguration('links.highlight', true)
    let doc = await shared.createDocument()
    await nvim.setLine('foo')
    await doc.synchronize()
    let buf = links.getBuffer(doc.bufnr)
    await shared.waitValue(() => {
      return buf.links?.length
    }, 1)
    await nvim.call('append', [0, ['foo']])
    doc._forceSync()
    await shared.waitValue(() => {
      return buf.links?.length
    }, 2)
    await nvim.setLine('foo')
    doc._forceSync()
    let hls = await buf.buffer.getHighlights('links')
    assert.strictEqual(hls.length, 2)
  })
})

describe('document highlights', () => {
  afterEach(editorReset)

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

  it('should not throw when no range to jump', async t => {
    let fn = t.mock.fn()
    registerTimerProvider(fn, 10)
    await commands.executeCommand('document.jumpToNextSymbol')
    await commands.executeCommand('document.jumpToPrevSymbol')
  })

  it('should jump to previous range', async t => {
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
    assert.deepStrictEqual(cur, Position.create(0, 2))
    await commands.executeCommand('document.jumpToPrevSymbol')
    cur = await window.getCursorPosition()
    assert.deepStrictEqual(cur, Position.create(0, 0))
    await commands.executeCommand('document.jumpToPrevSymbol')
    cur = await window.getCursorPosition()
    assert.deepStrictEqual(cur, Position.create(0, 2))
  })

  it('should jump to next range', async t => {
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
    assert.deepStrictEqual(cur, Position.create(0, 2))
    await commands.executeCommand('document.jumpToNextSymbol')
    cur = await window.getCursorPosition()
    assert.deepStrictEqual(cur, Position.create(0, 0))
    await commands.executeCommand('document.jumpToNextSymbol')
    cur = await window.getCursorPosition()
    assert.deepStrictEqual(cur, Position.create(0, 2))
  })

  it('should not throw when provide throws', async t => {
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
    assert.notStrictEqual(res, undefined)
  })

  it('should return null when highlights provide not exist', async t => {
    let doc = await workspace.document
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo')])
    let res = await highlights.getHighlights(doc, Position.create(0, 0))
    assert.strictEqual(res, null)
  })

  it('should cancel request on CursorMoved', async t => {
    let fn = t.mock.fn()
    registerTimerProvider(fn, 3000)
    await shared.edit()
    await nvim.setLine('foo')
    let p = highlights.highlight()
    await shared.wait(20)
    await nvim.call('cursor', [1, 2])
    await p
    assert.ok(fn.mock.calls.length > 0)
  })

  it('should cancel on timeout', async t => {
    shared.updateConfiguration('documentHighlight.timeout', 10)
    let fn = t.mock.fn()
    registerTimerProvider(fn, 3000)
    await shared.edit()
    await nvim.setLine('foo')
    await highlights.highlight()
    assert.ok(fn.mock.calls.length > 0)
  })

  it('should add highlights to symbols', async t => {
    registerHighlightProvider()
    await shared.createDocument()
    await nvim.setLine('foo bar foo foo bar')
    await shared.doAction('highlight')
    let winid = await nvim.call('win_getid') as number
    assert.strictEqual(highlights.hasHighlights(winid), true)
  })

  it('should return highlight ranges', async t => {
    registerHighlightProvider()
    await shared.createDocument()
    await nvim.setLine('foo bar foo')
    let res = await shared.doAction('symbolRanges')
    assert.strictEqual(res.length, 2)
  })

  it('should return null when cursor not in word range', async t => {
    disposables.push(languages.registerDocumentHighlightProvider([{ language: '*' }], {
      provideDocumentHighlights: () => {
        return [{ range: Range.create(0, 0, 0, 3) }]
      }
    }))
    let doc = await shared.createDocument()
    await nvim.setLine('  oo')
    await nvim.call('cursor', [1, 2])
    let res = await highlights.getHighlights(doc, Position.create(0, 0))
    assert.strictEqual(res, null)
  })

  it('should not throw when document is command line', async t => {
    await nvim.call('feedkeys', ['q:', 'in'])
    let doc = await workspace.document
    assert.strictEqual(doc.isCommandLine, true)
    await highlights.highlight()
    await nvim.input('<C-c>')
  })

  it('should not throw when provider not found', async t => {
    disposeAll(disposables)
    await shared.createDocument()
    await nvim.setLine('  oo')
    await nvim.call('cursor', [1, 2])
    await highlights.highlight()
  })
})

describe('Folds', () => {
  afterEach(editorReset)

  beforeEach(async () => {
    await shared.createDocument()
  })
  it('should return empty array when provider does not exist', async t => {
    let doc = await workspace.document
    let token = (new CancellationTokenSource()).token
    assert.deepStrictEqual(await languages.provideFoldingRanges(doc.textDocument, {}, token), [])
  })

  it('should return false when no fold ranges found', async t => {
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges(_doc) {
        return []
      }
    }))
    await shared.wait(20)
    let res = await shared.doAction('fold')
    assert.strictEqual(res, false)
  })

  it('should fold all fold ranges', async t => {
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges(_doc) {
        return [FoldingRange.create(1, 3), FoldingRange.create(4, 6, 0, 0, 'comment')]
      }
    }))
    await shared.wait(20)
    await nvim.call('setline', [1, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']])
    let res = await folds.fold()
    assert.strictEqual(res, true)
    let closed = await nvim.call('foldclosed', [2])
    assert.strictEqual(closed, 2)
    closed = await nvim.call('foldclosed', [5])
    assert.strictEqual(closed, 5)
  })

  it('should merge folds from all providers', async t => {
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
    await shared.wait(20)
    await nvim.call('setline', [1, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']])
    await doc.synchronize()
    let foldingRanges = await languages.provideFoldingRanges(doc.textDocument, {}, CancellationToken.None)
    assert.strictEqual(foldingRanges.length, 4)
  })

  it('should ignore range start at the same line', async t => {
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
    await shared.wait(20)
    await nvim.call('setline', [1, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']])
    await doc.synchronize()
    let foldingRanges = await languages.provideFoldingRanges(doc.textDocument, {}, CancellationToken.None)
    assert.strictEqual(foldingRanges.length, 2)
  })

  it('should fold comment ranges', async t => {
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges(_doc) {
        return [FoldingRange.create(1, 3), FoldingRange.create(4, 6, 0, 0, 'comment')]
      }
    }))
    await shared.wait(20)
    await nvim.call('setline', [1, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']])
    let res = await folds.fold('comment')
    assert.strictEqual(res, true)
    let closed = await nvim.call('foldclosed', [2])
    assert.strictEqual(closed, -1)
    closed = await nvim.call('foldclosed', [5])
    assert.strictEqual(closed, 5)
  })
})

describe('LinkedEditing', () => {
  afterEach(editorReset)

  beforeEach(async () => {
    shared.updateConfiguration('coc.preferences.enableLinkedEditing', true)
  })
  it('should active and cancel on cursor moved', async t => {
    await registerLinkedEditingProvider('foo foo a ', Position.create(0, 0))
    assert.strictEqual(await matches(), 2)
    await nvim.command(`normal! $`)
    await shared.waitValue(() => {
      return matches()
    }, 0)
  })

  it('should active when moved to another word', async t => {
    await registerLinkedEditingProvider('foo foo bar bar bar', Position.create(0, 0))
    await nvim.call('cursor', [1, 9])
    await shared.waitValue(() => {
      return matches()
    }, 3)
  })

  it('should active on text change', async t => {
    let doc = await workspace.document
    await registerLinkedEditingProvider('foo foo a ', Position.create(0, 0))
    await nvim.call('cursor', [1, 1])
    await nvim.call('nvim_buf_set_text', [doc.bufnr, 0, 0, 0, 0, ['i']])
    await doc.synchronize()
    let line = await nvim.line
    assert.strictEqual(line, 'ifoo ifoo a ')
    await nvim.call('nvim_buf_set_text', [doc.bufnr, 0, 0, 0, 1, []])
    await doc.synchronize()
    line = await nvim.line
    assert.strictEqual(line, 'foo foo a ')
  })

  it('should cancel when change out of range', async t => {
    let doc = await workspace.document
    await registerLinkedEditingProvider('foo foo bar', Position.create(0, 0))
    await shared.waitValue(() => {
      return matches()
    }, 2)
    await nvim.call('nvim_buf_set_text', [doc.bufnr, 0, 9, 0, 10, ['']])
    await doc.synchronize()
    await shared.waitValue(() => {
      return matches()
    }, 0)
  })

  it('should not cancel when insert line break before range', async t => {
    let doc = await workspace.document
    await registerLinkedEditingProvider('foo foo bar', Position.create(0, 0))
    await shared.waitValue(() => {
      return matches()
    }, 2)
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), '\n')])
    await shared.waitValue(() => matches(), 2)
  })

  it('should cancel when insert line break in range', async t => {
    let doc = await workspace.document
    await registerLinkedEditingProvider('foo foo bar', Position.create(0, 0))
    await shared.waitValue(() => {
      return matches()
    }, 2)
    // Mock the text change event: feed the handler the same change a real
    // `\n  ` insert at (0, 1) would produce. Going through nvim moves the
    // cursor and can re-trigger linked editing before the assertion, which
    // made this test flaky under load.
    await linkedEditingHandler.onChange({
      bufnr: doc.bufnr,
      contentChanges: [{ range: Range.create(0, 1, 0, 1), text: '\n  ', rangeLength: 0 }],
    } as any)
    await shared.waitValue(() => {
      return matches()
    }, 0)
  })

  it('should cancel on editor change', async t => {
    await registerLinkedEditingProvider('foo foo a ', Position.create(0, 0))
    await nvim.command(`enew`)
    await shared.wait(20)
    await shared.waitValue(() => {
      return matches()
    }, 0)
  })

  it('should cancel when insert none word character', async t => {
    await registerLinkedEditingProvider('foo foo a ', Position.create(0, 0))
    await nvim.call('cursor', [1, 4])
    await nvim.input('i')
    await nvim.input('a')
    await shared.waitValue(() => {
      return matches()
    }, 2)
    await nvim.input('i')
    await nvim.input('@')
    await shared.waitValue(() => {
      return matches()
    }, 0)
  })

  it('should cancel when insert not match wordPattern', async t => {
    wordPattern = '[A-Z]'
    await registerLinkedEditingProvider('foo foo a ', Position.create(0, 0))
    await nvim.call('cursor', [1, 4])
    await nvim.input('i')
    await nvim.input('A')
    await shared.waitValue(() => {
      return matches()
    }, 2)
    await nvim.input('i')
    await nvim.input('3')
    await shared.waitValue(() => {
      return matches()
    }, 0)
  })

  it('should cancel request on cursor moved', async t => {
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
    await shared.wait(20)
    await nvim.call('cursor', [1, 9])
    await shared.waitValue(() => {
      return matches()
    }, 0)
  })
})

describe('getPathFromArgs', () => {
  it('should get undefined path', async t => {
    let res = getPathFromArgs(['a'])
    assert.strictEqual(res, undefined)
    res = getPathFromArgs(['a', 'b', '-c'])
    assert.strictEqual(res, undefined)
    res = getPathFromArgs(['a', '-b', 'c'])
    assert.strictEqual(res, undefined)
  })
})

describe('search', () => {
  afterEach(editorReset)


  it('should open refactor window', async t => {
    let search = new Search(nvim, cmd)
    let buf = await refactor.createRefactorBuffer()
    await search.run([], cwd, buf)
    await shared.wait(20)
    let fileItems = buf.fileItems
    assert.strictEqual(fileItems.length, 2)
    assert.strictEqual(fileItems[0].ranges.length, 2)
  })

  it('should abort task', async t => {
    let search = new Search(nvim, cmd)
    let buf = await refactor.createRefactorBuffer()
    let p = search.run(['--sleep', '1000'], cwd, buf)
    search.abort()
    await p
    let fileItems = buf.fileItems
    assert.strictEqual(fileItems.length, 0)
  })

  it('should work with CocAction search', async t => {
    await shared.doAction('search', ['CocAction'])
    let bufnr = await nvim.call('bufnr', ['%']) as number
    let buf = refactor.getBuffer(bufnr)
    assert.notStrictEqual(buf, undefined)
  })

  it('should fail on invalid command', async t => {
    let search = new Search(nvim, 'rrg')
    let buf = await refactor.createRefactorBuffer()
    let err
    try {
      await search.run([], cwd, buf)
    } catch (e) {
      err = e
    }
    assert.notStrictEqual(err, undefined)
    let msg = await shared.getCmdline()
    assert.match(msg, /Error on command "rrg"/)
  })

  it('should show empty result when no result found', async t => {
    let keyword = 'no result'
    await shared.doAction('search', ['should found ' + keyword])
    let bufnr = await nvim.call('bufnr', ['%']) as number
    let buf = refactor.getBuffer(bufnr)
    assert.notStrictEqual(buf, undefined)
    let buffer = await nvim.buffer
    let lines = await buffer.lines
    assert.match(lines[1], /No match found/)
  })

  it('should use current search folder for rg', async t => {
    let search = new Search(nvim, 'rg')
    await shared.createDocument()
    let buf = await refactor.createRefactorBuffer()
    await search.run(['-w', 'createRefactorBuffer', 'src/__tests__'], cwd, buf)
    let buffer = await nvim.buffer
    let lines = await buffer.lines
    assert.strictEqual(lines[1].startsWith('Files: '), true)
  })
})
