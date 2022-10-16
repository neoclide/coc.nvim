import { Neovim } from '@chemzqm/neovim'
import { CancellationTokenSource, Disposable, InlayHint, InlayHintKind, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import commands from '../../commands'
import InlayHintHandler from '../../handler/inlayHint/index'
import languages from '../../languages'
import { InlayHintWithProvider, isInlayHint, isValidInlayHint, sameHint } from '../../provider/inlayHintManager'
import { disposeAll } from '../../util'
import { CancellationError } from '../../util/errors'
import workspace from '../../workspace'
import helper, { createTmpFile } from '../helper'

let nvim: Neovim
let handler: InlayHintHandler
let disposables: Disposable[] = []
let ns: number
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  handler = helper.plugin.getHandler().inlayHintHandler
  ns = await nvim.createNamespace('coc-inlayHint')
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  disposeAll(disposables)
  await helper.reset()
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

describe('InlayHint', () => {
  describe('utils', () => {
    it('should check same hint', () => {
      let hint = InlayHint.create(Position.create(0, 0), 'foo')
      expect(sameHint(hint, InlayHint.create(Position.create(0, 0), 'bar'))).toBe(false)
      expect(sameHint(hint, InlayHint.create(Position.create(0, 0), [{ value: 'foo' }]))).toBe(true)
    })

    it('should check valid hint', () => {
      let hint = InlayHint.create(Position.create(0, 0), 'foo')
      expect(isValidInlayHint(hint, Range.create(0, 0, 1, 0))).toBe(true)
      expect(isValidInlayHint(InlayHint.create(Position.create(0, 0), ''), Range.create(0, 0, 1, 0))).toBe(false)
      expect(isValidInlayHint(InlayHint.create(Position.create(3, 0), 'foo'), Range.create(0, 0, 1, 0))).toBe(false)
      expect(isValidInlayHint({ label: 'f' } as any, Range.create(0, 0, 1, 0))).toBe(false)
    })

    it('should check inlayHint instance', async () => {
      expect(isInlayHint(null)).toBe(false)
      let position = Position.create(0, 0)
      expect(isInlayHint({ position, label: null })).toBe(false)
      expect(isInlayHint({ position, label: [{ value: '' }] })).toBe(true)
    })
  })

  describe('provideInlayHints', () => {
    it('should throw when failed', async () => {
      disposables.push(languages.registerInlayHintsProvider([{ language: '*' }], {
        provideInlayHints: () => {
          return Promise.reject(new Error('Test failure'))
        }
      }))
      let doc = await workspace.document
      let fn = async () => {
        let tokenSource = new CancellationTokenSource()
        await languages.provideInlayHints(doc.textDocument, Range.create(0, 0, 1, 0), tokenSource.token)
      }
      await expect(fn()).rejects.toThrow(Error)
    })

    it('should merge provide results', async () => {
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
      let doc = await workspace.document
      let tokenSource = new CancellationTokenSource()
      let res = await languages.provideInlayHints(doc.textDocument, Range.create(0, 0, 3, 0), tokenSource.token)
      expect(res.length).toBe(2)
    })

    it('should resolve inlay hint', async () => {
      disposables.push(languages.registerInlayHintsProvider([{ language: '*' }], {
        provideInlayHints: () => {
          return [InlayHint.create(Position.create(0, 0), 'foo')]
        },
        resolveInlayHint: hint => {
          hint.tooltip = 'tooltip'
          return hint
        }
      }))
      let doc = await workspace.document
      let tokenSource = new CancellationTokenSource()
      let res = await languages.provideInlayHints(doc.textDocument, Range.create(0, 0, 1, 0), tokenSource.token)
      let resolved = await languages.resolveInlayHint(res[0], tokenSource.token)
      expect(resolved.tooltip).toBe('tooltip')
      resolved = await languages.resolveInlayHint(resolved, tokenSource.token)
      expect(resolved.tooltip).toBe('tooltip')
    })

    it('should not resolve when cancelled', async () => {
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
      let doc = await workspace.document
      let tokenSource = new CancellationTokenSource()
      let res = await languages.provideInlayHints(doc.textDocument, Range.create(0, 0, 1, 0), tokenSource.token)
      let p = languages.resolveInlayHint(res[0], tokenSource.token)
      tokenSource.cancel()
      let resolved = await p
      expect(resolved.tooltip).toBeUndefined()
    })
  })

  describe('env & options', () => {
    it('should not create when virtualText not supported', async () => {
      Object.assign(workspace.env, {
        virtualText: false
      })
      disposables.push(Disposable.create(() => {
        Object.assign(workspace.env, {
          virtualText: true
        })
      }))
      let doc = await helper.createDocument()
      let item = handler.getItem(doc.bufnr)
      expect(item).toBeUndefined()
    })

    it('should not enabled when disabled by configuration', async () => {
      helper.updateConfiguration('inlayHint.filetypes', [])
      let doc = await workspace.document
      let item = handler.getItem(doc.bufnr)
      item.clearVirtualText()
      expect(item.enabled).toBe(false)
      helper.updateConfiguration('inlayHint.filetypes', ['dos'])
      doc = await helper.createDocument()
      item = handler.getItem(doc.bufnr)
      expect(item.enabled).toBe(false)
    })
  })

  describe('configuration', () => {
    it('should refresh on insert mode', async () => {
      helper.updateConfiguration('inlayHint.refreshOnInsertMode', true)
      let doc = await helper.createDocument()
      let disposable = await registerProvider('foo\nbar')
      disposables.push(disposable)
      await nvim.input('i')
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'baz\n')])
      await waitRefresh(doc.bufnr)
      let markers = await doc.buffer.getExtMarks(ns, 0, -1, { details: true })
      let obj = markers[0][3].virt_text
      expect(obj).toEqual([['baz', 'CocInlayHintType']])
      expect(markers[1][3].virt_text).toEqual([['foo', 'CocInlayHintParameter']])
    })

    it('should disable parameter inlayHint', async () => {
      helper.updateConfiguration('inlayHint.enableParameter', false)
      let doc = await helper.createDocument()
      let disposable = await registerProvider('foo\nbar')
      disposables.push(disposable)
      await waitRefresh(doc.bufnr)
      let markers = await doc.buffer.getExtMarks(ns, 0, -1, { details: true })
      expect(markers.length).toBe(1)
    })

    it('should use custom subseparator', async () => {
      helper.updateConfiguration('inlayHint.subSeparator', '|')
      let doc = await helper.createDocument()
      let disposable = await registerProvider('foo bar')
      disposables.push(disposable)
      await waitRefresh(doc.bufnr)
      let markers = await doc.buffer.getExtMarks(ns, 0, -1, { details: true })
      let virt_text = markers[0][3].virt_text
      expect(virt_text[1]).toEqual(['|', 'CocInlayHintType'])
    })
  })

  describe('toggle inlayHint', () => {
    it('should not throw when buffer not exists', async () => {
      handler.toggle(9)
      await commands.executeCommand('document.toggleInlayHint', 9)
    })

    it('should show message when inlayHint not supported', async () => {
      let doc = await workspace.document
      handler.toggle(doc.bufnr)
      let cmdline = await helper.getCmdline()
      expect(cmdline).toMatch(/not\sfound/)
    })

    it('should show message when not enabled', async () => {
      helper.updateConfiguration('inlayHint.filetypes', [])
      let doc = await helper.createDocument()
      let disposable = await registerProvider('')
      disposables.push(disposable)
      handler.toggle(doc.bufnr)
      let cmdline = await helper.getCmdline()
      expect(cmdline).toMatch(/not\senabled/)
    })

    it('should toggle inlayHints', async () => {
      let doc = await helper.createDocument()
      let disposable = await registerProvider('foo\nbar')
      disposables.push(disposable)
      handler.toggle(doc.bufnr)
      handler.toggle(doc.bufnr)
      await helper.waitValue(async () => {
        let markers = await doc.buffer.getExtMarks(ns, 0, -1, { details: true })
        return markers.length
      }, 2)
    })
  })

  describe('render()', () => {
    it('should refresh on vim mode', async () => {
      let doc = await workspace.document
      await nvim.setLine('foo bar')
      let item = handler.getItem(doc.bufnr)
      let r = Range.create(0, 0, 1, 0)
      item.setVirtualText(r, [], true)
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
      item.setVirtualText(r, [hint, paddingHint], true)
      await helper.waitValue(async () => {
        let markers = await doc.buffer.getExtMarks(ns, 0, -1, { details: true })
        return markers.length
      }, 2)
    })

    it('should not refresh when languageId not match', async () => {
      let doc = await workspace.document
      disposables.push(languages.registerInlayHintsProvider([{ language: 'javascript' }], {
        provideInlayHints: () => {
          let hint = InlayHint.create(Position.create(0, 0), 'foo')
          return [hint]
        }
      }))
      await nvim.setLine('foo')
      await doc.synchronize()
      await helper.wait(30)
      let markers = await doc.buffer.getExtMarks(ns, 0, -1, { details: true })
      expect(markers.length).toBe(0)
    })

    it('should refresh on text change', async () => {
      let buf = await nvim.buffer
      let disposable = await registerProvider('foo')
      disposables.push(disposable)
      await waitRefresh(buf.id)
      await buf.setLines(['a', 'b', 'c'], { start: 0, end: -1 })
      await waitRefresh(buf.id)
      let markers = await buf.getExtMarks(ns, 0, -1, { details: true })
      expect(markers.length).toBe(3)
      let item = handler.getItem(buf.id)
      await item.renderRange()
      expect(item.current.length).toBe(3)
    })

    it('should refresh on insert leave', async () => {
      let doc = await helper.createDocument()
      let buf = doc.buffer
      let disposable = await registerProvider('foo')
      disposables.push(disposable)
      await nvim.input('i')
      await helper.wait(10)
      await buf.setLines(['a', 'b', 'c'], { start: 0, end: -1 })
      await helper.wait(30)
      let markers = await buf.getExtMarks(ns, 0, -1, { details: true })
      expect(markers.length).toBe(0)
      await nvim.input('<esc>')
      await waitRefresh(doc.bufnr)
      markers = await buf.getExtMarks(ns, 0, -1, { details: true })
      expect(markers.length).toBe(3)
    })

    it('should refresh on provider dispose', async () => {
      let buf = await nvim.buffer
      let disposable = await registerProvider('foo bar')
      await waitRefresh(buf.id)
      disposable.dispose()
      let markers = await buf.getExtMarks(ns, 0, -1, { details: true })
      expect(markers.length).toBe(0)
      let item = handler.getItem(buf.id)
      expect(item.current.length).toBe(0)
      await item.renderRange()
      expect(item.current.length).toBe(0)
    })

    it('should refresh on scroll', async () => {
      let arr = new Array(200)
      let content = arr.fill('foo').join('\n')
      let buf = await nvim.buffer
      let disposable = await registerProvider(content)
      disposables.push(disposable)
      await waitRefresh(buf.id)
      let markers = await buf.getExtMarks(ns, 0, -1, { details: true })
      let len = markers.length
      await nvim.command('normal! G')
      await waitRefresh(buf.id)
      await nvim.input('<C-y>')
      await waitRefresh(buf.id)
      markers = await buf.getExtMarks(ns, 0, -1, { details: true })
      expect(markers.length).toBeGreaterThan(len)
    })

    it('should cancel previous render', async () => {
      let buf = await nvim.buffer
      let disposable = await registerProvider('foo')
      disposables.push(disposable)
      await waitRefresh(buf.id)
      let item = handler.getItem(buf.id)
      await item.renderRange()
      await item.renderRange()
      expect(item.current.length).toBe(1)
    })

    it('should resend request on CancellationError', async () => {
      let called = 0
      let disposable = languages.registerInlayHintsProvider([{ language: 'vim' }], {
        provideInlayHints: () => {
          if (called == 0) {
            called++
            throw new CancellationError()
          }
          return []
        }
      })
      disposables.push(disposable)
      let filepath = await createTmpFile('a\n\b\nc\n', disposables)
      let doc = await helper.createDocument(filepath)
      await nvim.command('setfiletype vim')
      await waitRefresh(doc.buffer.id)
      expect(called).toBe(1)
    })
  })
})
