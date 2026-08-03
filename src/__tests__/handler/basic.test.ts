// Merged from inlineCompletion.test.ts, inlineValue.test.ts,
// selectionRange.test.ts and commands.test.ts to share a single nvim
// session and reduce per-file startup overhead.
import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, Disposable, InlineCompletionContext, InlineCompletionItem, InlineCompletionTriggerKind, InlineValueText, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import commandManager from '../../commands'
import CommandsHandler from '../../handler/commands'
import SelectionRange from '../../handler/selectionRange'
import languages, { ProviderName } from '../../languages'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
let selection: SelectionRange
let commands: CommandsHandler

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  selection = helper.plugin.getHandler().selectionRange
  commands = helper.plugin.handler.commands
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  disposeAll(disposables)
  await helper.reset()
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
  it('should provide completion items', async () => {
    let doc = await workspace.document
    let pos = await window.getCursorPosition()
    let context: InlineCompletionContext = { triggerKind: InlineCompletionTriggerKind.Automatic }
    let res = await languages.provideInlineCompletionItems(doc.textDocument, pos, context, CancellationToken.None)
    expect(res).toEqual([])
    registerProvider()
    disposables.push(languages.registerInlineCompletionItemProvider(['*'], {
      provideInlineCompletionItems: () => {
        return Promise.resolve({ items: [InlineCompletionItem.create('foo')] })
      }
    }))
    items = [InlineCompletionItem.create('bar')]
    res = await languages.provideInlineCompletionItems(doc.textDocument, pos, context, CancellationToken.None)
    expect(res.length).toBe(2)
  })

  it('should return empty when token cancelled', async () => {
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
    expect(cancelled).toBe(true)
    expect(res).toEqual([])
  })

  it('should not throw on provider error', async () => {
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
    expect(res).toEqual([])
  })
})

describe('InlineValue', () => {
  beforeEach(async () => {
    await helper.createDocument()
  })

  describe('InlineValueManager', () => {
    it('should return false when provider not exists', async () => {
      let doc = await workspace.document
      let res = languages.hasProvider(ProviderName.InlineValue, doc.textDocument)
      expect(res).toBe(false)
    })

    it('should return merged results', async () => {
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
      expect(res.length).toBe(2)
    })
  })
})

describe('selectionRange', () => {
  describe('getSelectionRanges()', () => {
    it('should throw error when selectionRange provider does not exist', async () => {
      let doc = await helper.createDocument()
      await doc.synchronize()
      await expect(helper.doAction('selectionRanges')).rejects.toThrow(Error)
    })

    it('should return ranges', async () => {
      await helper.createDocument()
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return [{
            range: Range.create(0, 0, 0, 1)
          }]
        }
      }))
      let res = await selection.getSelectionRanges()
      expect(res).toBeDefined()
      expect(Array.isArray(res)).toBe(true)
    })
  })

  describe('selectRange()', () => {
    async function getSelectedRange(): Promise<Range> {
      let m = await nvim.mode
      expect(m.mode).toBe('v')
      await nvim.input('<esc>')
      let res = await window.getSelectedRange('v')
      return res
    }

    it('should not select with empty ranges', async () => {
      let doc = await helper.createDocument()
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: () => []
      }))
      await doc.synchronize()
      let res = await selection.selectRange('', true)
      expect(res).toBe(false)
    })

    it('should select single range', async () => {
      let doc = await helper.createDocument()
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'foo\nbar\ntest\n')])
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: () => [{ range: Range.create(0, 0, 0, 3) }]
      }))
      await doc.synchronize()
      let res = await selection.selectRange('', true)
      expect(res).toBe(true)
    })

    it('should select ranges forward', async () => {
      let doc = await helper.createDocument()
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
      await helper.doAction('rangeSelect', '', false)
      await selection.selectRange('', true)
      expect(called).toBe(1)
      let res = await getSelectedRange()
      expect(res).toEqual(Range.create(0, 0, 0, 1))
      await selection.selectRange('v', true)
      expect(called).toBe(2)
      res = await getSelectedRange()
      expect(res).toEqual(Range.create(0, 0, 0, 3))
      await selection.selectRange('v', true)
      expect(called).toBe(3)
      res = await getSelectedRange()
      expect(res).toEqual(Range.create(0, 0, 1, 3))
      await selection.selectRange('v', true)
      expect(called).toBe(4)
      let m = await nvim.mode
      expect(m.mode).toBe('n')
    })

    it('should select ranges backward', async () => {
      let doc = await helper.createDocument()
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
      expect(mode).toBe('v')
      await nvim.input('<esc>')
      await window.selectRange(Range.create(0, 0, 1, 3))
      await nvim.input('<esc>')
      await selection.selectRange('v', false)
      let r = await getSelectedRange()
      expect(r).toEqual(Range.create(0, 0, 0, 3))
      await nvim.input('<esc>')
      await selection.selectRange('v', false)
      r = await getSelectedRange()
      expect(r).toEqual(Range.create(0, 0, 0, 1))
      await nvim.input('<esc>')
      await selection.selectRange('v', false)
      mode = await nvim.call('mode')
      expect(mode).toBe('n')
    })
  })

  describe('provideSelectionRanges()', () => {
    it('should return null when no provider available', async () => {
      let doc = await workspace.document
      let res = await languages.getSelectionRanges(doc.textDocument, [Position.create(0, 0)], CancellationToken.None)
      expect(res).toBeNull()
    })

    it('should return null when no result available', async () => {
      disposables.push(languages.registerSelectionRangeProvider([{ language: '*' }], {
        provideSelectionRanges: _doc => {
          return []
        }
      }))
      let doc = await workspace.document
      let res = await languages.getSelectionRanges(doc.textDocument, [Position.create(0, 0)], CancellationToken.None)
      expect(res).toBeNull()
    })

    it('should append/prepend selection ranges', async () => {
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
      expect(res.length).toBe(4)
      expect(res[0].range).toEqual(Range.create(1, 2, 1, 3))
      expect(res[3].range).toEqual(Range.create(0, 0, 3, 0))
    })
  })
})

describe('Commands', () => {
  beforeEach(async () => {
    await helper.createDocument()
  })

  describe('addVimCommand', () => {
    it('should register global vim commands', async () => {
      await commandManager.executeCommand('vim.config')
      let val = await nvim.getVar('coc_config_init')
      expect(val).toBe(1)
      let list = await helper.doAction('commandList')
      expect(list.includes('vim.config')).toBe(true)
    })

    it('should add vim command with title', async () => {
      await helper.plugin.cocAction('addCommand', { id: 'bad', cmd: '', title: '' })
      commands.addVimCommand({ id: 'list', cmd: 'CocList', title: 'list of coc.nvim' })
      let res = commandManager.titles.get('vim.list')
      expect(res).toBe('list of coc.nvim')
      commandManager.unregister('vim.list')
      commandManager.unregister('unknown.command')
      let list = commands.getCommandList()
      expect(list.includes('bad')).toBe(false)
    })
  })

  describe('commandManager', () => {
    it('should replace builtin command', async () => {
      let fn = vi.fn()
      commandManager.registerCommand('editor.action.restart', () => {
        fn()
      })
      await commandManager.executeCommand('editor.action.restart')
      expect(fn).toHaveBeenCalled()
    })

    it('should throw when command not found', () => {
      expect(() => commandManager.executeCommand('')).toThrow(Error)
    })

    it('should add to recent', async () => {
      await commandManager.addRecent('document.checkBuffer', true)
      let mru = workspace.createMru('commands')
      let list = await mru.load()
      expect(list[0]).toBe('document.checkBuffer')
    })
  })

  describe('getCommands', () => {
    it('should get command items', async () => {
      let res = await helper.doAction('commands')
      let idx = res.findIndex(o => o.id == 'workspace.showOutput')
      expect(idx != -1).toBe(true)
    })
  })

  describe('repeat', () => {
    it('should repeat command', async () => {
      await nvim.call('setline', [1, ['a', 'b', 'c']])
      await nvim.call('cursor', [1, 1])
      commands.addVimCommand({ id: 'remove', cmd: 'normal! dd' })
      await helper.doAction('runCommand', 'vim.remove')
      await helper.waitFor('getline', ['.'], 'b')
      await helper.doAction('repeatCommand')
      await helper.waitFor('getline', ['.'], 'c')
    })
  })

  describe('runCommand', () => {
    it('should open command list without id', async () => {
      await commands.runCommand()
      await helper.waitFor('bufname', ['%'], 'list:///commands')
    })
  })
})
