import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import commands from '../../commands'
import events from '../../events'
import CodeLensBuffer, { getCommandText, getCommands, getTextAlign } from '../../handler/codelens/buffer'
import CodeLensHandler from '../../handler/codelens/index'
import languages from '../../languages'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CodeLens, Command, Disposable, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import { afterEach, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'


let nvim: Neovim
let codeLens: CodeLensHandler
let disposables: Disposable[] = []
let srcId: number

before(async () => {
  nvim = workspace.nvim
  srcId = await nvim.createNamespace('coc-codelens')
  codeLens = getCurrentPlugin().getHandler().codeLens
})

beforeEach(() => {
  shared.updateConfiguration('codeLens.enable', true)
})

afterEach(async () => {
  disposeAll(disposables)
})

async function createBufferWithCodeLens(): Promise<CodeLensBuffer> {
  disposables.push(languages.registerCodeLensProvider([{ language: 'javascript' }], {
    provideCodeLenses: () => {
      return [{
        range: Range.create(0, 0, 0, 1)
      }]
    },
    resolveCodeLens: codeLens => {
      codeLens.command = Command.create('save', '__save', 1, 2, 3)
      return codeLens
    }
  }))
  let doc = await shared.createDocument('e.js')
  await nvim.call('setline', [1, ['a', 'b', 'c']])
  await doc.synchronize()
  await codeLens.checkProvider()
  return codeLens.buffers.getItem(doc.bufnr)
}

afterEach(editorReset)

describe('codeLenes feature', () => {
  it('should get text align', async t => {
    assert.strictEqual(getTextAlign(undefined), 'above')
    assert.strictEqual(getTextAlign('top'), 'above')
    assert.strictEqual(getTextAlign('eol'), 'after')
    assert.strictEqual(getTextAlign('right_align'), 'right')
  })

  it('should not throw when srcId not exists', async t => {
    let doc = await workspace.document
    let item = codeLens.buffers.getItem(doc.bufnr)
    item.clear()
    await item.doAction(0)
  })

  it('should invoke codeLenes action', async t => {
    let fn = t.mock.fn()
    disposables.push(commands.registerCommand('__save', (...args) => {
      fn(...args)
    }))
    await createBufferWithCodeLens()
    await shared.doAction('codeLensAction')
    await nvim.call('cursor', [1, 1])
    assert.deepStrictEqual(fn.mock.calls[0].arguments, [1, 2, 3])
    await nvim.command('normal! G')
    await shared.doAction('codeLensAction')
  })

  it('should toggle codeLens display', async t => {
    await codeLens.toggle(999)
    let line = await shared.getCmdline()
    assert.match(line, new RegExp('not exists'))
    await createBufferWithCodeLens()
    await commands.executeCommand('document.toggleCodeLens')
    let doc = await workspace.document
    let res = await doc.buffer.getExtMarks(srcId, 0, -1, { details: true })
    assert.strictEqual(res.length, 0)
    await commands.executeCommand('document.toggleCodeLens')
    await shared.waitValue(async () => {
      let res = await doc.buffer.getExtMarks(srcId, 0, -1, { details: true })
      return res.length > 0
    }, true)
  })

  it('should return codeLenes when resolve not exists', async t => {
    let codeLens = CodeLens.create(Range.create(0, 0, 1, 1))
    let resolved = await languages.resolveCodeLens(codeLens, CancellationToken.None)
    assert.notStrictEqual(resolved, undefined)
  })

  it('should do codeLenes request and resolve codeLenes', async t => {
    let buf = await createBufferWithCodeLens()
    let doc = await workspace.document
    await shared.waitValue(async () => {
      let codelens = buf.currentCodeLens
      return Array.isArray(codelens) && codelens[0].command != null
    }, true)
    let markers = await doc.buffer.getExtMarks(srcId, 0, -1)
    assert.strictEqual(markers.length, 1)
    let codeLenes = buf.currentCodeLens
    await languages.resolveCodeLens(codeLenes[0], CancellationToken.None)
  })

  it('should refresh on empty changes', async t => {
    await createBufferWithCodeLens()
    let doc = await workspace.document
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    await doc.synchronize()
    let markers = await doc.buffer.getExtMarks(srcId, 0, -1)
    assert.ok(markers.length > 0)
  })

  it('should work with empty codeLens', async t => {
    disposables.push(languages.registerCodeLensProvider([{ language: 'javascript' }], {
      provideCodeLenses: () => {
        return []
      }
    }))
    let doc = await shared.createDocument('t.js')
    let buf = codeLens.buffers.getItem(doc.bufnr)
    let codelens = buf.currentCodeLens
    assert.strictEqual(codelens, undefined)
  })

  it('should change codeLenes position', async t => {
    shared.updateConfiguration('codeLens.position', 'eol')
    let bufnr = await nvim.call('bufnr', ['%']) as number
    let item = codeLens.buffers.getItem(bufnr)
    assert.strictEqual(item.config.position, 'eol')
  })

  it('should refresh codeLens on CursorHold', async t => {
    disposables.push(languages.registerCodeLensProvider([{ language: 'javascript' }], {
      provideCodeLenses: document => {
        let n = document.lineCount
        let arr: any[] = []
        for (let i = 0; i <= n - 2; i++) {
          arr.push({
            range: Range.create(i, 0, i, 1),
            command: Command.create('save', '__save', i)
          })
        }
        return arr
      }
    }))
    let doc = await shared.createDocument('example.js')
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    await doc.synchronize()
    await events.fire('CursorHold', [doc.bufnr])
    await shared.waitValue(async () => {
      let markers = await doc.buffer.getExtMarks(srcId, 0, -1)
      return markers.length
    }, 3)
    shared.updateConfiguration('codeLens.enable', false)
    await events.fire('CursorHold', [doc.bufnr])
  })

  it('should cancel codeLenes request on document change', async t => {
    let cancelled = false
    let started = false
    disposables.push(languages.registerCodeLensProvider([{ language: 'javascript' }], {
      provideCodeLenses: (_, token) => {
        started = true
        return new Promise(resolve => {
          token.onCancellationRequested(() => {
            cancelled = true
            clearTimeout(timer)
            resolve(null)
          })
          let timer = setTimeout(() => {
            resolve([{
              range: Range.create(0, 0, 0, 1)
            }, {
              range: Range.create(1, 0, 1, 1)
            }])
          }, 2000)
          disposables.push({
            dispose: () => {
              clearTimeout(timer)
            }
          })
        })
      },
      resolveCodeLens: codeLens => {
        codeLens.command = Command.create('save', '__save')
        return codeLens
      }
    }))
    let doc = await shared.createDocument('codelens.js')
    await shared.waitValue(() => started, true)
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'a\nb\nc')])
    assert.strictEqual(cancelled, true)
  })

  it('should resolve on CursorMoved', { timeout: 10000 }, async t => {
    disposables.push(languages.registerCodeLensProvider([{ language: 'javascript' }], {
      provideCodeLenses: () => {
        return [{
          range: Range.create(190, 0, 190, 1)
        }, {
          range: Range.create(191, 0, 191, 1)
        }]
      },
      resolveCodeLens: async codeLens => {
        codeLens.command = Command.create('save', '__save')
        return codeLens
      }
    }))
    let doc = await shared.createDocument('example.js')
    await nvim.call('cursor', [1, 1])
    let arr = new Array(200)
    arr.fill('')
    await nvim.call('setline', [1, arr])
    await doc.synchronize()
    await codeLens.checkProvider()
    await nvim.call('cursor', [190, 1])
    await events.fire('CursorMoved', [doc.bufnr, [190, 1], false])
    let bufnr = doc.bufnr
    await shared.waitValue(() => {
      let buf = codeLens.buffers.getItem(bufnr)
      return buf && buf.currentCodeLens && buf.currentCodeLens[0].command != null
    }, true)
  })

  it('should use picker for multiple codeLenses', async t => {
    let fn = t.mock.fn()
    let resolved = false
    disposables.push(commands.registerCommand('__save', (...args) => {
      fn(...args)
    }))
    disposables.push(commands.registerCommand('__delete', (...args) => {
      fn(...args)
    }))
    disposables.push(languages.registerCodeLensProvider([{ language: 'javascript' }], {
      provideCodeLenses: () => {
        resolved = true
        return [{
          range: Range.create(0, 0, 0, 1),
          command: Command.create('save', '__save', 1, 2, 3)
        }, {
          range: Range.create(0, 1, 0, 2),
          command: Command.create('save', '__delete', 4, 5, 6)
        }]
      }
    }))
    let doc = await shared.createDocument('example.js')
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    await doc.synchronize()
    await codeLens.checkProvider()
    await shared.waitValue(() => {
      return resolved
    }, true)
    let p = shared.doAction('codeLensAction')
    await shared.waitPrompt()
    await nvim.input('<cr>')
    await p
    assert.deepStrictEqual(fn.mock.calls[0].arguments, [1, 2, 3])
  })

  it('should show tooltip in codeLens picker', async t => {
    let fn = t.mock.fn()
    disposables.push(commands.registerCommand('__save', () => {
      fn()
    }))
    disposables.push(commands.registerCommand('__delete', () => {
      fn()
    }))
    disposables.push(languages.registerCodeLensProvider([{ language: 'javascript' }], {
      provideCodeLenses: () => {
        return [{
          range: Range.create(0, 0, 0, 1),
          command: { title: 'save', command: '__save', tooltip: 'save the file' }
        }, {
          range: Range.create(0, 1, 0, 2),
          command: { title: 'delete', command: '__delete', tooltip: 'delete the file' }
        }]
      }
    }))
    let doc = await shared.createDocument('example.js')
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    await doc.synchronize()
    await codeLens.checkProvider()
    await shared.waitValue(async () => {
      let buf = codeLens.buffers.getItem(doc.bufnr)
      let lenses = buf.currentCodeLens
      return Array.isArray(lenses) && lenses.length >= 2
    }, true)
    let p = shared.doAction('codeLensAction')
    await shared.waitPrompt()
    let win = await shared.getFloat()
    assert.notStrictEqual(win, undefined)
    let lines = await shared.getWinLines(win.id)
    assert.match(lines.join('\n'), /save the file/)
    assert.match(lines.join('\n'), /delete the file/)
    await nvim.input('<cr>')
    await p
  })

  it('should refresh for failed codeLens request', async t => {
    let called = 0
    let fn = t.mock.fn()
    disposables.push(commands.registerCommand('__save', (...args) => {
      fn(...args)
    }))
    disposables.push(commands.registerCommand('__foo', (...args) => {
      fn(...args)
    }))
    disposables.push(languages.registerCodeLensProvider([{ language: '*' }], {
      provideCodeLenses: () => {
        called++
        if (called == 1) {
          return null
        }
        return [{
          range: Range.create(0, 0, 0, 1),
          command: Command.create('foo', '__foo')
        }]
      }
    }))
    disposables.push(languages.registerCodeLensProvider([{ language: '*' }], {
      provideCodeLenses: () => {
        return [{
          range: Range.create(0, 0, 0, 1),
          command: Command.create('save', '__save')
        }]
      }
    }))
    let doc = await shared.createDocument('example.js')
    // Wait for the initial debounced fetch, not only BufferSync creation.
    // Otherwise checkProvider() can become the first fetch and the test never
    // exercises recovery from the provider's initial null result.
    await shared.waitValue(() => {
      let item = codeLens.buffers.getItem(doc.buffer.id)
      return called === 1 && item?.currentCodeLens?.length === 1
    }, true)
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    await codeLens.checkProvider()
    let markers = await doc.buffer.getExtMarks(srcId, 0, -1)
    assert.ok(markers.length > 0)
    let codeLensBuffer = codeLens.buffers.getItem(doc.buffer.id)
    await codeLensBuffer.forceFetch()
    await shared.waitValue(() => codeLensBuffer.currentCodeLens.length > 1, true)
    let curr = codeLensBuffer.currentCodeLens
    assert.ok(curr.length > 1)
  })

  it('should use custom separator & position', async t => {
    shared.updateConfiguration('codeLens.separator', '|')
    shared.updateConfiguration('codeLens.position', 'eol')
    let doc = await shared.createDocument('example.js')
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    await doc.synchronize()
    disposables.push(languages.registerCodeLensProvider([{ language: '*' }], {
      provideCodeLenses: () => {
        return [{
          range: Range.create(0, 0, 1, 0),
          command: Command.create('save', '__save')
        }, {
          range: Range.create(0, 0, 1, 0),
          command: Command.create('save', '__save')
        }]
      }
    }))
    await shared.wait(20)
    await codeLens.checkProvider()
    let res = await doc.buffer.getExtMarks(srcId, 0, -1, { details: true })
    assert.strictEqual(res.length, 1)
  })

  it('should get commands from codeLenses', async t => {
    assert.deepStrictEqual(getCommands(1, undefined), [])
    let codeLenses = [CodeLens.create(Range.create(0, 0, 0, 0))]
    assert.deepStrictEqual(getCommands(0, codeLenses), [])
    codeLenses = [CodeLens.create(Range.create(0, 0, 1, 0)), CodeLens.create(Range.create(2, 0, 3, 0))]
    codeLenses[0].command = Command.create('save', '__save')
    assert.deepStrictEqual(getCommands(0, codeLenses).length, 1)
  })

  it('should get command text with tooltip', t => {
    let cmd = Command.create('save', '__save')
    assert.strictEqual(getCommandText(cmd), 'save')
    cmd.tooltip = 'save the file'
    assert.strictEqual(getCommandText(cmd), 'save - save the file')
    cmd.title = 's'
    cmd.tooltip = 't'.repeat(100)
    assert.strictEqual(getCommandText(cmd).endsWith('...'), true)
  })
})
