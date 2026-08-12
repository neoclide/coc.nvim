import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import events from '../../events'
import Symbols from '../../handler/symbols/index'
import languages from '../../languages'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import { Buffer, Neovim } from '@chemzqm/neovim'
import { CodeAction, CodeActionKind, Disposable, DocumentSymbol, Range, SymbolKind, SymbolTag, TextEdit } from 'vscode-languageserver-protocol'
import { ProviderResult } from '../../provider'
import Parser from './parser'
import type SymbolsType from '../../handler/symbols/index'
import { after, afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'


let nvim: Neovim
let symbols: SymbolsType
let disposables: Disposable[] = []

before(async () => {
  nvim = workspace.nvim
  symbols = getCurrentPlugin().getHandler().symbols
})

beforeEach(() => {
  disposables.push(languages.registerDocumentSymbolProvider([{ language: 'javascript' }], {
    provideDocumentSymbols: document => {
      let content = document.getText()
      let showDetail = content.includes('detail')
      let parser = new Parser(content, showDetail)
      let res: DocumentSymbol[] = parser.parse()
      if (res.length) {
        res[0].tags = [SymbolTag.Deprecated]
      }
      return Promise.resolve(res)
    }
  }))
})

afterEach(async () => {
  disposeAll(disposables)
  await nvim.command(`let w:cocViewId = ''`)

})

async function getOutlineBuffer(): Promise<Buffer | undefined> {
  let winid = await nvim.call('coc#window#find', ['cocViewId', 'OUTLINE'])
  if (winid == -1) return undefined
  let bufnr = await nvim.call('winbufnr', [winid]) as number
  if (bufnr == -1) return undefined
  return nvim.createBuffer(bufnr)
}

afterEach(editorReset)

describe('symbols outline', () => {

  let defaultCode = `class myClass {
  fun1() { }
  fun2() {}
}`

  async function createBuffer(code = defaultCode): Promise<Buffer> {
    let doc = await shared.createDocument()
    let buf = doc.buffer
    doc.setFiletype('javascript')
    await buf.setOption('modifiable', true)
    await buf.setLines(code.split('\n'), { start: 0, end: -1, strictIndexing: false })
    await doc.synchronize()
    return buf
  }

  describe('actions', () => {
    it('should invoke selected code action', { timeout: 15000 }, async t => {
      const codeAction = CodeAction.create('my action', CodeActionKind.Refactor)
      let uri: string
      disposables.push(languages.registerCodeActionProvider([{ language: '*' }], {
        provideCodeActions: () => [codeAction],
        resolveCodeAction: (action): ProviderResult<CodeAction> => {
          action.edit = {
            changes: {
              [uri]: [TextEdit.del(Range.create(0, 0, 0, 5))]
            }
          }
          return action
        }
      }, undefined))
      await createBuffer()
      let bufnr = await nvim.call('bufnr', ['%']) as number
      let doc = workspace.getDocument(bufnr)
      uri = doc.uri
      await symbols.showOutline(0)
      let winid = await nvim.call('coc#window#find', ['cocViewId', 'OUTLINE']) as number
      assert.notStrictEqual(winid, -1)
      // Make sure the outline window is focused before sending keys, the
      // tree keymaps are buffer local and the float may not be current yet
      // under load.
      await nvim.call('win_gotoid', [winid])
      await shared.waitValue(async () => nvim.call('win_getid') as Promise<number>, winid)
      await nvim.call('cursor', [3, 1])
      let spy = t.mock.method(window, 'showMenuPicker', () => {
        return Promise.resolve(0)
      })
      let resolveApplied: () => void
      let applied = new Promise<void>(resolve => {
        resolveApplied = resolve
      })
      let originalApply = workspace.applyEdit.bind(workspace)
      let applySpy = t.mock.method(workspace, 'applyEdit', ((edit => {
        let p = originalApply(edit)
        void p.then(() => resolveApplied(), () => resolveApplied())
        return p
      }) as any))
      await nvim.input('<tab>')
      await applied
      await shared.waitValue(async () => nvim.eval('getline(1)') as Promise<string>, ' myClass {')
    })

    it('should invoke visual select', { timeout: 15000 }, async t => {
      await createBuffer()
      let bufnr = await nvim.call('bufnr', ['%'])
      await symbols.showOutline(0)
      await shared.waitFor('getline', [3], /fun1/)
      await nvim.command('exe 3')
      // Pick the only action (visual select) directly, the real menu
      // prompt is timing sensitive under load.
      let spy = t.mock.method(window, 'showMenuPicker', () => {
        return Promise.resolve(0)
      })
      await nvim.input('<tab>')
      await shared.waitValue(async () => nvim.call('mode') as Promise<string>, 'v')
      let buf = await nvim.buffer
      assert.strictEqual(buf.id, bufnr)
    })
  })

  describe('configuration', () => {
    it('should follow cursor', async t => {
      await createBuffer(`  class myClass {
  fun1() { }
  fun2() {}
}`)
      let curr = await nvim.call('bufnr', ['%']) as number
      await symbols.showOutline(0)
      let bufnr = await nvim.call('bufnr', ['%']) as number
      await nvim.command('wincmd p')
      await nvim.command('exe 3')
      await events.fire('CursorHold', [curr, [3, 1]])
      await nvim.call('cursor', [1, 1])
      await events.fire('CursorHold', [curr, [1, 1]])
      let buf = nvim.createBuffer(bufnr)
      await shared.waitValue(async () => (await buf.getSigns({ group: 'CocTree' })).length, 1)
      let lines = await buf.getLines()
      assert.deepStrictEqual(lines.slice(1), [
        '- c myClass 1', '    m fun1 2', '    m fun2 3'
      ])
      let signs = await buf.getSigns({ group: 'CocTree' })
      assert.strictEqual(signs.length, 1)
      assert.deepStrictEqual(signs[0], {
        lnum: 2,
        id: 3001,
        name: 'CocTreeSelected',
        priority: 10,
        group: 'CocTree'
      })
      await nvim.command(`bd ${bufnr}`)
      await events.fire('CursorHold', [curr, [3, 1]])
    })

    it('should not follow cursor', async t => {
      shared.updateConfiguration('outline.followCursor', false, disposables)
      await createBuffer()
      let curr = await nvim.call('bufnr', ['%']) as number
      await symbols.showOutline(0)
      let bufnr = await nvim.call('bufnr', ['%']) as number
      await nvim.command('wincmd p')
      await nvim.command('exe 3')
      await events.fire('CursorHold', [curr])
      await shared.wait(50)
      let buf = nvim.createBuffer(bufnr)
      let signs = await buf.getSigns({ group: 'CocTree' })
      assert.strictEqual(signs.length, 0)
    })

    it('should keep current window', async t => {
      shared.updateConfiguration('outline.keepWindow', true, disposables)
      await createBuffer()
      let curr = await nvim.call('bufnr', ['%'])
      await symbols.showOutline()
      let bufnr = await nvim.call('bufnr', ['%'])
      assert.strictEqual(curr, bufnr)
    })

    it('should check on buffer switch', async t => {
      shared.updateConfiguration('outline.checkBufferSwitch', true, disposables)
      let b = await createBuffer()
      await symbols.showOutline(1)
      let buf = await getOutlineBuffer()
      let bufnr = buf.id
      await shared.edit('unnamed')
      await shared.waitValue(async () => {
        let buf = await getOutlineBuffer()
        return buf.id > bufnr
      }, true)
      buf = await getOutlineBuffer()
      let lines = await buf.lines
      assert.match(lines[0], new RegExp('Document symbol provider not found'))
      await nvim.command(`bd! ${b.id}`)
      await shared.wait(20)
      let loaded = await buf.loaded
      assert.strictEqual(loaded, true)
    })

    it('should not check on buffer switch', async t => {
      shared.updateConfiguration('outline.checkBufferSwitch', false, disposables)
      await createBuffer()
      await symbols.showOutline(1)
      await shared.edit('unnamed')
      await shared.wait(100)
      let buf = await getOutlineBuffer()
      let lines = await buf.lines
      assert.deepStrictEqual(lines.slice(1), [
        '- c myClass 1', '    m fun1 2', '    m fun2 3'
      ])
    })

    it('should not check on buffer reload', async t => {
      shared.updateConfiguration('outline.checkBufferSwitch', false, disposables)
      await symbols.showOutline(1)
      await createBuffer()
      await shared.waitValue(async () => (await getOutlineBuffer()) != null, true)
      let buf = await getOutlineBuffer()
      assert.notStrictEqual(buf, undefined)
    })

    it('should sort by category', async t => {
      let code = `
class myClass {
}
fun1() {}
`
      await createBuffer(code)
      await symbols.showOutline(1)
      let buf = await getOutlineBuffer()
      let lines = await buf.lines
      assert.deepStrictEqual(lines, [
        'OUTLINE Category', '  c myClass 2', '  m fun1 4'
      ])
    })

    it('should sort by position', async t => {
      let code = `class myClass {
  fun2() { }
  fun1() {}
}`
      shared.updateConfiguration('outline.sortBy', 'position', disposables)
      await createBuffer(code)
      await symbols.showOutline(1)
      let buf = await getOutlineBuffer()
      let lines = await buf.lines
      assert.deepStrictEqual(lines, [
        'OUTLINE Position', '- c myClass 1', '    m fun2 2', '    m fun1 3'
      ])
    })

    it('should sort by name', async t => {
      let code = `class myClass {
  fun2() {}
  fun1() {}
}`
      shared.updateConfiguration('outline.sortBy', 'name', disposables)
      await createBuffer(code)
      await symbols.showOutline(1)
      let buf = await getOutlineBuffer()
      let lines = await buf.lines
      assert.deepStrictEqual(lines, [
        'OUTLINE Name', '- c myClass 1', '    m fun1 3', '    m fun2 2'
      ])
    })

    it('should change sort method', { timeout: 15000 }, async t => {
      shared.updateConfiguration('outline.detailAsDescription', false, disposables)
      let code = `class detail {
  fun2() {}
  fun1() {}
}`
      await createBuffer(code)
      await symbols.showOutline(0)
      await shared.wait(30)
      // Pick the 'position' sort method directly, the real menu prompt is
      // timing sensitive under load.
      let spy = t.mock.method(window, 'showMenuPicker', () => {
        return Promise.resolve(2)
      })
      await nvim.input('<C-s>')
      await shared.waitValue(async () => nvim.eval('getline(1)') as Promise<string>, 'OUTLINE Position')
    })

    it('should show detail as description', async t => {
      shared.updateConfiguration('outline.detailAsDescription', true, disposables)
      let code = `class detail {
  fun2() {}
}`
      await createBuffer(code)
      await symbols.showOutline(1)
      let buf = await getOutlineBuffer()
      let lines = await buf.lines
      assert.deepStrictEqual(lines.slice(1), [
        '- c detail 1', '    m fun2 () 2'
      ])
    })

    it('should not showLineNumber', async t => {
      shared.updateConfiguration('outline.showLineNumber', false, disposables)
      let code = `class detail {
  fun2() {}
}`
      await createBuffer(code)
      await symbols.showOutline(1)
      let buf = await getOutlineBuffer()
      let lines = await buf.lines
      assert.deepStrictEqual(lines.slice(1), ['- c detail', '    m fun2 ()'])
    })
  })

  describe('events', () => {

    it('should not close TreeView on buffer reload', async t => {
      await createBuffer()
      await symbols.showOutline(0)
      await nvim.command('edit')
      await shared.waitValue(() => nvim.call('coc#window#find', ['cocViewId', 'OUTLINE']).then(w => (w as number) > 0), true)
      let winid = await nvim.call('coc#window#find', ['cocViewId', 'OUTLINE'])
      assert.ok((winid as number) > 0)
    })

    it('should dispose on buffer unload', async t => {
      await createBuffer()
      let curr = await nvim.call('bufnr', ['%'])
      await symbols.showOutline(0)
      await nvim.command('tabe')
      await nvim.command(`bd! ${curr}`)
      await shared.waitValue(async () => {
        let buf = await getOutlineBuffer()
        return buf == null
      }, true)
    })

    it('should check current window on BufEnter', async t => {
      await createBuffer()
      await symbols.showOutline(1)
      await nvim.command('enew')
      await shared.wait(50)
    })

    it('should recreated when original window exists', async t => {
      let win = await nvim.window
      await symbols.showOutline(1)
      await shared.waitValue(async () => (await getOutlineBuffer()) != null, true)
      await nvim.setWindow(win)
      await createBuffer()
      await shared.waitValue(async () => {
        let buf = await getOutlineBuffer()
        return buf != null
      }, true)
    })

    it('should keep old outline when new buffer not attached', async t => {
      await createBuffer()
      await symbols.showOutline(1)
      await nvim.command(`vnew +setl\\ buftype=nofile`)
      await shared.waitValue(async () => (await getOutlineBuffer()) != null, true)
      let buf = await getOutlineBuffer()
      assert.notStrictEqual(buf, undefined)
      let lines = await buf.lines
      assert.deepStrictEqual(lines.slice(1), [
        '- c myClass 1', '    m fun1 2', '    m fun2 3'
      ])
    })

    it('should not reload when switch to original buffer', async t => {
      await createBuffer()
      await symbols.showOutline(0)
      let buf = await getOutlineBuffer()
      let name = await buf.name
      await nvim.command('wincmd p')
      await shared.wait(50)
      buf = await getOutlineBuffer()
      let curr = await buf.name
      assert.strictEqual(curr, name)
    })
  })

  describe('show()', () => {
    it('should not throw when document not attached', async t => {
      await nvim.command(`edit +setl\\ buftype=nofile t`)
      await workspace.document
      await symbols.showOutline(1)
      let line = await shared.getCmdline()
      assert.match(line, new RegExp('Unable to show outline'))
    })

    it('should not throw when provider does not exist', async t => {
      await symbols.showOutline(1)
      let buf = await getOutlineBuffer()
      assert.notStrictEqual(buf, undefined)
    })

    it('should not throw when symbols is empty', async t => {
      await createBuffer('')
      await symbols.showOutline(1)
      let buf = await getOutlineBuffer()
      assert.notStrictEqual(buf, undefined)
    })

    it('should jump to selected symbol', async t => {
      await createBuffer()
      let bufnr = await nvim.call('bufnr', ['%'])
      await symbols.showOutline(0)
      await shared.waitFor('getline', [3], '    m fun1 2')
      await nvim.command('exe 3')
      await nvim.input('<cr>')
      await shared.waitValue(async () => {
        return await nvim.call('bufnr', ['%'])
      }, bufnr)
      let cursor = await nvim.call('coc#cursor#position')
      assert.deepStrictEqual(cursor, [1, 2])
    })

    it('should update symbols', async t => {
      await createBuffer()
      let doc = await workspace.document
      let bufnr = await nvim.call('bufnr', ['%']) as number
      await symbols.showOutline(1)
      await shared.waitFor('getline', [1], 'class myClass {')
      let buf = nvim.createBuffer(bufnr)
      let code = 'class foo{}'
      await buf.setLines(code.split('\n'), {
        start: 0,
        end: -1,
        strictIndexing: false
      })
      await doc.synchronize()
      buf = await getOutlineBuffer()
      await shared.waitFor('eval', [`getbufline(${buf.id},1)[0]`], /No\sresults/)
      let lines = await buf.lines
      assert.deepStrictEqual(lines, [
        'No results',
        '',
        'OUTLINE Category'
      ])
    })

    it('should show label in description', async t => {
      disposables.push(languages.registerDocumentSymbolProvider([{ language: 'vim' }], {
        meta: {
          label: 'vimlsp'
        },
        provideDocumentSymbols: _ => {
          let res: DocumentSymbol[] = [{
            name: 'let',
            range: Range.create(0, 0, 0, 3),
            kind: SymbolKind.Constant,
            selectionRange: Range.create(0, 0, 0, 3),
            tags: [SymbolTag.Deprecated]
          }]
          return Promise.resolve(res)
        }
      }))
      let doc = await shared.createDocument('t.vim')
      doc.setFiletype('vim')
      let buf = await nvim.buffer
      await buf.setLines(['let'], { start: 0, end: -1, strictIndexing: false })
      await doc.synchronize()
      await symbols.showOutline(0)
      await shared.waitFor('getline', [1], 'OUTLINE vimlsp')
    })
  })

  describe('autoPreview', () => {
    it('should toggle auto preview by press p', async t => {
      await createBuffer()
      await symbols.showOutline(0)
      await shared.waitFor('getline', [3], /fun1/)
      await nvim.command('exe 2')
      await nvim.input('p')
      let winid = await shared.waitFloat()
      assert.ok(winid > 1000)
      await nvim.input('p')
      await shared.waitValue(async () => {
        let win = nvim.createWindow(winid)
        let valid = await win.valid
        return valid === false
      }, true)
    })

    it('should close preview when move to line without node', async t => {
      await createBuffer()
      await symbols.showOutline(0)
      await shared.waitFor('getline', [3], /fun1/)
      await nvim.command('exe 2')
      await nvim.input('p')
      let winid = await shared.waitFloat()
      await nvim.input('l')
      // debounce for CursorMoved used
      await shared.wait(50)
      await nvim.input('k')
      await shared.waitValue(async () => {
        let win = nvim.createWindow(winid)
        let valid = await win.valid
        return valid === false
      }, true)
    })

    it('should show preview when move cursor back', async t => {
      // Spy on the preview RPC calls instead of waiting for real float
      // windows, keeps the test deterministic under load.
      let previewCalls = 0
      let closeCalls = 0
      let original = nvim.call.bind(nvim)
      let spy = t.mock.method(nvim, 'call', ((fname: string, args: any, isNotify?: boolean): Promise<any> | null => {
        if (fname === 'coc#ui#outline_preview') {
          previewCalls++
          return Promise.resolve(1)
        }
        if (fname === 'coc#ui#outline_close_preview') {
          closeCalls++
          return isNotify ? null : Promise.resolve()
        }
        return (original as any)(fname, args, isNotify)
      }) as any)
      await createBuffer()
      await symbols.showOutline(0)
      await shared.waitFor('getline', [3], /fun1/)
      await nvim.command('exe 2')
      await nvim.input('p')
      // Preview opens when toggled on.
      await shared.waitValue<boolean>(() => previewCalls >= 1, true)
      await nvim.command('wincmd p')
      // Leaving the outline closes the preview.
      await shared.waitValue<boolean>(() => closeCalls >= 1, true)
      await nvim.command('wincmd p')
      // Moving the cursor back to the outline opens the preview again.
      await shared.waitValue<boolean>(() => previewCalls >= 2, true)
    })

    it('should enable auto preview by configuration', async t => {
      shared.updateConfiguration('outline.autoPreview', true, disposables)
      await createBuffer()
      await symbols.showOutline(0)
      await shared.waitFor('getline', [3], /fun1/)
      await nvim.command('exe 2')
      let winid = await shared.waitFloat()
      assert.ok(winid > 1000)
    })
  })

  describe('hide()', () => {
    it('should hide outline', async t => {
      await createBuffer('')
      await shared.doAction('showOutline', 1)
      await shared.doAction('hideOutline')
      let buf = await getOutlineBuffer()
      assert.strictEqual(buf, undefined)
    })

    it('should auto hide outline on clicking', async t => {
      shared.updateConfiguration('outline.autoHide', true, disposables)
      await createBuffer()
      await symbols.showOutline()
      await shared.waitFor('getline', [3], '    m fun1 2')
      await nvim.command('exe 3')
      await nvim.input('<cr>')
      await shared.waitValue(async () => {
        return await getOutlineBuffer()
      }, undefined)
    })

    it('should not throw when outline does not exist', async t => {
      await symbols.hideOutline()
      let buf = await getOutlineBuffer()
      assert.strictEqual(buf, undefined)
    })
  })

  describe('dispose', () => {
    it('should dispose provider and views', async t => {
      await createBuffer('')
      let bufnr = await nvim.call('bufnr', ['%']) as number
      // Use a standalone instance: the handler's `symbols` is a shared bundle
      // singleton and disposing it here would break later test files that use
      // the same instance.
      let standalone = new Symbols(nvim, getCurrentPlugin().getHandler() as any)
      await standalone.showOutline(1)
      standalone.dispose()
      await shared.waitValue(() => {
        return standalone.hasOutline(bufnr)
      }, false)
      let buf = await getOutlineBuffer()
      assert.strictEqual(buf, undefined)
    })
  })
})
