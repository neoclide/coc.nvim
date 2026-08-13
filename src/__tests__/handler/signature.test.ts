import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import commands from '../../commands'
import events from '../../events'
import Signature from '../../handler/signature'
import languages from '../../languages'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import { Neovim } from '@chemzqm/neovim'
import { Disposable, ParameterInformation, Range, SignatureInformation } from 'vscode-languageserver-protocol'
import type SignatureType from '../../handler/signature'


let nvim: Neovim
let signature: SignatureType
let disposables: Disposable[] = []

before(async () => {
  nvim = workspace.nvim
  signature = getCurrentPlugin().getHandler().signature
})

afterEach(async () => {
  disposeAll(disposables)
  disposables = []
})

describe('signatureHelp', () => {

  describe('triggerSignatureHelp', () => {
    it('should show signature by api', async t => {
      let res = await signature.triggerSignatureHelp()
      assert.strictEqual(res, false)
      disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
        provideSignatureHelp: (_doc, _position) => {
          return {
            signatures: [SignatureInformation.create('foo()', 'my signature')],
            activeParameter: null,
            activeSignature: null
          }
        }
      }))
      await shared.createDocument()
      await nvim.input('foo')
      await commands.executeCommand('editor.action.triggerParameterHints')
      let win = await shared.getFloat()
      assert.notStrictEqual(win, undefined)
      let lines = await shared.getWinLines(win.id)
      assert.match(lines[2], new RegExp('my signature'))
    })

    it('should load configuration', async t => {
      await nvim.command(`edit +setl\\ buftype=nofile tree`)
      signature.loadConfiguration()
    })

    it('should use 0 when activeParameter is undefined', async t => {
      disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
        provideSignatureHelp: (_doc, _position) => {
          return {
            signatures: [SignatureInformation.create('foo(a)', 'my signature', { label: 'a' })],
            activeParameter: undefined,
            activeSignature: null
          }
        }
      }, []))
      await shared.createDocument()
      await nvim.input('foo')
      await shared.doAction('showSignatureHelp')
      await signature.triggerSignatureHelp()
      let win = await shared.getFloat()
      assert.notStrictEqual(win, undefined)
      let buf = await win.buffer
      let hls = await buf.getHighlights(-1 as any)
      assert.strictEqual(hls.length, 2)
      assert.strictEqual(hls[0].hlGroup, 'CocFloatActive')
    })

    it('should not highlight parameter when activeParameter is null', async t => {
      disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
        provideSignatureHelp: (_doc, _position) => {
          return {
            signatures: [SignatureInformation.create('foo(a)', 'my signature', { label: 'a' })],
            activeParameter: null,
            activeSignature: null
          }
        }
      }, []))
      await shared.createDocument()
      await nvim.input('foo')
      await shared.doAction('showSignatureHelp')
      await signature.triggerSignatureHelp()
      let win = await shared.getFloat()
      assert.notStrictEqual(win, undefined)
      let buf = await win.buffer
      let hls = await buf.getHighlights(-1 as any)
      assert.strictEqual(hls.some(h => h.hlGroup === 'CocFloatActive'), false)
    })

    it('should not highlight parameter when signature activeParameter is null', async t => {
      disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
        provideSignatureHelp: (_doc, _position) => {
          return {
            signatures: [{
              label: 'foo(a)',
              documentation: 'my signature',
              parameters: [{ label: 'a' }],
              activeParameter: null
            }],
            activeParameter: 0,
            activeSignature: null
          }
        }
      }, []))
      await shared.createDocument()
      await nvim.input('foo')
      await shared.doAction('showSignatureHelp')
      await signature.triggerSignatureHelp()
      let win = await shared.getFloat()
      assert.notStrictEqual(win, undefined)
      let buf = await win.buffer
      let hls = await buf.getHighlights(-1 as any)
      assert.strictEqual(hls.some(h => h.hlGroup === 'CocFloatActive'), false)
    })

    it('should trigger by space', async t => {
      let promise = new Promise(resolve => {
        disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
          provideSignatureHelp: (_doc, _position) => {
            resolve(undefined)
            return {
              signatures: [SignatureInformation.create('foo()', 'my signature')],
              activeParameter: null,
              activeSignature: null
            }
          }
        }, [' ']))
      })
      await shared.createDocument()
      await nvim.input('i')
      await shared.wait(30)
      await nvim.input(' ')
      await promise
    })

    it('should show signature help with param label as string', async t => {
      disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
        provideSignatureHelp: (_doc, _position) => {
          return {
            signatures: [
              SignatureInformation.create('foo()', 'my signature'),
              SignatureInformation.create('foo', 'my signature', ParameterInformation.create('a', 'description')),
            ],
            activeParameter: 0,
            activeSignature: 1
          }
        }
      }, []))
      await shared.createDocument()
      await nvim.input('foo')
      await signature.triggerSignatureHelp()
      let win = await shared.getFloat()
      assert.notStrictEqual(win, undefined)
      let lines = await shared.getWinLines(win.id)
      assert.match(lines.join('\n'), /description/)
    })
  })

  describe('events', () => {
    function registProvider(): void {
      disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
        provideSignatureHelp: (_doc, _position) => {
          return {
            signatures: [SignatureInformation.create('foo(x, y)', 'my signature')],
            activeParameter: 0,
            activeSignature: 0
          }
        }
      }, ['(', ',']))
    }

    it('should trigger signature help on TextInsert', async t => {
      registProvider()
      await shared.createDocument()
      await nvim.input('ifoo')
      await nvim.input('(')
      await shared.waitValue(async () => {
        let win = await shared.getFloat()
        return win != null
      }, true)
      let win = await shared.getFloat()
      let lines = await shared.getWinLines(win.id)
      assert.match(lines[2], new RegExp('my signature'))
    })

    it('should trigger signature help on PlaceholderJump', async t => {
      let called = 0
      disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
        provideSignatureHelp: (_doc, _position) => {
          called += 1
          return {
            signatures: [SignatureInformation.create('foo(x, y)', 'my signature')],
            activeParameter: 0,
            activeSignature: 0
          }
        }
      }, ['(', ',']))
      let doc = await shared.createDocument()
      Object.assign((workspace as any)._env, { jumpAutocmd: true })
      await events.fire('PlaceholderJump', [doc.bufnr, { charbefore: ' ', range: Range.create(0, 0, 0, 0) }])
      Object.assign((workspace as any)._env, { jumpAutocmd: false })
      await events.fire('PlaceholderJump', [doc.bufnr, { charbefore: '', range: Range.create(0, 0, 0, 0) }])
      await events.fire('PlaceholderJump', [doc.bufnr + 1, { charbefore: '(', range: Range.create(0, 0, 0, 0) }])
      assert.strictEqual(called, 0)
      await nvim.input('ifoo(b)')
      await events.fire('PlaceholderJump', [doc.bufnr, { charbefore: '(', range: Range.create(0, 5, 0, 6) }])
      assert.strictEqual(called, 1)
    })

    it('should cancel trigger on InsertLeave', async t => {
      disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
        provideSignatureHelp: async (_doc, _position, token) => {
          return new Promise(resolve => {
            let timer = setTimeout(() => {
              resolve({
                signatures: [SignatureInformation.create('foo()', 'my signature')],
                activeParameter: null,
                activeSignature: null
              })
            }, 1000)
            token.onCancellationRequested(() => {
              clearTimeout(timer)
              resolve(undefined)
            })
          })
        }
      }, ['(', ',']))
      await shared.createDocument()
      await nvim.input('foo')
      let p = signature.triggerSignatureHelp()
      await shared.wait(20)
      await nvim.command('stopinsert')
      await nvim.call('feedkeys', [String.fromCharCode(27), 'in'])
      let res = await p
      assert.strictEqual(res, false)
    })

    it('should not close signature on type', async t => {
      disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
        provideSignatureHelp: (_doc, _position) => {
          return {
            signatures: [SignatureInformation.create('foo()', 'my signature')],
            activeParameter: null,
            activeSignature: null
          }
        }
      }, ['( ,']))
      let doc = await shared.createDocument()
      await nvim.input('foo(')
      await doc.synchronize()
      await nvim.input('bar')
      await doc.synchronize()
      await shared.waitFloat()
      let win = await shared.getFloat()
      let lines = await shared.getWinLines(win.id)
      assert.match(lines[2], new RegExp('my signature'))
    })

    it('should close signature float when empty signatures returned', async t => {
      let empty = false
      disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
        provideSignatureHelp: (_doc, _position) => {
          if (empty) return undefined
          return {
            signatures: [SignatureInformation.create('foo()', 'my signature')],
            activeParameter: null,
            activeSignature: null
          }
        }
      }, ['(', ',']))
      await shared.createDocument()
      await nvim.input('foo(')
      let winid = await shared.waitFloat()
      let win = nvim.createWindow(winid)
      empty = true
      await signature.triggerSignatureHelp()
      await shared.waitValue(() => nvim.call('coc#float#valid', [win.id]), 0)
      let res = await nvim.call('coc#float#valid', [win.id])
      assert.strictEqual(res, 0)
    })

    it('should close float on cursor moved', async t => {
      disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
        provideSignatureHelp: (_doc, _position) => {
          return {
            signatures: [SignatureInformation.create('foo()', 'my signature')],
            activeParameter: null,
            activeSignature: null
          }
        }
      }, ['(', ',']))
      const show = async () => {
        await shared.createDocument()
        await nvim.input('i')
        await nvim.call('append', [1, 'bar'])
        await nvim.input('(')
        await shared.waitValue(async () => {
          let win = await shared.getFloat()
          return win != null
        }, true)
      }
      await show()
      await nvim.call('cursor', [2, 1])
      await shared.waitValue(async () => {
        let win = await shared.getFloat()
        return win == null
      }, true)
      await nvim.input('<esc>')
      await show()
      await nvim.input(')')
      await shared.waitValue(async () => {
        let win = await shared.getFloat()
        return win == null
      }, true)
    })
  })

  describe('float window', () => {
    it('should align signature window to top', async t => {
      disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
        provideSignatureHelp: (_doc, _position) => {
          return {
            signatures: [SignatureInformation.create('foo()', 'my signature')],
            activeParameter: null,
            activeSignature: null
          }
        }
      }, ['(', ',']))
      await shared.createDocument()
      let buf = await nvim.buffer
      await buf.setLines(['', '', '', '', ''], { start: 0, end: -1, strictIndexing: true })
      await nvim.call('cursor', [5, 1])
      await nvim.input('foo(')
      let winid = await shared.waitFloat()
      let win = nvim.createWindow(winid)
      let lines = await shared.getWinLines(win.id)
      assert.match(lines[2], new RegExp('my signature'))
      let res = await nvim.call('GetFloatCursorRelative', [win.id]) as any
      assert.ok(res.row < 0)
    })

    it('should show parameter docs', async t => {
      disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
        provideSignatureHelp: (_doc, _position) => {
          return {
            signatures: [SignatureInformation.create('foo(a, b)', 'my signature',
              ParameterInformation.create('a', 'foo'),
              ParameterInformation.create([7, 8], 'bar'))],
            activeParameter: 1,
            activeSignature: null
          }
        }
      }, ['(', ',']))
      await shared.createDocument()
      let buf = await nvim.buffer
      await buf.setLines(['', '', '', '', ''], { start: 0, end: -1, strictIndexing: true })
      await nvim.call('cursor', [5, 1])
      await nvim.input('foo(a,')
      let winid = await shared.waitFloat()
      let win = nvim.createWindow(winid)
      let lines = await shared.getWinLines(win.id)
      assert.match(lines.join('\n'), new RegExp('bar'))
    })
  })

  describe('configurations', () => {
    let { configurations } = workspace
    afterEach(() => {
      configurations.updateMemoryConfig({
        'signature.target': 'float',
        'signature.hideOnTextChange': false,
        'signature.enable': true,
        'signature.triggerSignatureWait': 500
      })
    })

    it('should cancel signature on timeout', async t => {
      configurations.updateMemoryConfig({ 'signature.triggerSignatureWait': 50 })
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
      await shared.createDocument()
      await signature.triggerSignatureHelp()
      let win = await shared.getFloat()
      assert.strictEqual(win, undefined)
      configurations.updateMemoryConfig({ 'signature.triggerSignatureWait': 100 })
    })

    it('should hide signature window on text change', async t => {
      configurations.updateMemoryConfig({ 'signature.hideOnTextChange': true })
      disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
        provideSignatureHelp: (_doc, _position) => {
          let s = SignatureInformation.create('foo()', 'my signature')
          s.parameters = undefined
          return {
            signatures: [s],
            activeParameter: 0,
            activeSignature: null
          }
        }
      }, ['(', ',']))
      await shared.createDocument()
      await nvim.input('ifoo(')
      let winid = await shared.waitFloat()
      await nvim.input('x')
      await shared.waitValue(() => nvim.call('coc#float#valid', [winid]), 0)
      let res = await nvim.call('coc#float#valid', [winid])
      assert.strictEqual(res, 0)
      configurations.updateMemoryConfig({ 'signature.hideOnTextChange': false })
    })

    it('should not retrigger signature on MenuPopupChanged when hideOnTextChange enabled', async t => {
      configurations.updateMemoryConfig({ 'signature.hideOnTextChange': true })
      let doc = await shared.createDocument()
      Object.assign(signature as any, {
        lastPosition: { bufnr: doc.bufnr, lnum: 1, col: 1 }
      })
      let spy = t.mock.method(signature as any, '_triggerSignatureHelp', async () => true)
      await events.fire('MenuPopupChanged', [{}])
      await shared.wait(30)
      assert.strictEqual(spy.mock.callCount(), 0)
      configurations.updateMemoryConfig({ 'signature.hideOnTextChange': false })
    })

    it('should disable signature help trigger', async t => {
      configurations.updateMemoryConfig({ 'signature.enable': false })
      disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
        provideSignatureHelp: (_doc, _position) => {
          return {
            signatures: [SignatureInformation.create('foo()', 'my signature')],
            activeParameter: null,
            activeSignature: null
          }
        }
      }, ['(', ',']))
      await shared.createDocument()
      await nvim.input('foo')
      await nvim.input('(')
      await shared.wait(30)
      let win = await shared.getFloat()
      assert.strictEqual(win, undefined)
    })

    it('should echo simple signature help', async t => {
      let idx = 0
      let activeSignature = null
      configurations.updateMemoryConfig({ 'signature.target': 'echo' })
      disposables.push(languages.registerSignatureHelpProvider([{ scheme: 'file' }], {
        provideSignatureHelp: (_doc, _position) => {
          return {
            signatures: [SignatureInformation.create('foo(a, b)', 'my signature',
              ParameterInformation.create('a', 'foo'),
              ParameterInformation.create([7, 8], 'bar')),
            SignatureInformation.create('a'.repeat(workspace.env.columns + 10))
            ],
            activeParameter: idx,
            activeSignature
          }
        }
      }, []))
      await shared.createDocument()
      await nvim.input('foo(')
      await signature.triggerSignatureHelp()
      let line = await shared.getCmdline()
      assert.match(line, /\(a, b\)/)
      await nvim.input('a,')
      idx = 1
      await signature.triggerSignatureHelp()
      line = await shared.getCmdline()
      assert.match(line, /foo\(a, b\)/)
      activeSignature = 1
      await signature.triggerSignatureHelp()
      line = await shared.getCmdline()
      assert.match(line, new RegExp('aaaaaa'))
    })

    it('should echo signature without match', async t => {
      let signatureHelp = {
        signatures: [SignatureInformation.create('foo(a, b)', 'my signature',
          ParameterInformation.create('c', 'foo'),
          ParameterInformation.create([7, 8], 'bar')),
        SignatureInformation.create('a'.repeat(workspace.env.columns + 10))
        ],
        activeParameter: 0,
        activeSignature: null
      }
      signature.echoSignature(signatureHelp)
      await shared.wait(20)
      let line = await shared.getCmdline()
      assert.match(line, new RegExp('foo'))
      signatureHelp.signatures[0].parameters = undefined
      signature.echoSignature(signatureHelp)
    })
  })
})
