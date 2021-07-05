import { Neovim } from '@chemzqm/neovim'
import { Disposable, DocumentLink, Range } from 'vscode-languageserver-protocol'
import LinksHandler from '../../handler/links'
import languages from '../../languages'
import { disposeAll } from '../../util'
import helper from '../helper'

let nvim: Neovim
let links: LinksHandler
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  links = (helper.plugin as any).handler.links
})

afterAll(async () => {
  await helper.shutdown()
})

beforeEach(async () => {
  await helper.createDocument()
})

afterEach(async () => {
  disposeAll(disposables)
  await helper.reset()
})

describe('Links', () => {
  it('should get document links', async () => {
    disposables.push(languages.registerDocumentLinkProvider([{ language: '*' }], {
      provideDocumentLinks: (_doc, _token) => {
        return [
          DocumentLink.create(Range.create(0, 0, 0, 5), 'test:///foo'),
          DocumentLink.create(Range.create(1, 0, 1, 5), 'test:///bar')
        ]
      }
    }))
    let res = await links.getLinks()
    expect(res.length).toBe(2)
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

  it('should open link at current position', async () => {
    await nvim.setLine('foo')
    await nvim.command('normal! 0')
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
    await links.openCurrentLink()
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
})
