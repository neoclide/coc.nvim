import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
// Merged from inlineCompletion.test.ts, inlineValue.test.ts,
// selectionRange.test.ts and commands.test.ts to share a single nvim
// session and reduce per-file startup overhead.
import commandManager from '../../commands'
import CommandsHandler from '../../handler/commands'
import SelectionRange from '../../handler/selectionRange'
import languages, { ProviderName } from '../../languages'
import listManager from '../../list/manager'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, Disposable, InlineCompletionContext, InlineCompletionItem, InlineCompletionTriggerKind, InlineValueText, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import type CommandsHandlerType from '../../handler/commands'
import type SelectionRangeType from '../../handler/selectionRange'


let nvim: Neovim
let disposables: Disposable[] = []
let selection: SelectionRangeType
let commands: CommandsHandlerType

before(async () => {
  nvim = workspace.nvim
  selection = getCurrentPlugin().getHandler().selectionRange
  commands = getCurrentPlugin().handler.commands
})

afterEach(async () => {
  disposeAll(disposables)
})

let items: InlineCompletionItem[] = []

function registerProvider(): void {
  disposables.push(languages.registerInlineCompletionItemProvider(['*'], {
    provideInlineCompletionItems: () => {
      return Promise.resolve(items)
    }
  }))
}

describe('InlineCompletion', () => {
  it('should provide completion items', async t => {
    let doc = await workspace.document
    let pos = await window.getCursorPosition()
    let context: InlineCompletionContext = { triggerKind: InlineCompletionTriggerKind.Automatic }
    let res = await languages.provideInlineCompletionItems(doc.textDocument, pos, context, CancellationToken.None)
    assert.deepStrictEqual(res, [])
    registerProvider()
    disposables.push(languages.registerInlineCompletionItemProvider(['*'], {
      provideInlineCompletionItems: () => {
        return Promise.resolve({ items: [InlineCompletionItem.create('foo')] })
      }
    }))
    items = [InlineCompletionItem.create('bar')]
    res = await languages.provideInlineCompletionItems(doc.textDocument, pos, context, CancellationToken.None)
    assert.strictEqual(res.length, 2)
  })

  it('should return empty when token cancelled', async t => {
    let doc = await workspace.document
    let pos = await window.getCursorPosition()
    let context: InlineCompletionContext = { triggerKind: InlineCompletionTriggerKind.Automatic }
    let cancelled = false
    disposables.push(languages.registerInlineCompletionItemProvider(['*'], {
      provideInlineCompletionItems: (_doc, _pos, _context, token) => {
        return new Promise(resolve => {
          let timer = setTimeout(() => resolve([]), 500)
          token.onCancellationRequested(() => {
            cancelled = true
            clearTimeout(timer)
            resolve(undefined)
          })
        })
      }
    }))
    let tokenSource = new CancellationTokenSource()
    let p = languages.provideInlineCompletionItems(doc.textDocument, pos, context, tokenSource.token)
    tokenSource.cancel()
    let res = await p
    assert.strictEqual(cancelled, true)
    assert.deepStrictEqual(res, [])
  })

  it('should not throw on provider error', async t => {
    let doc = await workspace.document
    let pos = await window.getCursorPosition()
    let context: InlineCompletionContext = { triggerKind: InlineCompletionTriggerKind.Automatic }
    disposables.push(languages.registerInlineCompletionItemProvider(['*'], {
      provideInlineCompletionItems: () => {
        return Promise.reject(new Error('my error'))
      }
    }))
    let tokenSource = new CancellationTokenSource()
    let res = await languages.provideInlineCompletionItems(doc.textDocument, pos, context, tokenSource.token)
    assert.deepStrictEqual(res, [])
  })
})

describe('InlineValue', () => {
  beforeEach(async () => {
    await shared.createDocument()
  })

  describe('InlineValueManager', () => {
    it('should return false when provider not exists', async t => {
      let doc = await workspace.document
      let res = languages.hasProvider(ProviderName.InlineValue, doc.textDocument)
      assert.strictEqual(res, false)
    })

    it('should return merged results', async t => {
      disposables.push(languages.registerInlineValuesProvider([{ language: '*' }], {
        provideInlineValues: () => {
          return null
        }
      }))
      disposables.push(languages.registerInlineValuesProvider([{ language: '*' }], {
        provideInlineValues: () => {
          return [
            InlineValueText.create(Range.create(0, 0, 0, 1), 'foo'),
            InlineValueText.create(Range.create(0, 3, 0, 5), 'bar'),
          ]
        }
      }))
      disposables.push(languages.registerInlineValuesProvider([{ language: '*' }], {
        provideInlineValues: () => {
          return [
            InlineValueText.create(Range.create(0, 0, 0, 1), 'foo'),
          ]
        }
      }))
      let doc = await workspace.document
      let res = await languages.provideInlineValues(doc.textDocument, Range.create(0, 0, 3, 0), { frameId: 3, stoppedLocation: Range.create(0, 0, 0, 3) }, CancellationToken.None)
      assert.strictEqual(res.length, 2)
    })
  })
})

describe('selectionRange', () => {
  describe('getSelectionRanges()', () => {
    it('should throw error when selectionRange provider does not exist', async t => {
      let doc = await shared.createDocument()
      await doc.synchronize()
      await assert.rejects(shared.doAction('selectionRanges'), Error)
    })

    it('should return ranges', async t => {
      await shared.createDocument()
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return [{
            range: Range.create(0, 0, 0, 1)
          }]
        }
      }))
      let res = await selection.getSelectionRanges()
      assert.notStrictEqual(res, undefined)
      assert.strictEqual(Array.isArray(res), true)
    })
  })

  describe('selectRange()', () => {
    async function getSelectedRange(): Promise<Range> {
      let m = await nvim.mode
      assert.strictEqual(m.mode, 'v')
      await nvim.input('<esc>')
      let res = await window.getSelectedRange('v')
      return res
    }

    it('should not select with empty ranges', async t => {
      let doc = await shared.createDocument()
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: () => []
      }))
      await doc.synchronize()
      let res = await selection.selectRange('', true)
      assert.strictEqual(res, false)
    })

    it('should select single range', async t => {
      let doc = await shared.createDocument()
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar\ntest\n')])
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: () => [{ range: Range.create(0, 0, 0, 3) }]
      }))
      await doc.synchronize()
      let res = await selection.selectRange('', true)
      assert.strictEqual(res, true)
    })

    it('should select ranges forward', async t => {
      let doc = await shared.createDocument()
      let called = 0
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar\ntest\n')])
      await nvim.call('cursor', [1, 1])
      await doc.synchronize()
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          called += 1
          let arr = [{
            range: Range.create(0, 0, 0, 1)
          }, {
            range: Range.create(0, 0, 0, 3)
          }, {
            range: Range.create(0, 0, 1, 3)
          }]
          return arr
        }
      }))
      await doc.synchronize()
      await shared.doAction('rangeSelect', '', false)
      await selection.selectRange('', true)
      assert.strictEqual(called, 1)
      let res = await getSelectedRange()
      assert.deepStrictEqual(res, Range.create(0, 0, 0, 1))
      await selection.selectRange('v', true)
      assert.strictEqual(called, 2)
      res = await getSelectedRange()
      assert.deepStrictEqual(res, Range.create(0, 0, 0, 3))
      await selection.selectRange('v', true)
      assert.strictEqual(called, 3)
      res = await getSelectedRange()
      assert.deepStrictEqual(res, Range.create(0, 0, 1, 3))
      await selection.selectRange('v', true)
      assert.strictEqual(called, 4)
      let m = await nvim.mode
      assert.strictEqual(m.mode, 'n')
    })

    it('should select ranges backward', async t => {
      let doc = await shared.createDocument()
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar\ntest\n')])
      await nvim.call('cursor', [1, 1])
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          let arr = [{
            range: Range.create(0, 0, 0, 1)
          }, {
            range: Range.create(0, 0, 0, 3)
          }, {
            range: Range.create(0, 0, 1, 3)
          }]
          return arr
        }
      }))
      await doc.synchronize()
      await selection.selectRange('', true)
      let mode = await nvim.call('mode')
      assert.strictEqual(mode, 'v')
      await nvim.input('<esc>')
      await window.selectRange(Range.create(0, 0, 1, 3))
      await nvim.input('<esc>')
      await selection.selectRange('v', false)
      let r = await getSelectedRange()
      assert.deepStrictEqual(r, Range.create(0, 0, 0, 3))
      await nvim.input('<esc>')
      await selection.selectRange('v', false)
      r = await getSelectedRange()
      assert.deepStrictEqual(r, Range.create(0, 0, 0, 1))
      await nvim.input('<esc>')
      await selection.selectRange('v', false)
      mode = await nvim.call('mode')
      assert.strictEqual(mode, 'n')
    })
  })

  describe('provideSelectionRanges()', () => {
    it('should return null when no provider available', async t => {
      let doc = await workspace.document
      let res = await languages.getSelectionRanges(doc.textDocument, [Position.create(0, 0)], CancellationToken.None)
      assert.strictEqual(res, null)
    })

    it('should return null when no result available', async t => {
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return []
        }
      }))
      let doc = await workspace.document
      let res = await languages.getSelectionRanges(doc.textDocument, [Position.create(0, 0)], CancellationToken.None)
      assert.strictEqual(res, null)
    })

    it('should append/prepend selection ranges', async t => {
      let doc = await workspace.document
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return [{ range: Range.create(1, 1, 1, 4) }, { range: Range.create(1, 0, 1, 6) }]
        }
      }))
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return [{ range: Range.create(1, 2, 1, 3) }]
        }
      }))
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return [{ range: Range.create(1, 2, 1, 3) }]
        }
      }))
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return [{ range: Range.create(0, 0, 3, 0) }]
        }
      }))

      let res = await languages.getSelectionRanges(doc.textDocument, [Position.create(0, 0)], CancellationToken.None)
      assert.strictEqual(res.length, 4)
      assert.deepStrictEqual(res[0].range, Range.create(1, 2, 1, 3))
      assert.deepStrictEqual(res[3].range, Range.create(0, 0, 3, 0))
    })
  })
})

describe('Commands', () => {
  beforeEach(async () => {
    await shared.createDocument()
  })

  describe('addVimCommand', () => {
    it('should register global vim commands', async t => {
      await commandManager.executeCommand('vim.config')
      let val = await nvim.getVar('coc_config_init')
      assert.strictEqual(val, 1)
      let list = await shared.doAction('commandList')
      assert.strictEqual(list.includes('vim.config'), true)
    })

    it('should add vim command with title', async t => {
      await getCurrentPlugin().cocAction('addCommand', { id: 'bad', cmd: '', title: '' })
      commands.addVimCommand({ id: 'list', cmd: 'CocList', title: 'list of coc.nvim' })
      let res = commandManager.titles.get('vim.list')
      assert.strictEqual(res, 'list of coc.nvim')
      commandManager.unregister('vim.list')
      commandManager.unregister('unknown.command')
      let list = commands.getCommandList()
      assert.strictEqual(list.includes('bad'), false)
    })
  })

  describe('commandManager', () => {
    it('should replace builtin command', async t => {
      let fn = t.mock.fn()
      commandManager.registerCommand('editor.action.restart', () => {
        fn()
      })
      await commandManager.executeCommand('editor.action.restart')
      assert.ok(fn.mock.callCount() > 0)
    })

    it('should throw when command not found', t => {
      assert.throws(() => commandManager.executeCommand(''), Error)
    })

    it('should add to recent', async t => {
      await commandManager.addRecent('document.checkBuffer', true)
      let mru = workspace.createMru('commands')
      let list = await mru.load()
      assert.strictEqual(list[0], 'document.checkBuffer')
    })
  })

  describe('getCommands', () => {
    it('should get command items', async t => {
      let res = await shared.doAction('commands')
      let idx = res.findIndex(o => o.id == 'workspace.showOutput')
      assert.strictEqual(idx != -1, true)
    })
  })

  describe('repeat', () => {
    it('should repeat command', async t => {
      await nvim.call('setline', [1, ['a', 'b', 'c']])
      await nvim.call('cursor', [1, 1])
      commands.addVimCommand({ id: 'remove', cmd: 'normal! dd' })
      await shared.doAction('runCommand', 'vim.remove')
      await shared.waitFor('getline', ['.'], 'b')
      await shared.doAction('repeatCommand')
      await shared.waitFor('getline', ['.'], 'c')
    })
  })

  describe('runCommand', () => {
    it('should open command list without id', async t => {
      let start = t.mock.method(listManager, 'start', async () => {})
      await commands.runCommand()
      assert.deepStrictEqual(start.mock.calls[0].arguments, [['commands']])
    })
  })
})
