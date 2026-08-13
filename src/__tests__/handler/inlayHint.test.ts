import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import commands from '../../commands'
import InlayHintHandler from '../../handler/inlayHint/index'
import languages from '../../languages'
import { InlayHintWithProvider, isInlayHint, isValidInlayHint, sameHint } from '../../provider/inlayHintManager'
import { disposeAll } from '../../util'
import { CancellationError } from '../../util/errors'
import workspace from '../../workspace'
import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, Disposable, InlayHint, InlayHintKind, Position, Range, TextEdit } from 'vscode-languageserver-protocol'


let nvim: Neovim
let handler: InlayHintHandler
let disposables: Disposable[] = []
let ns: number
before(async () => {
  nvim = workspace.nvim
  handler = getCurrentPlugin().getHandler().inlayHintHandler
  ns = await nvim.createNamespace('coc-inlayHint')
})

afterEach(async () => {
  disposeAll(disposables)
})

async function registerProvider(content: string): Promise<Disposable> {
  let doc = await workspace.document
  let disposable = languages.registerInlayHintsProvider([{ language: '*' }], {
    provideInlayHints: (document, range) => {
      let content = document.getText(range)
      let lines = content.split(/\r?\n/)
      let hints: InlayHint[] = []
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i]
        if (!line.length) continue
        let parts = line.split(/\s+/)
        let kind: InlayHintKind = i == 0 ? InlayHintKind.Type : InlayHintKind.Parameter
        hints.push(...parts.map(s => InlayHint.create(Position.create(range.start.line + i, line.length), s, kind)))
      }
      return hints
    }
  })
  await shared.wait(20)
  await doc.buffer.setLines(content.split(/\n/), { start: 0, end: -1 })
  await doc.synchronize()
  return disposable
}

async function waitRefresh(bufnr: number) {
  let buf = handler.getItem(bufnr)
  return new Promise<void>((resolve, reject) => {
    let timer = setTimeout(() => {
      reject(new Error('not refresh after 1s'))
    }, 1000)
    buf.onDidRefresh(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

afterEach(editorReset)

describe('InlayHint', () => {
  describe('utils', () => {
    it('should check same hint', t => {
      let hint = InlayHint.create(Position.create(0, 0), 'foo')
      assert.strictEqual(sameHint(hint, InlayHint.create(Position.create(0, 0), 'bar')), false)
      assert.strictEqual(sameHint(hint, InlayHint.create(Position.create(0, 0), [{ value: 'foo' }])), true)
    })

    it('should check valid hint', t => {
      let hint = InlayHint.create(Position.create(0, 0), 'foo')
      assert.strictEqual(isValidInlayHint(hint, Range.create(0, 0, 1, 0)), true)
      assert.strictEqual(isValidInlayHint(InlayHint.create(Position.create(0, 0), ''), Range.create(0, 0, 1, 0)), false)
      assert.strictEqual(isValidInlayHint(InlayHint.create(Position.create(3, 0), 'foo'), Range.create(0, 0, 1, 0)), false)
      assert.strictEqual(isValidInlayHint({ label: 'f' } as any, Range.create(0, 0, 1, 0)), false)
    })

    it('should check inlayHint instance', async t => {
      assert.strictEqual(isInlayHint(null), false)
      let position = Position.create(0, 0)
      assert.strictEqual(isInlayHint({ position, label: null }), false)
      assert.strictEqual(isInlayHint({ position, label: [{ value: '' }] }), true)
    })
  })

  describe('provideInlayHints', () => {
    // not fail like VSCode
    it('should not throw when failed', async t => {
      disposables.push(languages.registerInlayHintsProvider([{ language: '*' }], {
        provideInlayHints: () => {
          return Promise.reject(new Error('Test failure'))
        }
      }))
      let doc = await workspace.document
      let tokenSource = new CancellationTokenSource()
      await languages.provideInlayHints(doc.textDocument, Range.create(0, 0, 1, 0), tokenSource.token)
    })

    it('should merge provider results', async t => {
      disposables.push(languages.registerInlayHintsProvider([{ language: '*' }], {
        provideInlayHints: () => {
          return [InlayHint.create(Position.create(0, 0), 'foo')]
        }
      }))
      disposables.push(languages.registerInlayHintsProvider([{ language: '*' }], {
        provideInlayHints: () => {
          return [
            InlayHint.create(Position.create(0, 0), 'foo'),
            InlayHint.create(Position.create(1, 0), 'bar'),
            InlayHint.create(Position.create(5, 0), 'bad')]
        }
      }))
      disposables.push(languages.registerInlayHintsProvider([{ language: '*' }], {
        provideInlayHints: () => {
          return null
        }
      }))
      await shared.wait(20)
      let doc = await workspace.document
      let tokenSource = new CancellationTokenSource()
      let res = await languages.provideInlayHints(doc.textDocument, Range.create(0, 0, 3, 0), tokenSource.token)
      assert.strictEqual(res.length, 2)
    })

    it('should not throw when provider return null', async t => {
      disposables.push(languages.registerInlayHintsProvider([{ language: '*' }], {
        provideInlayHints: () => {
          throw new CancellationError()
        }
      }))
      let doc = await workspace.document
      let item = handler.getItem(doc.bufnr)
      item.clearCache()
      await item.renderRange([0, 1], CancellationToken.Cancelled)
    })

    it('should resolve inlay hint', async t => {
      disposables.push(languages.registerInlayHintsProvider([{ language: '*' }], {
        provideInlayHints: () => {
          return [InlayHint.create(Position.create(0, 0), 'foo')]
        },
        resolveInlayHint: hint => {
          hint.tooltip = 'tooltip'
          return hint
        }
      }))
      await shared.wait(20)
      let doc = await workspace.document
      let tokenSource = new CancellationTokenSource()
      let res = await languages.provideInlayHints(doc.textDocument, Range.create(0, 0, 1, 0), tokenSource.token)
      let resolved = await languages.resolveInlayHint(res[0], tokenSource.token)
      assert.strictEqual(resolved.tooltip, 'tooltip')
      resolved = await languages.resolveInlayHint(resolved, tokenSource.token)
      assert.strictEqual(resolved.tooltip, 'tooltip')
    })

    it('should not resolve when cancelled', async t => {
      disposables.push(languages.registerInlayHintsProvider([{ language: '*' }], {
        provideInlayHints: () => {
          return [InlayHint.create(Position.create(0, 0), 'foo')]
        },
        resolveInlayHint: (hint, token) => {
          return new Promise(resolve => {
            token.onCancellationRequested(() => {
              clearTimeout(timer)
              resolve(null)
            })
            let timer = setTimeout(() => {
              resolve(Object.assign({}, hint, { tooltip: 'tooltip' }))
            }, 200)
          })
        }
      }))
      await shared.wait(20)
      let doc = await workspace.document
      let tokenSource = new CancellationTokenSource()
      let res = await languages.provideInlayHints(doc.textDocument, Range.create(0, 0, 1, 0), tokenSource.token)
      let p = languages.resolveInlayHint(res[0], tokenSource.token)
      tokenSource.cancel()
      let resolved = await p
      assert.strictEqual(resolved.tooltip, undefined)
    })
  })

  describe('env & options', () => {
    it('should not enabled when disabled by configuration', async t => {
      shared.updateConfiguration('inlayHint.filetypes', [], disposables)
      let doc = await workspace.document
      let item = handler.getItem(doc.bufnr)
      item.clearVirtualText()
      assert.strictEqual(item.enabled, false)
      shared.updateConfiguration('inlayHint.filetypes', ['dos'], disposables)
      doc = await shared.createDocument()
      item = handler.getItem(doc.bufnr)
      assert.strictEqual(item.enabled, false)
    })
  })

  describe('configuration', () => {
    it('should refresh on insert mode', async t => {
      shared.updateConfiguration('inlayHint.refreshOnInsertMode', true, disposables)
      let doc = await shared.createDocument()
      let disposable = await registerProvider('foo\nbar')
      disposables.push(disposable)
      await nvim.input('i')
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'baz\n')])
      await waitRefresh(doc.bufnr)
      let markers = await doc.buffer.getExtMarks(ns, 0, -1, { details: true })
      let obj = markers[0][3].virt_text
      assert.deepStrictEqual(obj, [['baz', 'CocInlayHintType']])
      assert.deepStrictEqual(markers[1][3].virt_text, [['foo', 'CocInlayHintParameter']])
    })

    it('should disable parameter inlayHint', async t => {
      shared.updateConfiguration('inlayHint.enableParameter', false, disposables)
      let doc = await shared.createDocument()
      let disposable = await registerProvider('foo\nbar')
      disposables.push(disposable)
      await waitRefresh(doc.bufnr)
      let markers = await doc.buffer.getExtMarks(ns, 0, -1, { details: true })
      assert.strictEqual(markers.length, 1)
    })

    it('should enable & disable inlayHint', async t => {
      let doc = await shared.createDocument()
      let disposable = await registerProvider('foo\nbar')
      disposables.push(disposable)
      await waitRefresh(doc.bufnr)
      shared.updateConfiguration('inlayHint.enable', false)
      let markers = await doc.buffer.getExtMarks(ns, 0, -1, { details: true })
      assert.strictEqual(markers.length, 0)
      shared.updateConfiguration('inlayHint.enable', true)
    })

    it('should change position to eol', async t => {
      shared.updateConfiguration('inlayHint.position', 'eol', disposables)
      let doc = await shared.createDocument()
      let disposable = await registerProvider('foo\nbar')
      disposables.push(disposable)
      await waitRefresh(doc.bufnr)
      let markers = await doc.buffer.getExtMarks(ns, 0, -1, { details: true })
      assert.strictEqual(markers.length, 2)
      for (const m of markers) {
        let detail = m[3]
        assert.strictEqual(detail['virt_text_pos'], 'eol')
      }
    })

    it('should truncate hint label when exceeding maximumLength', async t => {
      shared.updateConfiguration('inlayHint.maximumLength', 13, disposables)
      let doc = await shared.createDocument()
      let disposable = languages.registerInlayHintsProvider([{ language: '*' }], {
        provideInlayHints: () => {
          return [
            InlayHint.create(Position.create(0, 0), 'firstLabel', InlayHintKind.Type),
            InlayHint.create(Position.create(0, 3), 'secondLabel', InlayHintKind.Type),
          ]
        }
      })
      disposables.push(disposable)
      await doc.buffer.setLines(['foo'], { start: 0, end: -1 })
      await doc.synchronize()
      await waitRefresh(doc.bufnr)
      let markers = await doc.buffer.getExtMarks(ns, 0, -1, { details: true })
      assert.strictEqual(markers.length, 2)
      let first = markers[0][3].virt_text
      assert.deepStrictEqual(first, [['firstLabel', 'CocInlayHintType']])
      let second = markers[1][3].virt_text
      assert.deepStrictEqual(second, [['sec…', 'CocInlayHintType']])
    })

    it('should not truncate hint label when maximumLength is 0', async t => {
      shared.updateConfiguration('inlayHint.maximumLength', 0, disposables)
      let doc = await shared.createDocument()
      let disposable = languages.registerInlayHintsProvider([{ language: '*' }], {
        provideInlayHints: () => {
          return [
            InlayHint.create(Position.create(0, 0), 'firstLabel', InlayHintKind.Type),
            InlayHint.create(Position.create(0, 3), 'secondLabel', InlayHintKind.Type),
          ]
        }
      })
      disposables.push(disposable)
      await doc.buffer.setLines(['foo'], { start: 0, end: -1 })
      await doc.synchronize()
      await waitRefresh(doc.bufnr)
      let markers = await doc.buffer.getExtMarks(ns, 0, -1, { details: true })
      assert.strictEqual(markers.length, 2)
      let first = markers[0][3].virt_text
      assert.deepStrictEqual(first, [['firstLabel', 'CocInlayHintType']])
      let second = markers[1][3].virt_text
      assert.deepStrictEqual(second, [['secondLabel', 'CocInlayHintType']])
    })
  })

  describe('inlayHint setState', () => {
    it('should not throw when buffer not exists', async t => {
      handler.setState('toggle', 9)
      await commands.executeCommand('document.toggleInlayHint', 9)
    })

    it('should show message when inlayHint not supported', async t => {
      let doc = await workspace.document
      handler.setState('toggle', doc.bufnr)
      let cmdline = await shared.getCmdline()
      assert.match(cmdline, /not\sfound/)
    })

    it('should show message when not enabled', async t => {
      shared.updateConfiguration('inlayHint.filetypes', [], disposables)
      let doc = await shared.createDocument()
      let disposable = await registerProvider('')
      disposables.push(disposable)
      handler.setState('toggle', doc.bufnr)
      let cmdline = await shared.getCmdline()
      assert.match(cmdline, /not\senabled/)
    })

    it('should toggle inlayHints', async t => {
      let doc = await shared.createDocument()
      let disposable = await registerProvider('foo\nbar')
      disposables.push(disposable)
      handler.setState('toggle', doc.bufnr)
      handler.setState('toggle', doc.bufnr)
      await shared.waitValue(async () => {
        let markers = await doc.buffer.getExtMarks(ns, 0, -1, { details: true })
        return markers.length
      }, 2)
    })

    it('should enable & disable inlayHint', async t => {
      let doc = await shared.createDocument()
      let disposable = await registerProvider('foo\nbar')
      disposables.push(disposable)
      await commands.executeCommand('document.disableInlayHint')
      await commands.executeCommand('document.enableInlayHint')
      let item = handler.getItem(doc.bufnr)
      assert.strictEqual(item.enabled, true)
    })
  })

  describe('render()', () => {
    it('should refresh on vim mode', async t => {
      let doc = await workspace.document
      await nvim.setLine('foo bar')
      let item = handler.getItem(doc.bufnr)
      let r = Range.create(0, 0, 1, 0)
      item.setVirtualText(r, [])
      let hint: InlayHintWithProvider = {
        label: 'string',
        position: Position.create(0, 0),
        providerId: ''
      }
      let paddingHint: InlayHintWithProvider = {
        label: 'string',
        position: Position.create(0, 3),
        providerId: '',
        paddingLeft: true,
        paddingRight: true
      }
      item.setVirtualText(r, [hint, paddingHint])
      await shared.waitValue(async () => {
        let markers = await doc.buffer.getExtMarks(ns, 0, -1, { details: true })
        return markers.length
      }, 2)
    })

    it('should not refresh when languageId not match', async t => {
      let doc = await workspace.document
      disposables.push(languages.registerInlayHintsProvider([{ language: 'javascript' }], {
        provideInlayHints: () => {
          let hint = InlayHint.create(Position.create(0, 0), 'foo')
          return [hint]
        }
      }))
      await nvim.setLine('foo')
      await doc.synchronize()
      await shared.wait(30)
      let markers = await doc.buffer.getExtMarks(ns, 0, -1, { details: true })
      assert.strictEqual(markers.length, 0)
    })

    it('should refresh on text change', async t => {
      let buf = await nvim.buffer
      let disposable = await registerProvider('foo')
      disposables.push(disposable)
      await waitRefresh(buf.id)
      await buf.setLines(['a', 'b', 'c'], { start: 0, end: -1 })
      await waitRefresh(buf.id)
      let markers = await buf.getExtMarks(ns, 0, -1, { details: true })
      assert.strictEqual(markers.length, 3)
      let item = handler.getItem(buf.id)
      await item.render()
      assert.strictEqual(item.current.length, 3)
    })

    it('should refresh on insert leave', async t => {
      let doc = await shared.createDocument()
      let buf = doc.buffer
      let disposable = await registerProvider('foo')
      disposables.push(disposable)
      await nvim.input('i')
      await shared.wait(20)
      await buf.setLines(['a', 'b', 'c'], { start: 0, end: -1 })
      await shared.wait(30)
      let markers = await buf.getExtMarks(ns, 0, -1, { details: true })
      assert.strictEqual(markers.length, 0)
      await nvim.input('<esc>')
      await waitRefresh(doc.bufnr)
      markers = await buf.getExtMarks(ns, 0, -1, { details: true })
      assert.strictEqual(markers.length, 3)
    })

    it('should refresh on provider dispose', async t => {
      let buf = await nvim.buffer
      let disposable = await registerProvider('foo bar')
      await waitRefresh(buf.id)
      disposable.dispose()
      let markers = await buf.getExtMarks(ns, 0, -1, { details: true })
      assert.strictEqual(markers.length, 0)
      let item = handler.getItem(buf.id)
      assert.strictEqual(item.current.length, 0)
      await item.render()
      assert.strictEqual(item.current.length, 0)
    })

    it('should refresh on scroll', async t => {
      let arr = new Array(workspace.env.lines * 5)
      let content = arr.fill('foo').join('\n')
      let buf = await nvim.buffer
      let disposable = await registerProvider(content)
      disposables.push(disposable)
      await waitRefresh(buf.id)
      let item = handler.getItem(buf.id)
      item.clearVirtualText()
      item.clearCache()
      await nvim.command('normal! G')
      await waitRefresh(buf.id)
      let markers = await buf.getExtMarks(ns, 0, -1, { details: true })
      let len = markers.length
      await nvim.command('normal! gg')
      await waitRefresh(buf.id)
      await nvim.command('normal! G')
      markers = await buf.getExtMarks(ns, 0, -1, { details: true })
      assert.ok(markers.length > len)
    })

    it('should cancel previous render', async t => {
      let buf = await nvim.buffer
      let disposable = await registerProvider('foo')
      disposables.push(disposable)
      await waitRefresh(buf.id)
      let item = handler.getItem(buf.id)
      await item.render()
      await item.render()
      assert.strictEqual(item.current.length, 1)
    })

    it('should resend request on CancellationError', async t => {
      let called = 0
      let disposable = languages.registerInlayHintsProvider([{ language: 'vim' }], {
        provideInlayHints: () => {
          called++
          if (called == 1) {
            throw new CancellationError()
          }
          return []
        }
      })
      disposables.push(disposable)
      await shared.wait(20)
      let filepath = await shared.createTmpFile('a\n\b\nc\n', disposables)
      await shared.createDocument(filepath)
      await nvim.command('setfiletype vim')
      await shared.waitValue(() => called, 2)
    })
  })
})
