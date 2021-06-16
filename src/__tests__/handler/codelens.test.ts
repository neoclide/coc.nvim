import { Neovim } from '@chemzqm/neovim'
import { Disposable, Range, Command } from 'vscode-languageserver-protocol'
import { disposeAll } from '../../util'
import languages from '../../languages'
import commands from '../../commands'
import CodeLens from '../../handler/codelens/index'
import helper, { createTmpFile } from '../helper'
import events from '../../events'

let nvim: Neovim
let codeLens: CodeLens
let disposables: Disposable[] = []
let srcId: number

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  srcId = await nvim.createNamespace('coc-codelens')
  codeLens = helper.plugin.getHandler().codeLens
  helper.updateConfiguration('codeLens.enable', true)
})

afterAll(async () => {
  helper.updateConfiguration('codeLens.enable', false)
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
  disposeAll(disposables)
  disposables = []
})

describe('codeLenes featrue', () => {

  it('should do codeLenes request and resolve codeLenes', async () => {
    disposables.push(languages.registerCodeLensProvider([{ language: 'javascript' }], {
      provideCodeLenses: () => {
        return [{
          range: Range.create(0, 0, 0, 1)
        }, {
          range: Range.create(1, 0, 1, 1)
        }]
      },
      resolveCodeLens: codeLens => {
        codeLens.command = Command.create('save', '__save')
        return codeLens
      }
    }))
    let doc = await helper.createDocument('example.js')
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    codeLens.checkProvider()
    await helper.wait(150)
    let buf = codeLens.buffers.getItem(doc.bufnr)
    let codelens = buf.getCodelenses()
    expect(codelens).toBeDefined()
    expect(codelens[0].command).toBeDefined()
    expect(codelens[1].command).toBeDefined()
    let markers = await helper.getMarkers(doc.bufnr, srcId)
    expect(markers.length).toBe(2)
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
    await helper.wait(100)
    let markers = await helper.getMarkers(doc.bufnr, srcId)
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    await events.fire('CursorHold', [doc.bufnr])
    await helper.wait(200)
    markers = await helper.getMarkers(doc.bufnr, srcId)
    expect(markers.length).toBe(3)
  })

  it('should cancel codeLenes request on document change', async () => {
    disposables.push(languages.registerCodeLensProvider([{ language: 'javascript' }], {
      provideCodeLenses: () => {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve([{
              range: Range.create(0, 0, 0, 1)
            }, {
              range: Range.create(1, 0, 1, 1)
            }])
          }, 2000)
        })
      },
      resolveCodeLens: codeLens => {
        codeLens.command = Command.create('save', '__save')
        return codeLens
      }
    }))
    let doc = await helper.createDocument('example.js')
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    codeLens.checkProvider()
    await helper.wait(50)
    await nvim.call('setline', [1, 'foo'])
    await helper.wait(200)
    let buf = codeLens.buffers.getItem(doc.bufnr)
    let codelens = buf.getCodelenses()
    expect(codelens).toBeUndefined()
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
      resolveCodeLens: codeLens => {
        codeLens.command = Command.create('save', '__save')
        return codeLens
      }
    }))
    let doc = await helper.createDocument('example.js')
    let arr = new Array(100)
    arr.fill('')
    await nvim.call('setline', [1, arr])
    codeLens.checkProvider()
    await helper.wait(50)
    await nvim.command('normal! G')
    await helper.wait(120)
    let buf = codeLens.buffers.getItem(doc.bufnr)
    let codelens = buf.getCodelenses()
    expect(codelens).toBeDefined()
    expect(codelens[0].command).toBeDefined()
    expect(codelens[1].command).toBeDefined()
  })

  it('should invoke codeLenes action', async () => {
    let fn = jest.fn()
    disposables.push(commands.registerCommand('__save', (...args) => {
      fn(...args)
    }))
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
    await helper.createDocument('example.js')
    await nvim.call('setline', [1, ['a', 'b', 'c']])
    codeLens.checkProvider()
    await helper.wait(120)
    await helper.doAction('codeLensAction')
    expect(fn).toBeCalledWith(1, 2, 3)
  })

  it('should refresh on configuration change', async () => {
    disposables.push(languages.registerCodeLensProvider([{ language: '*' }], {
      provideCodeLenses: () => {
        return [{
          range: Range.create(0, 0, 0, 1),
          command: Command.create('save', '__save')
        }]
      }
    }))
    let filepath = await createTmpFile('abc')
    let buffer = await helper.edit(filepath)
    codeLens.checkProvider()
    await helper.wait(100)
    helper.updateConfiguration('codeLens.enable', false)
    await helper.wait(100)
    let markers = await helper.getMarkers(buffer.id, srcId)
    expect(markers.length).toBe(0)
    helper.updateConfiguration('codeLens.enable', true)
    await helper.wait(500)
    markers = await helper.getMarkers(buffer.id, srcId)
    expect(markers.length).toBeGreaterThan(0)
  })
})
