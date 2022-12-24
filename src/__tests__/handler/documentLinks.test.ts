import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable, DocumentLink, Range } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import events from '../../events'
import LinksHandler, { sameLinks } from '../../handler/links'
import languages from '../../languages'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let links: LinksHandler
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  links = helper.plugin.getHandler().links
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  disposeAll(disposables)
  await helper.reset()
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
    let empty = false
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks: (doc: TextDocument) => {
        if (empty) return []
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
    empty = true
    await buf.getLinks()
    hls = await buf.buffer.getHighlights('links')
    expect(hls.length).toBe(0)
  })
})
