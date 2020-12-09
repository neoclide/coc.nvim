import { Neovim } from '@chemzqm/neovim'
import { Disposable, ParameterInformation, SignatureInformation } from 'vscode-languageserver-protocol'
import languages from '../../languages'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []

beforeAll(async () => {
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

describe('signature help', () => {
  it('should show signature by api', async () => {
    disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
      provideSignatureHelp: (_doc, _position) => {
        return {
          signatures: [SignatureInformation.create('foo()', 'my signature', ParameterInformation.create('p1'), ParameterInformation.create('p2'))],
          activeParameter: null,
          activeSignature: null
        }
      }
    }, []))
    await helper.createDocument()
    await nvim.input('foo')
    await nvim.call('CocAction', 'showSignatureHelp')
    let win = await helper.getFloat()
    expect(win).toBeDefined()
    let lines = await helper.getWinLines(win.id)
    expect(lines[2]).toMatch('my signature')
  })

  it('should trigger signature help', async () => {
    disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
      provideSignatureHelp: (_doc, _position) => {
        return {
          signatures: [SignatureInformation.create('foo()', 'my signature')],
          activeParameter: null,
          activeSignature: null
        }
      }
    }, ['(', ',']))
    await helper.createDocument()
    await nvim.input('foo')
    await nvim.input('(')
    await helper.wait(100)
    let win = await helper.getFloat()
    expect(win).toBeDefined()
    let lines = await helper.getWinLines(win.id)
    expect(lines[2]).toMatch('my signature')
  })

  it('should not close signature on type', async () => {
    disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
      provideSignatureHelp: (_doc, _position) => {
        return {
          signatures: [SignatureInformation.create('foo()', 'my signature')],
          activeParameter: null,
          activeSignature: null
        }
      }
    }, ['(', ',']))
    await helper.createDocument()
    await nvim.input('foo(')
    await helper.wait(100)
    await nvim.input('bar')
    await helper.wait(100)
    let win = await helper.getFloat()
    expect(win).toBeDefined()
    let lines = await helper.getWinLines(win.id)
    expect(lines[2]).toMatch('my signature')
  })

  it('should align signature window to top', async () => {
    disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
      provideSignatureHelp: (_doc, _position) => {
        return {
          signatures: [SignatureInformation.create('foo()', 'my signature')],
          activeParameter: null,
          activeSignature: null
        }
      }
    }, ['(', ',']))
    await helper.createDocument()
    let buf = await nvim.buffer
    await buf.setLines(['', '', '', '', ''], { start: 0, end: -1, strictIndexing: true })
    await nvim.call('cursor', [5, 1])
    await nvim.input('foo(')
    await helper.wait(100)
    let win = await helper.getFloat()
    expect(win).toBeDefined()
    let lines = await helper.getWinLines(win.id)
    expect(lines[2]).toMatch('my signature')
    let res = await nvim.call('coc#float#cursor_relative', [win.id]) as any
    expect(res.row).toBeLessThan(0)
  })

  it('should cancel signature on timeout', async () => {
    let { configurations } = workspace
    configurations.updateUserConfig({ 'signature.triggerSignatureWait': 50 })
    disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
      provideSignatureHelp: (_doc, _position, token) => {
        return new Promise(resolve => {
          token.onCancellationRequested(() => {
            clearTimeout(timer)
            resolve(undefined)
          })
          let timer = setTimeout(() => {
            resolve({
              signatures: [SignatureInformation.create('foo()', 'my signature')],
              activeParameter: null,
              activeSignature: null
            })
          }, 200)
        })
      }
    }, ['(', ',']))
    await helper.createDocument()
    await nvim.call('CocAction', 'showSignatureHelp')
    let win = await helper.getFloat()
    expect(win).toBeUndefined()
    configurations.updateUserConfig({ 'signature.triggerSignatureWait': 100 })
  })

  it('should echo signature help', async () => {
    let { configurations } = workspace
    configurations.updateUserConfig({ 'signature.target': 'echo' })
    disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
      provideSignatureHelp: (_doc, _position) => {
        return {
          signatures: [SignatureInformation.create('foo()', 'my signature', ParameterInformation.create('p1'), ParameterInformation.create('p2'))],
          activeParameter: null,
          activeSignature: null
        }
      }
    }, []))
    await helper.createDocument()
    await nvim.input('foo')
    await nvim.call('CocAction', 'showSignatureHelp')
    let line = await helper.getCmdline()
    expect(line).toMatch('foo()')
    configurations.updateUserConfig({ 'signature.target': 'float' })
  })
})
