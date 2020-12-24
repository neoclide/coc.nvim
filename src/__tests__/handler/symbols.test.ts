import { Buffer, Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import Symbols from '../../handler/symbols'
import languages from '../../languages'
import workspace from '../../workspace'
import events from '../../events'
import { disposeAll } from '../../util'
import helper from '../helper'
import Parser from './parser'

let nvim: Neovim
let symbols: Symbols
let disposables: Disposable[] = []

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  symbols = helper.plugin.getHandler().symbols
})

beforeEach(() => {
  disposables.push(languages.registerDocumentSymbolProvider([{ language: 'javascript' }], {
    provideDocumentSymbols: document => {
      let parser = new Parser(document.getText())
      let res = parser.parse()
      return Promise.resolve(res)
    }
  }))
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
  disposeAll(disposables)
  disposables = []
})

describe('Parser', () => {
  it('should parse content', async () => {
    let code = `class myClass {
      fun1() { }
    }`
    let parser = new Parser(code)
    let res = parser.parse()
    expect(res.length).toBeGreaterThan(0)
  })
})

describe('symbols featrue', () => {

  async function createBuffer(code: string): Promise<Buffer> {
    let buf = await nvim.buffer
    await nvim.command('setf javascript')
    await buf.setLines(code.split('\n'), { start: 0, end: -1, strictIndexing: false })
    let doc = await workspace.document
    doc.forceSync()
    return buf
  }

  it('should get configuration', async () => {
    let functionUpdate = symbols.functionUpdate
    expect(functionUpdate).toBe(false)
    helper.updateConfiguration('coc.preferences.currentFunctionSymbolAutoUpdate', true)
    functionUpdate = symbols.functionUpdate
    expect(functionUpdate).toBe(true)
    helper.updateConfiguration('coc.preferences.currentFunctionSymbolAutoUpdate', false)
  })

  it('should get symbols of current buffer', async () => {
    let code = `class myClass {
      fun1() { }
    }`
    await createBuffer(code)
    let res = await helper.plugin.cocAction('documentSymbols')
    expect(res.length).toBe(2)
  })

  it('should get current function symbols', async () => {
    let code = `class myClass {
      fun1() {
      }
    }`
    await createBuffer(code)
    await nvim.call('cursor', [3, 0])
    let res = await helper.doAction('getCurrentFunctionSymbol')
    expect(res).toBe('fun1')
  })

  it('should select symbol range at cursor position', async () => {
    let code = `class myClass {
      fun1() {
      }
    }`
    let buf = await createBuffer(code)
    await nvim.call('cursor', [3, 0])
    await helper.doAction('selectSymbolRange', false, '', ['Function', 'Method'])
    let mode = await nvim.mode
    expect(mode.mode).toBe('v')
    let doc = workspace.getDocument(buf.id)
    await nvim.input('<esc>')
    let res = await workspace.getSelectedRange('v', doc)
    expect(res).toEqual({ start: { line: 1, character: 6 }, end: { line: 2, character: 6 } })
  })

  it('should select symbol range from select range', async () => {
    let code = `class myClass {
      fun1() {
      }
    }`
    let buf = await createBuffer(code)
    await nvim.call('cursor', [2, 8])
    await nvim.command('normal! viw')
    await nvim.input('<esc>')
    await helper.doAction('selectSymbolRange', false, 'v', ['Class'])
    let mode = await nvim.mode
    expect(mode.mode).toBe('v')
    let doc = workspace.getDocument(buf.id)
    await nvim.input('<esc>')
    let res = await workspace.getSelectedRange('v', doc)
    expect(res).toEqual({ start: { line: 0, character: 0 }, end: { line: 3, character: 4 } })
  })

  it('should update symbols automatically', async () => {
    helper.updateConfiguration('coc.preferences.currentFunctionSymbolAutoUpdate', true)
    let code = `class myClass {
      fun1() {
      }
    }`
    let buf = await createBuffer(code)
    let fn = jest.fn()
    events.on('SymbolsUpdate', (bufnr, symbols) => {
      if (bufnr == buf.id) fn(symbols)
    }, null, disposables)
    await nvim.call('cursor', [2, 8])
    await events.fire('CursorHold', [buf.id])
    let val = await buf.getVar('coc_current_function')
    expect(val).toBe('fun1')
    await nvim.call('cursor', [1, 8])
    await events.fire('CursorHold', [buf.id])
    val = await buf.getVar('coc_current_function')
    expect(val).toBe('myClass')
    expect(fn).toBeCalled()
    helper.updateConfiguration('coc.preferences.currentFunctionSymbolAutoUpdate', false)
  })
})
