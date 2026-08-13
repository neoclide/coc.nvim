import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import events from '../../events'
import Symbols from '../../handler/symbols/index'
import languages from '../../languages'
import { asDocumentSymbolTree } from '../../provider/documentSymbolManager'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import { Buffer, Neovim } from '@chemzqm/neovim'
import { CancellationToken, Disposable, Range, SymbolInformation, SymbolKind } from 'vscode-languageserver-protocol'
import Parser from './parser'


let nvim: Neovim
let symbols: Symbols
let disposables: Disposable[] = []

before(async () => {
  nvim = workspace.nvim
  symbols = getCurrentPlugin().getHandler().symbols
})

beforeEach(() => {
  disposables.push(languages.registerDocumentSymbolProvider([{ language: 'javascript' }], {
    provideDocumentSymbols: document => {
      let text = document.getText()
      let parser = new Parser(text, text.includes('detail'))
      let res = parser.parse()
      return Promise.resolve(res)
    }
  }))
})

afterEach(async () => {
  disposeAll(disposables)
  disposables = []
})

describe('Parser', () => {
  it('should parse content', async t => {
    let code = `class myClass {
      fun1() { }
    }`
    let parser = new Parser(code)
    let res = parser.parse()
    assert.ok(res.length > 0)
  })
})

describe('symbols handler', () => {
  afterEach(editorReset)


  async function createBuffer(code: string): Promise<Buffer> {
    let doc = await workspace.document
    doc.setFiletype('javascript')
    await doc.buffer.setLines(code.split('\n'), { start: 0, end: -1, strictIndexing: false })
    await doc.patchChange()
    return doc.buffer
  }

  describe('configuration', () => {
    it('should get configuration', async t => {
      let bufnr = await nvim.call('bufnr', ['%']) as number
      let functionUpdate = symbols.autoUpdate(bufnr)
      assert.strictEqual(functionUpdate, false)
      shared.updateConfiguration('coc.preferences.currentFunctionSymbolAutoUpdate', true)
      functionUpdate = symbols.autoUpdate(bufnr)
      assert.strictEqual(functionUpdate, true)
    })

    it('should update symbols automatically', async t => {
      shared.updateConfiguration('coc.preferences.currentFunctionSymbolAutoUpdate', true)
      let code = `class myClass {
      fun1() {
      }
    }`
      let buf = await createBuffer(code)
      await events.fire('CursorMoved', [buf.id, [2, 8]])
      await shared.waitFor('eval', ['get(b:,"coc_current_function","")'], 'fun1')
      await events.fire('CursorMoved', [buf.id, [1, 8]])
      await shared.waitFor('eval', ['get(b:,"coc_current_function","")'], 'myClass')
    })
  })

  describe('documentSymbols', () => {
    it('should create document symbol tree', t => {
      let uri = 'lsp:/1'
      let symbols = [
        SymbolInformation.create('root', SymbolKind.Function, Range.create(0, 0, 0, 10), uri),
        SymbolInformation.create('child', SymbolKind.Function, Range.create(0, 3, 0, 7), uri, 'root'),
        SymbolInformation.create('child', SymbolKind.Function, Range.create(0, 0, 0, 10), uri, 'root'),
      ]
      let res = asDocumentSymbolTree(symbols)
      assert.strictEqual(res.length, 2)
    })

    it('should get empty metadata when provider not found', async t => {
      disposeAll(disposables)
      let doc = await workspace.document
      let res = languages.getDocumentSymbolMetadata(doc.textDocument)
      assert.strictEqual(res, null)
      let symbols = await languages.getDocumentSymbol(doc.textDocument, CancellationToken.None)
      assert.strictEqual(symbols, null)
    })

    it('should get symbols of current buffer', async t => {
      let code = `class detail {
      fun1() { }
    }`
      await createBuffer(code)
      let res = await getCurrentPlugin().cocAction('documentSymbols')
      assert.strictEqual(res.length, 2)
      assert.notStrictEqual(res[1].detail, undefined)
    })

    it('should get current function symbols', async t => {
      let code = `class myClass {
      fun1() {
      }
      fun2() {
      }
    }
    `
      await createBuffer(code)
      await nvim.call('cursor', [3, 0])
      let res = await shared.doAction('getCurrentFunctionSymbol')
      assert.strictEqual(res, 'fun1')
      await nvim.command('normal! G')
      res = await shared.doAction('getCurrentFunctionSymbol')
      assert.strictEqual(res, '')
    })

    it('should reset coc_current_function when symbols do not exist', async t => {
      let code = `class myClass {
      fun1() {
      }
    }`
      await createBuffer(code)
      await nvim.call('cursor', [3, 0])
      let res = await shared.doAction('getCurrentFunctionSymbol')
      assert.strictEqual(res, 'fun1')
      await nvim.command('normal! ggdG')
      res = await symbols.getCurrentFunctionSymbol()
      assert.strictEqual(res, '')
    })

    it('should support SymbolInformation', async t => {
      disposables.push(languages.registerDocumentSymbolProvider(['*'], {
        provideDocumentSymbols: doc => {
          let s = SymbolInformation.create('root', SymbolKind.Function, Range.create(0, 0, 0, 10), doc.uri)
          s.deprecated = true
          return [
            s,
            SymbolInformation.create('child', SymbolKind.Function, Range.create(0, 3, 0, 7), doc.uri, 'root'),
            SymbolInformation.create('child', SymbolKind.Function, Range.create(0, 0, 0, 10), doc.uri, 'root')
          ]
        }
      }, { label: 'test' }))
      await shared.createDocument()
      let res = await symbols.getDocumentSymbols()
      assert.strictEqual(res.length, 3)
      assert.strictEqual(res[0].text, 'root')
      await nvim.command('edit +setl\\ buftype=nofile b')
      res = await symbols.getDocumentSymbols()
      assert.strictEqual(res, undefined)
    })
  })

  describe('selectSymbolRange', () => {
    it('should show warning when no symbols exist', async t => {
      disposables.push(languages.registerDocumentSymbolProvider(['*'], {
        provideDocumentSymbols: () => {
          return []
        }
      }))
      await shared.createDocument()
      await nvim.call('cursor', [3, 0])
      await symbols.selectSymbolRange(false, '', ['Function'])
      let msg = await shared.getCmdline()
      assert.match(msg, /No symbols found/)
    })

    it('should select symbol range at cursor position', async t => {
      let code = `class myClass {
      fun1() {
      }
    }`
      await createBuffer(code)
      await nvim.call('cursor', [3, 0])
      await shared.doAction('selectSymbolRange', false, '', ['Function', 'Method'])
      let mode = await nvim.mode
      assert.strictEqual(mode.mode, 'v')
      await nvim.input('<esc>')
      let res = await window.getSelectedRange('v')
      assert.deepStrictEqual(res, { start: { line: 1, character: 6 }, end: { line: 2, character: 6 } })
    })

    it('should select inner range', async t => {
      let code = `class myClass {
      fun1() {
        let foo;
      }
}`
      await createBuffer(code)
      await nvim.call('cursor', [3, 3])
      await symbols.selectSymbolRange(true, '', ['Method'])
      let mode = await nvim.mode
      assert.strictEqual(mode.mode, 'v')
      await nvim.input('<esc>')
      let res = await window.getSelectedRange('v')
      assert.deepStrictEqual(res, {
        start: { line: 2, character: 8 }, end: { line: 2, character: 16 }
      })
    })

    it('should reset visualmode when selection not found', async t => {
      let code = `class myClass {}`
      await createBuffer(code)
      await nvim.call('cursor', [1, 1])
      await nvim.command('normal! gg0v$')
      let mode = await nvim.mode
      assert.strictEqual(mode.mode, 'v')
      await nvim.input('<esc>')
      await symbols.selectSymbolRange(true, 'v', ['Method'])
      mode = await nvim.mode
      assert.strictEqual(mode.mode, 'v')
    })

    it('should select symbol range from select range', async t => {
      let code = `class myClass {
      fun1() {
      }
    }`
      let buf = await createBuffer(code)
      await nvim.call('cursor', [2, 8])
      await nvim.command('normal! viw')
      await nvim.input('<esc>')
      await shared.doAction('selectSymbolRange', false, 'v', ['Class'])
      let mode = await nvim.mode
      assert.strictEqual(mode.mode, 'v')
      let doc = workspace.getDocument(buf.id)
      await nvim.input('<esc>')
      let res = await window.getSelectedRange('v')
      assert.deepStrictEqual(res, { start: { line: 0, character: 0 }, end: { line: 3, character: 4 } })
    })
  })

  describe('cancel', () => {
    it('should cancel symbols request on insert', async t => {
      let cancelled = false
      disposables.push(languages.registerDocumentSymbolProvider([{ language: 'text' }], {
        provideDocumentSymbols: (_doc, token) => {
          return new Promise(s => {
            token.onCancellationRequested(() => {
              if (timer) clearTimeout(timer)
              cancelled = true
              s(undefined)
            })
            let timer = setTimeout(() => {
              s(undefined)
            }, 3000)
          })
        }
      }))
      let doc = await shared.createDocument('t.txt')
      let p = symbols.getDocumentSymbols(doc.bufnr)
      setTimeout(async () => {
        await nvim.input('i')
      }, 500)
      await p
      assert.strictEqual(cancelled, true)
    })
  })

  describe('workspaceSymbols', () => {
    it('should get workspace symbols', async t => {
      disposables.push(languages.registerWorkspaceSymbolProvider({
        provideWorkspaceSymbols: (_query, _token) => {
          return [SymbolInformation.create('far', SymbolKind.Class, Range.create(0, 0, 0, 0), '')]
        },
        resolveWorkspaceSymbol: sym => {
          let res = Object.assign({}, sym)
          res.location.uri = 'test:///foo'
          return res
        }
      }))
      let fn: any = languages.registerWorkspaceSymbolProvider.bind(languages)
      disposables.push(fn('vim', {
        provideWorkspaceSymbols: (_query, _token) => {
          return null
        }
      }))
      let res = await symbols.getWorkspaceSymbols('a')
      assert.strictEqual(res.length, 1)
      let resolved = await shared.doAction('resolveWorkspaceSymbol', res[0])
      assert.strictEqual(resolved?.location?.uri, 'test:///foo')
    })

    it('should return symbol when resolve failed', async t => {
      disposables.push(languages.registerWorkspaceSymbolProvider({
        provideWorkspaceSymbols: (_query, _token) => {
          return [SymbolInformation.create('far', SymbolKind.Class, Range.create(0, 0, 0, 0), '')]
        }
      }))
      let res = await shared.doAction('getWorkspaceSymbols')
      let resolved = await symbols.resolveWorkspaceSymbol(res[0])
      assert.notStrictEqual(resolved, undefined)
    })
  })
})
