import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CodeAction, CodeActionContext, CodeActionKind, Command, Disposable, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
import commands from '../../commands'
import ActionsHandler, { shouldAutoApply } from '../../handler/codeActions'
import languages, { ProviderName } from '../../languages'
import { ProviderResult } from '../../provider'
import { checkAction } from '../../provider/codeActionManager'
import { disposeAll } from '../../util'
import { rangeInRange } from '../../util/position'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
let codeActions: ActionsHandler
let currActions: (CodeAction | Command)[]
let resolvedAction: CodeAction
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  codeActions = helper.plugin.getHandler().codeActions
})

afterAll(async () => {
  await helper.shutdown()
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
  await helper.reset()
})

describe('handler codeActions', () => {
  describe('autoApply', () => {
    it('should check auto apply', async () => {
      expect(shouldAutoApply(undefined)).toBe(false)
      expect(shouldAutoApply([])).toBe(false)
      expect(shouldAutoApply([CodeActionKind.Refactor])).toBe(false)
    })
  })

  describe('organizeImport', () => {
    it('should filter command ', () => {
      let cmd = Command.create('title', 'command')
      let res = checkAction([CodeActionKind.Refactor], cmd)
      expect(res).toBe(false)
      res = checkAction(undefined, cmd)
      expect(res).toBe(true)
    })

    it('should return false when organize import action not found', async () => {
      currActions = []
      let doc = await helper.createDocument()
      expect(languages.hasProvider(ProviderName.CodeAction, doc)).toBe(true)
      let res = await helper.doAction('organizeImport')
      expect(res).toBe(false)
      expect(languages.hasProvider('undefined' as any, doc)).toBe(false)
    })

    it('should perform organize import action', async () => {
      let doc = await helper.createDocument()
      await doc.buffer.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false })
      let edits: TextEdit[] = []
      edits.push(TextEdit.replace(Range.create(0, 0, 0, 3), 'bar'))
      edits.push(TextEdit.replace(Range.create(1, 0, 1, 3), 'foo'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('organize import', edit, CodeActionKind.SourceOrganizeImports)
      currActions = [action, CodeAction.create('another action'), Command.create('title', 'command')]
      await codeActions.organizeImport()
      let lines = await doc.buffer.lines
      expect(lines).toEqual(['bar', 'foo'])
    })

    it('should register editor.action.organizeImport command', async () => {
      let doc = await helper.createDocument()
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
      expect(lines).toEqual(['bar', 'foo'])
    })
  })

  describe('codeActionRange', () => {
    it('should show warning when no action available', async () => {
      await helper.createDocument()
      currActions = []
      await helper.doAction('codeActionRange', 1, 2, CodeActionKind.QuickFix)
      let line = await helper.getCmdline()
      expect(line).toMatch(/No quickfix code action/)
      await helper.doAction('codeActionRange', 1, 2)
      line = await helper.getCmdline()
      expect(line).toMatch(/No code action available/)
    })

    it('should apply chosen action', async () => {
      let doc = await helper.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', edit, CodeActionKind.QuickFix)
      currActions = [action]
      let p = codeActions.codeActionRange(1, 2, CodeActionKind.QuickFix)
      await helper.waitPrompt()
      await nvim.input('<CR>')
      await p
      let buf = nvim.createBuffer(doc.bufnr)
      let lines = await buf.lines
      expect(lines[0]).toBe('bar')
    })
  })

  describe('getCodeActions', () => {
    it('should get empty actions', async () => {
      currActions = []
      let doc = await helper.createDocument()
      let res = await codeActions.getCodeActions(doc)
      expect(res.length).toBe(0)
    })

    it('should not filter disabled actions', async () => {
      currActions = []
      let action = CodeAction.create('foo', CodeActionKind.Source)
      currActions.push(action)
      action = CodeAction.create('action', CodeActionKind.Empty)
      currActions.push(action)
      action = CodeAction.create('bar', CodeActionKind.QuickFix)
      action.disabled = { reason: 'disabled' }
      currActions.push(action)
      let doc = await helper.createDocument()
      let res = await codeActions.getCodeActions(doc, Range.create(0, 0, 1, 0))
      expect(res.length).toBe(2)
    })

    it('should get all actions', async () => {
      let doc = await helper.createDocument()
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
      expect(range).toEqual(Range.create(0, 0, 3, 0))
      expect(res.length).toBe(5)
    })

    it('should filter actions by range', async () => {
      let doc = await helper.createDocument()
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
      expect(range).toEqual(Range.create(0, 0, 0, 0))
      expect(res.length).toBe(1)
    })

    it('should filter actions by kind prefix', async () => {
      let doc = await helper.createDocument()
      let action = CodeAction.create('my action', CodeActionKind.SourceFixAll)
      currActions = [action]
      let res = await codeActions.getCodeActions(doc, undefined, [CodeActionKind.Source])
      expect(res.length).toBe(1)
      expect(res[0].kind).toBe(CodeActionKind.SourceFixAll)
      await helper.doAction('fixAll')
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

    it('should get codeActions by line', async () => {
      currActions = []
      await helper.createDocument()
      let res = await helper.doAction('codeActions', 'line')
      expect(range).toEqual(Range.create(0, 0, 1, 0))
      expect(res.length).toBe(3)
    })

    it('should get codeActions by cursor', async () => {
      currActions = []
      await helper.createDocument()
      let res = await codeActions.getCurrentCodeActions('cursor')
      expect(range).toEqual(Range.create(0, 0, 0, 0))
      expect(res.length).toBe(3)
    })

    it('should get codeActions by visual mode', async () => {
      currActions = []
      await helper.createDocument()
      await nvim.setLine('foo')
      await nvim.command('normal! 0v$')
      await nvim.input('<esc>')
      let res = await codeActions.getCurrentCodeActions('v')
      expect(range).toEqual(Range.create(0, 0, 0, 3))
      expect(res.length).toBe(3)
    })
  })

  describe('doCodeAction', () => {
    it('should not throw when no action exists', async () => {
      currActions = []
      await helper.createDocument()
      await helper.doAction('codeAction', undefined)
    })

    it('should apply single code action when only is title', async () => {
      let doc = await helper.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', edit, CodeActionKind.QuickFix)
      currActions = [action]
      await codeActions.doCodeAction(undefined, 'code fix')
      let lines = await doc.buffer.lines
      expect(lines).toEqual(['bar'])
    })

    it('should apply single code action when only is QuickFix', async () => {
      let doc = await helper.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', edit, CodeActionKind.QuickFix)
      currActions = [action]
      await codeActions.doCodeAction(undefined, [CodeActionKind.QuickFix])
      let lines = await doc.buffer.lines
      expect(lines).toEqual(['bar'])
    })

    it('should show disabled code action', async () => {
      let doc = await helper.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let refactorAction = CodeAction.create('code refactor', edit, CodeActionKind.Refactor)
      refactorAction.disabled = { reason: 'invalid position' }
      let fixAction = CodeAction.create('code fix', edit, CodeActionKind.QuickFix)
      currActions = [refactorAction, fixAction]
      let p = codeActions.doCodeAction(undefined, undefined, true)
      let winid = await helper.waitFloat()
      let win = nvim.createWindow(winid)
      let buf = await win.buffer
      let lines = await buf.lines
      expect(lines.length).toBe(2)
      expect(lines[1]).toMatch(/code refactor/)
      await nvim.input('2')
      await helper.wait(1)
      await nvim.input('j')
      await nvim.input('<cr>')
      await helper.waitValue(async () => {
        let cmdline = await helper.getCmdline()
        return cmdline.includes('invalid position')
      }, true)
      await nvim.input('<esc>')
      await p
    })

    it('should action dialog to choose action', async () => {
      let doc = await helper.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', edit, CodeActionKind.QuickFix)
      currActions = [action, CodeAction.create('foo')]
      let promise = codeActions.doCodeAction(null)
      await helper.waitFloat()
      let ids = await nvim.call('coc#float#get_float_win_list') as number[]
      expect(ids.length).toBeGreaterThan(0)
      await nvim.input('<CR>')
      await promise
      let lines = await doc.buffer.lines
      expect(lines).toEqual(['bar'])
    })

    it('should choose code actions by range', async () => {
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
      await helper.createDocument()
      await nvim.setLine('abc')
      await nvim.command('normal! 0v$')
      await nvim.input('<esc>')
      await codeActions.doCodeAction('v', 'my title')
      expect(range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 3 } })
    })

    it('should filter by provider kinds', async () => {
      currActions = []
      disposables.push(languages.registerCodeActionProvider([{ language: '*' }], {
        provideCodeActions: () => {
          return [CodeAction.create('my title'), CodeAction.create('b'), CodeAction.create('c')]
        },
      }, undefined, [CodeActionKind.QuickFix]))
      let doc = await workspace.document
      let res = await languages.getCodeActions(doc.textDocument, Range.create(0, 0, 1, 1), { only: [CodeActionKind.Refactor], diagnostics: [] }, CancellationToken.None)
      expect(res).toEqual([])
    })

    it('should filter by codeAction kind', async () => {
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
      expect(res.length).toBe(1)
      let resolved = await languages.resolveCodeAction(res[0], CancellationToken.None)
      expect(resolved).toBeDefined()
      await expect(async () => {
        await codeActions.doCodeAction(null, 'command', true)
      }).rejects.toThrow(Error)
      await codeActions.doCodeAction(null, 'cmd', true)
      let line = await helper.getCmdline()
      expect(line).toMatch('No cmd code action')
    })

    it('should use quickpick', async () => {
      helper.updateConfiguration('coc.preferences.floatActions', false)
      currActions = [CodeAction.create('foo', CodeActionKind.QuickFix), CodeAction.create('bar', CodeActionKind.QuickFix)]
      let spy = jest.spyOn(window, 'showQuickpick').mockImplementation(() => {
        return Promise.resolve(-1)
      })
      await codeActions.doCodeAction(null)
      spy.mockRestore()
      helper.updateConfiguration('coc.preferences.floatActions', true)
    })
  })

  describe('doQuickfix', () => {
    it('should show message when quickfix action does not exist', async () => {
      currActions = []
      await helper.createDocument()
      await helper.doAction('doQuickfix')
      let msg = await helper.getCmdline()
      expect(msg).toMatch('No quickfix')
    })

    it('should do preferred quickfix action', async () => {
      let doc = await helper.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', edit, CodeActionKind.QuickFix)
      action.isPreferred = true
      currActions = [CodeAction.create('foo', CodeActionKind.QuickFix), action, CodeAction.create('bar')]
      await codeActions.doQuickfix()
      let lines = await doc.buffer.lines
      expect(lines).toEqual(['bar'])
    })
  })

  describe('applyCodeAction', () => {
    it('should resolve codeAction', async () => {
      let doc = await helper.createDocument()
      let edits: TextEdit[] = []
      edits.push(TextEdit.insert(Position.create(0, 0), 'bar'))
      let edit = { changes: { [doc.uri]: edits } }
      let action = CodeAction.create('code fix', CodeActionKind.QuickFix)
      action.isPreferred = true
      currActions = [action]
      resolvedAction = Object.assign({ edit }, action)
      let arr = await helper.doAction('quickfixes', 'line')
      await commands.executeCommand('editor.action.doCodeAction', arr[0])
      let lines = await doc.buffer.lines
      expect(lines).toEqual(['bar'])
    })

    it('should throw for disabled action', async () => {
      let action: any = CodeAction.create('my action', CodeActionKind.Empty)
      action.disabled = { reason: 'disabled', providerId: 'x' }
      await expect(async () => {
        await helper.doAction('doCodeAction', action)
      }).rejects.toThrow(Error)
    })

    it('should invoke registered command after apply edit', async () => {
      let called
      disposables.push(commands.registerCommand('test.execute', async (s: string) => {
        called = s
        await nvim.command(s)
      }))
      let doc = await helper.createDocument()
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
      expect(lines).toEqual(['bar'])
      expect(called).toBe('normal! $')
    })
  })
})
