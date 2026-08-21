import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import HoverHandler, { addDefinitions, addDocument, isDocumentation, readLines } from '../../handler/hover'
import languages from '../../languages'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable, Hover, MarkedString, MarkupKind, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { Documentation } from '../../types'
import type HoverHandlerType from '../../handler/hover'

// Editor runtime bundle: same module instances the session was created from.

let nvim: Neovim
let hover: HoverHandlerType
let disposables: Disposable[] = []
let hoverResult: Hover
before(async () => {
  nvim = workspace.nvim
  hover = getCurrentPlugin().getHandler().hover
})

beforeEach(async () => {
  await shared.createDocument()
  disposables.push(languages.registerHoverProvider([{ language: '*' }], {
    provideHover: (_doc, _pos, _token) => {
      return hoverResult
    }
  }))
})

afterEach(async () => {
  disposeAll(disposables)
})

async function getDocumentText(): Promise<string> {
  let lines = await nvim.call('getbufline', ['coc://document', 1, '$']) as string[]
  return lines.join('\n')
}

describe('Hover', () => {
  describe('utils', () => {
    it('should addDocument', async t => {
      let docs: Documentation[] = []
      addDocument(docs, '', '')
      assert.strictEqual(docs.length, 0)
    })

    it('should check documentation', async t => {
      assert.strictEqual(isDocumentation(undefined), false)
      assert.strictEqual(isDocumentation({}), false)
      assert.strictEqual(isDocumentation({ filetype: '', content: '' }), true)
    })

    it('should readLines', async t => {
      let res = await readLines('file:///not_exists', 0, 1)
      assert.deepStrictEqual(res, [])
    })

    it('should addDefinitions', async t => {
      let hovers = []
      let range = Range.create(0, 0, 0, 0)
      await addDefinitions(hovers, [undefined, {} as any, { targetUri: 'file:///not_exists', targetRange: range, targetSelectionRange: range }], '')
      assert.strictEqual(hovers.length, 0)
      let file = await shared.createTmpFile('  foo\nbar\n', disposables)
      range = Range.create(0, 0, 300, 0)
      await addDefinitions(hovers, [{ targetUri: URI.file(file).toString(), targetRange: range, targetSelectionRange: range }], '')
      assert.strictEqual(hovers.length, 1)
    })
  })

  describe('onHover', () => {
    it('should return false when hover not found', async t => {
      hoverResult = null
      let res = await hover.onHover('preview')
      assert.strictEqual(res, false)
    })

    it('should show MarkupContent hover', async t => {
      shared.updateConfiguration('hover.target', 'preview')
      hoverResult = { contents: { kind: 'plaintext', value: 'my hover' } }
      await shared.doAction('doHover')
      let res = await getDocumentText()
      assert.match(res, new RegExp('my hover'))
    })

    it('should merge hover results', async t => {
      hoverResult = { contents: { kind: 'plaintext', value: 'my hover' } }
      disposables.push(languages.registerHoverProvider([{ language: '*' }], {
        provideHover: (_doc, _pos, _token) => {
          return null
        }
      }))
      disposables.push(languages.registerHoverProvider([{ language: '*' }], {
        provideHover: (_doc, _pos, _token) => {
          return { contents: { kind: 'plaintext', value: 'my hover' } }
        }
      }))
      let doc = await workspace.document
      let hovers = await languages.getHover(doc.textDocument, Position.create(0, 0), CancellationToken.None)
      assert.strictEqual(hovers.length, 1)
    })

    it('should show MarkedString hover', async t => {
      hoverResult = { contents: 'string hover' }
      disposables.push(languages.registerHoverProvider([{ language: '*' }], {
        provideHover: (_doc, _pos, _token) => {
          return { contents: { language: 'typescript', value: 'language hover' } }
        }
      }))
      await hover.onHover('preview')
      let res = await getDocumentText()
      assert.match(res, new RegExp('string hover'))
      assert.match(res, new RegExp('language hover'))
    })

    it('should show MarkedString hover array', async t => {
      hoverResult = { contents: ['foo', { language: 'typescript', value: 'bar' }] }
      await hover.onHover('preview')
      let res = await getDocumentText()
      assert.match(res, new RegExp('foo'))
      assert.match(res, new RegExp('bar'))
    })

    it('should highlight hover range', async t => {
      await nvim.setLine('var')
      await nvim.command('normal! 0')
      hoverResult = { contents: ['foo'], range: Range.create(0, 0, 0, 3) }
      await hover.onHover('preview')
      let res = await nvim.call('getmatches') as any[]
      assert.strictEqual(res.length, 1)
      assert.strictEqual(res[0].group, 'CocHoverRange')
      await shared.waitValue(async () => {
        let res = await nvim.call('getmatches') as any[]
        return res.length
      }, 0)
    })
  })

  describe('previewHover', () => {
    it('should echo hover message', async t => {
      hoverResult = { contents: ['foo'] }
      let res = await hover.onHover('echo')
      assert.strictEqual(res, true)
      let msg = await shared.getCmdline()
      assert.match(msg, new RegExp('foo'))
    })

    it('should show hover in float window', async t => {
      hoverResult = { contents: { kind: 'markdown', value: '```typescript\nconst foo:number\n```' } }
      await hover.onHover('float')
      let win = await shared.getFloat()
      assert.notStrictEqual(win, undefined)
      let lines = await nvim.eval(`getbufline(winbufnr(${win.id}),1,'$')`)
      assert.deepStrictEqual(lines, ['const foo:number'])
    })

    it('should add OSC 8 hyperlinks to Neovim hover floats', async t => {
      hoverResult = { contents: { kind: 'markdown', value: '[Coc](https://github.com/neoclide/coc.nvim)' } }
      await hover.onHover('float')
      if (workspace.isVim || !workspace.has('nvim-0.12.0')) return
      let win = await shared.getFloat()
      let namespaces = await nvim.call('nvim_get_namespaces') as Record<string, number>
      let bufnr = await nvim.call('winbufnr', [win.id]) as number
      let marks = await nvim.call('luaeval', ['vim.api.nvim_buf_get_extmarks(_A[1], _A[2], 0, -1, {details = true})', [bufnr, namespaces['coc-hyperlinks']]]) as any[]
      assert.strictEqual(marks.length, 1)
      assert.deepStrictEqual(marks[0].slice(1, 3), [0, 0])
      assert.strictEqual(marks[0][3].end_col, 3)
      assert.strictEqual(marks[0][3].url, 'https://github.com/neoclide/coc.nvim')
    })

    it('should ignore rejected Neovim hyperlink extmarks', async t => {
      if (workspace.isVim || !workspace.has('nvim-0.12.0')) return
      let winid = await nvim.call('win_getid') as number
      await nvim.call('luaeval', ["require('coc.float').add_hyperlinks(_A[1], _A[2])", [winid, [{ lnum: -1, colStart: 0, colEnd: 1, url: 'https://example.com' }]]])
    })
  })

  describe('getHover', () => {
    it('should get hover from MarkedString array', async t => {
      hoverResult = { contents: ['foo', { language: 'typescript', value: 'bar' }] }
      disposables.push(languages.registerHoverProvider([{ language: '*' }], {
        provideHover: (_doc, _pos, _token) => {
          return { contents: { language: 'typescript', value: 'MarkupContent hover' } }
        }
      }))
      disposables.push(languages.registerHoverProvider([{ language: '*' }], {
        provideHover: (_doc, _pos, _token) => {
          return { contents: MarkedString.fromPlainText('MarkedString hover') }
        }
      }))
      let res = await shared.doAction('getHover')
      assert.strictEqual(res.includes('foo'), true)
      assert.strictEqual(res.includes('bar'), true)
      assert.strictEqual(res.includes('MarkupContent hover'), true)
      assert.strictEqual(res.includes('MarkedString hover'), true)
    })

    it('should filter empty hover message', async t => {
      hoverResult = { contents: [''] }
      disposables.push(languages.registerHoverProvider([{ language: '*' }], {
        provideHover: (_doc, _pos, _token) => {
          return { contents: { kind: MarkupKind.PlainText, value: 'value' } }
        }
      }))
      let res = await hover.getHover({ line: 1, col: 2 })
      assert.deepStrictEqual(res, ['value'])
    })

    it('should throw when buffer not attached', async t => {
      await assert.rejects(hover.getHover({ bufnr: 999, line: 1, col: 2 }), /not exists/)
    })
  })

  describe('definitionHover', () => {
    it('should load definition from buffer', async t => {
      hoverResult = { contents: 'string hover' }
      let doc = await shared.createDocument()
      await nvim.call('cursor', [1, 1])
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar')])
      disposables.push(languages.registerDefinitionProvider([{ language: '*' }], {
        provideDefinition() {
          return [{
            targetUri: doc.uri,
            targetRange: Range.create(0, 0, 1, 3),
            targetSelectionRange: Range.create(0, 0, 0, 3),
          }]
        }
      }))
      await shared.doAction('definitionHover', 'preview')
      let res = await getDocumentText()
      assert.strictEqual(res, 'string hover\n\nfoo\nbar')
    })

    it('should load definition link from file', async t => {
      let fsPath = await shared.createTmpFile('foo\nbar\n')
      hoverResult = { contents: 'string hover', range: Range.create(0, 0, 0, 3) }
      let doc = await shared.createDocument()
      await nvim.call('cursor', [1, 1])
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar')])
      disposables.push(languages.registerDefinitionProvider([{ language: '*' }], {
        provideDefinition() {
          return [{
            targetUri: URI.file(fsPath).toString(),
            targetRange: Range.create(0, 0, 1, 3),
            targetSelectionRange: Range.create(0, 0, 0, 3),
          }]
        }
      }))
      await hover.definitionHover('preview')
      let res = await getDocumentText()
      assert.strictEqual(res, 'string hover\n\nfoo\nbar')
    })

    it('should return false when hover not found', async t => {
      hoverResult = undefined
      let res = await hover.definitionHover('float')
      assert.strictEqual(res, false)
    })
  })
})
