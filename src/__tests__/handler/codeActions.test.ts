import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import commands from '../../commands'
import ActionsHandler, { shouldAutoApply } from '../../handler/codeActions'
import languages, { ProviderName } from '../../languages'
import { ProviderResult } from '../../provider'
import { checkAction } from '../../provider/codeActionManager'
import { disposeAll } from '../../util'
import { rangeInRange } from '../../util/position'
import window from '../../window'
import workspace from '../../workspace'
import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, Command, Disposable, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import { afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'


let nvim: Neovim
let disposables: Disposable[] = []
let codeActions: ActionsHandler
let currActions: (CodeAction | Command)[]
let resolvedAction: CodeAction
before(async () => {
  nvim = workspace.nvim
  codeActions = getCurrentPlugin().getHandler().codeActions
})

beforeEach(async () => {
  disposables.push(languages.registerCodeActionProvider([{ language: '*' }], {
    provideCodeActions: (
      _document: TextDocument,
      _range: Range,
      _context: CodeActionContext,
      _token: CancellationToken
    ) => currActions,
    resolveCodeAction: (
      _action: CodeAction,
      _token: CancellationToken
    ): ProviderResult<CodeAction> => resolvedAction
  }, undefined))
})

afterEach(async () => {
  disposeAll(disposables)
})

describe('handler codeActions', () => {
  describe('autoApply', () => {
    it('should check auto apply', async t => {
      assert.strictEqual(shouldAutoApply(undefined), false)
      assert.strictEqual(shouldAutoApply([]), false)
      assert.strictEqual(shouldAutoApply([CodeActionKind.Refactor]), false)
    })
  })

  describe('organizeImport', () => {
    it('should filter command', t => {
      let cmd = Command.create('title', 'command')
      let res = checkAction([CodeActionKind.Refactor], cmd)
      assert.strictEqual(res, false)
      res = checkAction(undefined, cmd)
      assert.strictEqual(res, true)
    })

    it('should return false when organize import action not found', async t => {
      currActions = []
      let doc = await shared.createDocument()
      assert.strictEqual(languages.hasProvider(ProviderName.CodeAction, doc), true)
      let res = await shared.doAction('organizeImport')
      assert.strictEqual(res, false)
      assert.strictEqual(languages.hasProvider('undefined' as any, doc), false)
    })

    it('should perform organize import action', async t => {
      let doc = await shared.createDocument()
      await doc.buffer.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false })
      let edits: TextEdit[] = []
      edits.push(TextEdit.replace(Range.create(0, 0, 0, 3), 'bar'))
      edits.push(TextEdit.replace(Range.create(1, 0, 1, 3), 'foo'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('organize import', edit, CodeActionKind.SourceOrganizeImports)
      currActions = [action, CodeAction.create('another action'), Command.create('title', 'command')]
      await codeActions.organizeImport()
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['bar', 'foo'])
    })

    it('should register editor.action.organizeImport command', async t => {
      let doc = await shared.createDocument()
      currActions = []
      await commands.executeCommand('editor.action.organizeImport')
      await doc.buffer.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false })
      let edits: TextEdit[] = []
      edits.push(TextEdit.replace(Range.create(0, 0, 0, 3), 'bar'))
      edits.push(TextEdit.replace(Range.create(1, 0, 1, 3), 'foo'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('organize import', edit, CodeActionKind.SourceOrganizeImports)
      currActions = [action, CodeAction.create('another action')]
      await commands.executeCommand('editor.action.organizeImport')
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['bar', 'foo'])
    })
  })

  describe('codeActionRange', () => {
    it('should show warning when no action available', async t => {
      await shared.createDocument()
      currActions = []
      await shared.doAction('codeActionRange', 1, 2, CodeActionKind.QuickFix)
      let line = await shared.getCmdline()
      assert.match(line, /No quickfix code action/)
      await shared.doAction('codeActionRange', 1, 2)
      line = await shared.getCmdline()
      assert.match(line, /No code action available/)
    })

    it('should apply chosen action', async t => {
      let doc = await shared.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', edit, CodeActionKind.QuickFix)
      currActions = [action]
      let p = codeActions.codeActionRange(1, 2, CodeActionKind.QuickFix)
      await shared.waitPrompt()
      await nvim.input('<CR>')
      await p
      let buf = nvim.createBuffer(doc.bufnr)
      let lines = await buf.lines
      assert.strictEqual(lines[0], 'bar')
    })

    it('should show command tooltip in code action menu', async t => {
      await shared.createDocument()
      disposables.push(commands.registerCommand('cmd.fix', () => {}))
      disposables.push(commands.registerCommand('cmd.refactor', () => {}))
      currActions = [{
        title: 'fix',
        kind: CodeActionKind.QuickFix,
        command: { title: 'fix', command: 'cmd.fix', tooltip: 'apply the fix' }
      }, {
        title: 'refactor',
        kind: CodeActionKind.Refactor,
        command: { title: 'refactor', command: 'cmd.refactor', tooltip: 'do the refactor' }
      }]
      let p = shared.doAction('codeAction', undefined)
      await shared.waitPrompt()
      let win = await shared.getFloat()
      assert.notStrictEqual(win, undefined)
      let lines = await shared.getWinLines(win.id)
      assert.match(lines.join('\n'), /fix - apply the fix/)
      assert.match(lines.join('\n'), /refactor - do the refactor/)
      await nvim.input('<cr>')
      await p
    })
  })

  describe('getCodeActions', () => {
    it('should get empty actions', async t => {
      currActions = []
      let doc = await shared.createDocument()
      let res = await codeActions.getCodeActions(doc)
      assert.strictEqual(res.length, 0)
    })

    it('should not filter disabled actions', async t => {
      currActions = []
      let action = CodeAction.create('foo', CodeActionKind.Source)
      currActions.push(action)
      action = CodeAction.create('action', CodeActionKind.Empty)
      currActions.push(action)
      action = CodeAction.create('bar', CodeActionKind.QuickFix)
      action.disabled = { reason: 'disabled' }
      currActions.push(action)
      let doc = await shared.createDocument()
      let res = await codeActions.getCodeActions(doc, Range.create(0, 0, 1, 0))
      assert.strictEqual(res.length, 2)
    })

    it('should get all actions', async t => {
      let doc = await shared.createDocument()
      await doc.buffer.setLines(['', '', ''], { start: 0, end: -1, strictIndexing: false })
      let action = CodeAction.create('curr action', CodeActionKind.Empty)
      currActions = [action]
      let range: Range
      disposables.push(languages.registerCodeActionProvider([{ language: '*' }], {
        provideCodeActions: (
          _document: TextDocument,
          r: Range,
          _context: CodeActionContext, _token: CancellationToken
        ) => {
          range = r
          return [CodeAction.create('a'), CodeAction.create('b'), CodeAction.create('c'), Command.create('title', 'command')]
        },
      }, undefined))
      disposables.push(languages.registerCodeActionProvider([{ language: '*' }], {
        provideCodeActions: () => {
          return [CodeAction.create('a')]
        },
      }, undefined))
      let res = await codeActions.getCodeActions(doc)
      assert.deepStrictEqual(range, Range.create(0, 0, 3, 0))
      assert.strictEqual(res.length, 5)
    })

    it('should filter actions by range', async t => {
      let doc = await shared.createDocument()
      await doc.buffer.setLines(['', '', ''], { start: 0, end: -1, strictIndexing: false })
      currActions = []
      let range: Range
      disposables.push(languages.registerCodeActionProvider([{ language: '*' }], {
        provideCodeActions: (
          _document: TextDocument,
          r: Range,
          _context: CodeActionContext, _token: CancellationToken
        ) => {
          range = r
          if (rangeInRange(r, Range.create(0, 0, 1, 0))) return [CodeAction.create('a')]
          return [CodeAction.create('a'), CodeAction.create('b'), CodeAction.create('c')]
        },
      }, undefined))
      let res = await codeActions.getCodeActions(doc, Range.create(0, 0, 0, 0))
      assert.deepStrictEqual(range, Range.create(0, 0, 0, 0))
      assert.strictEqual(res.length, 1)
    })

    it('should filter actions by kind prefix', async t => {
      let doc = await shared.createDocument()
      let action = CodeAction.create('my action', CodeActionKind.SourceFixAll)
      currActions = [action]
      let res = await codeActions.getCodeActions(doc, undefined, [CodeActionKind.Source])
      assert.strictEqual(res.length, 1)
      assert.strictEqual(res[0].kind, CodeActionKind.SourceFixAll)
      await shared.doAction('fixAll')
    })
  })

  describe('getCurrentCodeActions', () => {
    let range: Range
    beforeEach(() => {
      disposables.push(languages.registerCodeActionProvider([{ language: '*' }], {
        provideCodeActions: (
          _document: TextDocument,
          r: Range,
          _context: CodeActionContext, _token: CancellationToken
        ) => {
          range = r
          return [CodeAction.create('a'), CodeAction.create('b'), CodeAction.create('c')]
        },
      }, undefined))
    })

    it('should get codeActions by line', async t => {
      currActions = []
      await shared.createDocument()
      let res = await shared.doAction('codeActions', 'line')
      assert.deepStrictEqual(range, Range.create(0, 0, 1, 0))
      assert.strictEqual(res.length, 3)
    })

    it('should get codeActions by cursor', async t => {
      currActions = []
      await shared.createDocument()
      let res = await codeActions.getCurrentCodeActions('cursor')
      assert.deepStrictEqual(range, Range.create(0, 0, 0, 0))
      assert.strictEqual(res.length, 3)
    })

    it('should get codeActions by visual mode', async t => {
      currActions = []
      await shared.createDocument()
      await nvim.setLine('foo')
      await nvim.command('normal! 0v$')
      await nvim.input('<esc>')
      let res = await codeActions.getCurrentCodeActions('v')
      assert.deepStrictEqual(range, Range.create(0, 0, 0, 3))
      assert.strictEqual(res.length, 3)
    })
  })

  describe('doCodeAction', () => {
    it('should not throw when no action exists', async t => {
      currActions = []
      await shared.createDocument()
      await shared.doAction('codeAction', undefined)
    })

    it('should apply single code action when only is title', async t => {
      let doc = await shared.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', edit, CodeActionKind.QuickFix)
      currActions = [action]
      await codeActions.doCodeAction(undefined, 'code fix')
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['bar'])
    })

    it('should apply single code action when only is QuickFix', async t => {
      let doc = await shared.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', edit, CodeActionKind.QuickFix)
      currActions = [action]
      await codeActions.doCodeAction(undefined, [CodeActionKind.QuickFix])
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['bar'])
    })

    it('should show disabled code action', async t => {
      let doc = await shared.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let refactorAction = CodeAction.create('code refactor', edit, CodeActionKind.Refactor)
      refactorAction.disabled = { reason: 'invalid position' }
      let fixAction = CodeAction.create('code fix', edit, CodeActionKind.QuickFix)
      currActions = [refactorAction, fixAction]
      let p = codeActions.doCodeAction(undefined, undefined, true)
      let winid = await shared.waitFloat()
      let win = nvim.createWindow(winid)
      let buf = await win.buffer
      let lines = await buf.lines
      assert.strictEqual(lines.length, 2)
      assert.match(lines[1], /code refactor/)
      await nvim.input('2')
      await shared.wait(20)
      await nvim.input('j')
      await nvim.input('<cr>')
      await shared.waitValue(async () => {
        let cmdline = await shared.getCmdline()
        return cmdline.includes('invalid position')
      }, true)
      await nvim.input('<esc>')
      await p
    })

    it('should action dialog to choose action', async t => {
      let doc = await shared.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', edit, CodeActionKind.QuickFix)
      currActions = [action, CodeAction.create('foo')]
      let promise = codeActions.doCodeAction(null, undefined)
      await shared.waitFloat()
      let ids = await nvim.call('coc#float#get_float_win_list') as number[]
      assert.ok(ids.length > 0)
      await nvim.input('<CR>')
      await promise
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['bar'])
    })

    it('should choose code actions by range', async t => {
      let range: Range
      disposables.push(languages.registerCodeActionProvider([{ language: '*' }], {
        provideCodeActions: (
          _document: TextDocument,
          r: Range,
          _context: CodeActionContext, _token: CancellationToken
        ) => {
          range = r
          return [CodeAction.create('my title'), CodeAction.create('b'), CodeAction.create('c')]
        },
      }, undefined))
      await shared.createDocument()
      await nvim.setLine('abc')
      await nvim.command('normal! 0v$')
      await nvim.input('<esc>')
      await codeActions.doCodeAction('v', 'my title')
      assert.deepStrictEqual(range, { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } })
    })

    it('should filter by provider kinds', async t => {
      currActions = []
      disposables.push(languages.registerCodeActionProvider([{ language: '*' }], {
        provideCodeActions: () => {
          return [CodeAction.create('my title'), CodeAction.create('b'), CodeAction.create('c')]
        },
      }, undefined, [CodeActionKind.QuickFix]))
      let doc = await workspace.document
      let res = await languages.getCodeActions(doc.textDocument, Range.create(0, 0, 1, 1), { only: [CodeActionKind.Refactor], diagnostics: [] }, CancellationToken.None)
      assert.deepStrictEqual(res, [])
    })

    it('should filter by codeAction kind', async t => {
      currActions = []
      disposables.push(languages.registerCodeActionProvider([{ language: '*' }], {
        provideCodeActions: () => {
          return [
            CodeAction.create('my title', CodeActionKind.QuickFix),
            CodeAction.create('b'),
            Command.create('command', 'command')
          ]
        },
        resolveCodeAction: () => {
          return null
        }
      }, undefined))
      let doc = await workspace.document
      let res = await languages.getCodeActions(doc.textDocument, Range.create(0, 0, 1, 1), { only: [CodeActionKind.QuickFix], diagnostics: [] }, CancellationToken.None)
      assert.strictEqual(res.length, 1)
      let resolved = await languages.resolveCodeAction(res[0], CancellationToken.None)
      assert.notStrictEqual(resolved, undefined)
      await assert.rejects(codeActions.doCodeAction(null, 'command', true), Error)
      await codeActions.doCodeAction(null, 'cmd', true)
      let line = await shared.getCmdline()
      assert.match(line, new RegExp('No cmd code action'))
    })

    it('should use quickpick', async t => {
      shared.updateConfiguration('coc.preferences.floatActions', false)
      currActions = [CodeAction.create('foo', CodeActionKind.QuickFix), CodeAction.create('bar', CodeActionKind.QuickFix)]
      let spy = t.mock.method(window.dialogs, 'requestInputList', () => Promise.resolve(0))
      let action
      let s = t.mock.method(codeActions, 'applyCodeAction', (a, _token) => {
        action = a
        return Promise.resolve()
      })
      await codeActions.doCodeAction(null, undefined)
      assert.notStrictEqual(action, undefined)
      assert.strictEqual(action.title, 'foo')
      shared.updateConfiguration('coc.preferences.floatActions', true)
    })

    it('should show kind in code action menu (#5288)', async t => {
      shared.updateConfiguration('coc.preferences.floatActions', false)
      currActions = [
        CodeAction.create('Move to file', CodeActionKind.RefactorExtract + '.move.file'),
        CodeAction.create('Quick fix', CodeActionKind.QuickFix),
        CodeAction.create('plain')
      ]
      let items: string[] = []
      let spy = t.mock.method(window.dialogs, 'requestInputList', (_title, list) => {
        items = list as string[]
        return Promise.resolve(0)
      })
      await codeActions.doCodeAction(null, undefined)
      // menu items show the top-level kind; order is provider-defined
      assert.ok(items.includes('Move to file [refactor]'))
      assert.ok(items.includes('Quick fix [quickfix]'))
      // no kind -> unchanged
      assert.ok(items.includes('plain'))
      assert.strictEqual(items.length, 3)
      shared.updateConfiguration('coc.preferences.floatActions', true)
    })
  })

  describe('doQuickfix', () => {
    it('should show message when quickfix action does not exist', async t => {
      currActions = []
      await shared.createDocument()
      await shared.doAction('doQuickfix')
      let msg = await shared.getCmdline()
      assert.match(msg, new RegExp('No quickfix'))
    })

    it('should do preferred quickfix action', async t => {
      let doc = await shared.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', edit, CodeActionKind.QuickFix)
      action.isPreferred = true
      currActions = [CodeAction.create('foo', CodeActionKind.QuickFix), action, CodeAction.create('bar')]
      await codeActions.doQuickfix()
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['bar'])
    })
  })

  describe('applyCodeAction', () => {
    it('should resolve codeAction', async t => {
      let doc = await shared.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', CodeActionKind.QuickFix)
      action.isPreferred = true
      currActions = [action]
      resolvedAction = Object.assign({ edit }, action)
      let arr = await shared.doAction('quickfixes', 'line')
      await commands.executeCommand('editor.action.doCodeAction', arr[0])
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['bar'])
    })

    it('should not throw when resolved action is null', async t => {
      await shared.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let action = CodeAction.create('code fix', CodeActionKind.QuickFix)
      action.isPreferred = true
      currActions = [action]
      resolvedAction = null
      let arr = await shared.doAction('quickfixes', 'line')
      await commands.executeCommand('editor.action.doCodeAction', arr[0])
    })

    it('should throw for disabled action', async t => {
      let action: any = CodeAction.create('my action', CodeActionKind.Empty)
      action.disabled = { reason: 'disabled', providerId: 'x' }
      await assert.rejects(shared.doAction('doCodeAction', action), Error)
    })

    it('should invoke registered command after apply edit', async t => {
      let called
      disposables.push(commands.registerCommand('test.execute', async (s: string) => {
        called = s
        await nvim.command(s)
      }))
      let doc = await shared.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', CodeActionKind.QuickFix)
      action.isPreferred = true
      currActions = [action]
      resolvedAction = Object.assign({
        edit,
        command: Command.create('run vim command', 'test.execute', 'normal! $')
      }, action)
      let arr = await codeActions.getCurrentCodeActions('line', [CodeActionKind.QuickFix])
      await codeActions.applyCodeAction(arr[0])
      let lines = await doc.buffer.lines
      assert.deepStrictEqual(lines, ['bar'])
      assert.strictEqual(called, 'normal! $')
    })
  })

  it('should execute code action with timeout', async t => {
    disposeAll(disposables)
    let doc = await shared.createDocument('t.js')
    let called = false
    disposables.push(languages.registerCodeActionProvider([{ language: '*' }], {
      provideCodeActions: (
        _document: TextDocument,
        _range: Range,
        _context: CodeActionContext,
        _token: CancellationToken
      ) => currActions,
      resolveCodeAction: (
        _action: CodeAction,
        token: CancellationToken
      ): ProviderResult<CodeAction> => {
        return new Promise(resolve => {
          token.onCancellationRequested(() => {
            called = true
            resolve(undefined)
            clearTimeout(timer)
          })
          let timer = setTimeout(() => {
            resolve(resolvedAction)
          }, 200)
        })
      }
    }, undefined))
    let action = CodeAction.create('fix all', undefined, CodeActionKind.SourceFixAll)
    currActions = [action]
    let res = await codeActions.executeCodeActions(doc, undefined, [CodeActionKind.SourceFixAll], 50)
    assert.deepStrictEqual(res, [])
    assert.strictEqual(called, true)
  })

  it('should execute organizeImport code action', async t => {
    let doc = await workspace.document
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo')])
    let action = CodeAction.create('organize import', undefined, CodeActionKind.SourceOrganizeImports)
    currActions = [action]
    let edits: TextEdit[] = []
    edits.push(TextEdit.replace(Range.create(0, 0, 0, 3), 'bar'))
    let obj = Object.assign({}, action)
    obj.edit = { changes: { [doc.uri]: edits } }
    resolvedAction = obj
    let res = await codeActions.executeCodeActions(doc, undefined, [CodeActionKind.SourceOrganizeImports], 50)
    assert.deepStrictEqual(res, [CodeActionKind.SourceOrganizeImports])
    let line = doc.getline(0)
    assert.strictEqual(line, 'bar')
  })
})
