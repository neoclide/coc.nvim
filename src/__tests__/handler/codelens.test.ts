import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CodeLens, Command, Disposable, Position, Range, TextEdit } from 'vscode-languageserver-protocol'
import commands from '../../commands'
import events from '../../events'
import CodeLensBuffer, { getCommands, getTextAlign } from '../../handler/codelens/buffer'
import CodeLensHandler from '../../handler/codelens/index'
import languages from '../../languages'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let codeLens: CodeLensHandler
let disposables: Disposable[] = []
let srcId: number

jest.setTimeout(10000)
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  srcId = await nvim.createNamespace('coc-codelens')
  codeLens = helper.plugin.getHandler().codeLens
})

beforeEach(() => {
  helper.updateConfiguration('codeLens.enable', true)
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
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
  let doc = await helper.createDocument('e.js')
  await nvim.call('setline', [1, ['a', 'b', 'c']])
  await doc.synchronize()
  await codeLens.checkProvider()
  return codeLens.buffers.getItem(doc.bufnr)
}

describe('codeLenes featrue', () => {
  it('should get text align', async () => {
    expect(getTextAlign(undefined)).toBe('above')
    expect(getTextAlign('top')).toBe('above')
    expect(getTextAlign('eol')).toBe('after')
    expect(getTextAlign('right_align')).toBe('right')
  })

  it('should not throw when srcId not exists', async () => {
    let doc = await workspace.document
    let item = codeLens.buffers.getItem(doc.bufnr)
    item.clear()
    await item.doAction(0)
  })

  it('should invoke codeLenes action', async () => {
    let fn = jest.fn()
    disposables.push(commands.registerCommand('__save', (...args) => {
      fn(...args)
    }))
    await createBufferWithCodeLens()
    await helper.doAction('codeLensAction')
    expect(fn).toBeCalledWith(1, 2, 3)
    await nvim.command('normal! G')
    await helper.doAction('codeLensAction')
  })

  it('should toggle codeLens display', async () => {
    await codeLens.toggle(999)
    let line = await helper.getCmdline()
    expect(line).toMatch('not created')
    await createBufferWithCodeLens()
    await commands.executeCommand('document.toggleCodeLens')
    let doc = await workspace.document
    let res = await doc.buffer.getExtMarks(srcId, 0, -1, { details: true })
    expect(res.length).toBe(0)
    await commands.executeCommand('document.toggleCodeLens')
    await helper.waitValue(async () => {
      let res = await doc.buffer.getExtMarks(srcId, 0, -1, { details: true })
      return res.length > 0
    }, true)
  })

  it('should return codeLenes when resolve not exists', async () => {
    let codeLens = CodeLens.create(Range.create(0, 0, 1, 1))
    let resolved = await languages.resolveCodeLens(codeLens, CancellationToken.None)
    expect(resolved).toBeDefined()
  })

  it('should do codeLenes request and resolve codeLenes', async () => {
    let buf = await createBufferWithCodeLens()
    let doc = await workspace.document
    await helper.waitValue(async () => {
      let codelens = buf.currentCodeLens
      return Array.isArray(codelens) && codelens[0].command != null
    }, true)
    let markers = await doc.buffer.getExtMarks(srcId, 0, -1)
    expect(markers.length).toBe(1)
    let codeLenes = buf.currentCodeLens
    await languages.resolveCodeLens(codeLenes[0], CancellationToken.None)
  })

  it('should refresh on empty changes', async () => {
    await createBufferWithCodeLens()
    let doc = await workspace.document
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    await doc.synchronize()
    let markers = await doc.buffer.getExtMarks(srcId, 0, -1)
    expect(markers.length).toBeGreaterThan(0)
  })

  it('should work with empty codeLens', async () => {
    disposables.push(languages.registerCodeLensProvider([{ language: 'javascript' }], {
      provideCodeLenses: () => {
        return []
      }
    }))
    let doc = await helper.createDocument('t.js')
    let buf = codeLens.buffers.getItem(doc.bufnr)
    let codelens = buf.currentCodeLens
    expect(codelens).toBeUndefined()
  })

  it('should change codeLenes position', async () => {
    helper.updateConfiguration('codeLens.position', 'eol')
    let bufnr = await nvim.call('bufnr', ['%']) as number
    let item = codeLens.buffers.getItem(bufnr)
    expect(item.config.position).toBe('eol')
  })

  it('should refresh codeLens on CursorHold', async () => {
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
    let doc = await helper.createDocument('example.js')
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    await doc.synchronize()
    await events.fire('CursorHold', [doc.bufnr])
    await helper.waitValue(async () => {
      let markers = await doc.buffer.getExtMarks(srcId, 0, -1)
      return markers.length
    }, 3)
    helper.updateConfiguration('codeLens.enable', false)
    await events.fire('CursorHold', [doc.bufnr])
  })

  it('should cancel codeLenes request on document change', async () => {
    let cancelled = false
    disposables.push(languages.registerCodeLensProvider([{ language: 'javascript' }], {
      provideCodeLenses: (_, token) => {
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
    let doc = await helper.createDocument('codelens.js')
    await helper.wait(50)
    await doc.applyEdits([TextEdit.insert(Position.create(0, 0), 'a\nb\nc')])
    expect(cancelled).toBe(true)
  })

  it('should resolve on CursorMoved', async () => {
    disposables.push(languages.registerCodeLensProvider([{ language: 'javascript' }], {
      provideCodeLenses: () => {
        return [{
          range: Range.create(90, 0, 90, 1)
        }, {
          range: Range.create(91, 0, 91, 1)
        }]
      },
      resolveCodeLens: async codeLens => {
        codeLens.command = Command.create('save', '__save')
        return codeLens
      }
    }))
    let doc = await helper.createDocument('example.js')
    let arr = new Array(100)
    arr.fill('')
    await nvim.call('setline', [1, arr])
    await doc.synchronize()
    await codeLens.checkProvider()
    await nvim.command('normal! gg')
    await nvim.command('normal! G')
    await helper.wait(100)
    let buf = codeLens.buffers.getItem(doc.bufnr)
    let codelens = buf.currentCodeLens
    expect(codelens).toBeDefined()
    expect(codelens[0].command).toBeDefined()
    expect(codelens[1].command).toBeDefined()
  })

  it('should use picker for multiple codeLenses', async () => {
    let fn = jest.fn()
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
    let doc = await helper.createDocument('example.js')
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    await doc.synchronize()
    await codeLens.checkProvider()
    await helper.waitValue(() => {
      return resolved
    }, true)
    let p = helper.doAction('codeLensAction')
    await helper.waitPrompt()
    await nvim.input('<cr>')
    await p
    expect(fn).toBeCalledWith(1, 2, 3)
  })

  it('should refresh for failed codeLens request', async () => {
    let called = 0
    let fn = jest.fn()
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
    let doc = await helper.createDocument('example.js')
    await helper.wait(50)
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    await codeLens.checkProvider()
    let markers = await doc.buffer.getExtMarks(srcId, 0, -1)
    expect(markers.length).toBeGreaterThan(0)
    let codeLensBuffer = codeLens.buffers.getItem(doc.buffer.id)
    await codeLensBuffer.forceFetch()
    let curr = codeLensBuffer.currentCodeLens
    expect(curr.length).toBeGreaterThan(1)
  })

  it('should use custom separator & position', async () => {
    helper.updateConfiguration('codeLens.separator', '|')
    helper.updateConfiguration('codeLens.position', 'eol')
    let doc = await helper.createDocument('example.js')
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
    await codeLens.checkProvider()
    let res = await doc.buffer.getExtMarks(srcId, 0, -1, { details: true })
    expect(res.length).toBe(1)
  })

  it('should get commands from codeLenses', async () => {
    expect(getCommands(1, undefined)).toEqual([])
    let codeLenses = [CodeLens.create(Range.create(0, 0, 0, 0))]
    expect(getCommands(0, codeLenses)).toEqual([])
    codeLenses = [CodeLens.create(Range.create(0, 0, 1, 0)), CodeLens.create(Range.create(2, 0, 3, 0))]
    codeLenses[0].command = Command.create('save', '__save')
    expect(getCommands(0, codeLenses).length).toEqual(1)
  })
})
