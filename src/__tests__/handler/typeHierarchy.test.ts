import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, TypeHierarchyItem, Disposable, Range, SymbolKind, Position, SymbolTag } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import languages, { ProviderName } from '../../languages'
import TypeHierarchyHandler from '../../handler/typeHierarchy'
import { addChildren } from '../../tree/LocationsDataProvider'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import helper, { createTmpFile } from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
let handler: TypeHierarchyHandler
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  handler = helper.plugin.getHandler().typeHierarchy
})

afterAll(async () => {
  await helper.shutdown()
})

beforeEach(async () => {
  await helper.createDocument()
})

afterEach(async () => {
  disposeAll(disposables)
  await helper.reset()
})

function createItem(name: string, kind?: SymbolKind, uri?: string, range?: Range): TypeHierarchyItem {
  range = range ?? Range.create(0, 0, 0, 3)
  return {
    name,
    kind: kind ?? SymbolKind.Function,
    uri: uri ?? 'file:///1',
    range,
    selectionRange: range,
  }
}
const position = Position.create(0, 0)
const token = CancellationToken.None

describe('TypeHierarchy', () => {
  describe('TypeHierarchyManager', () => {
    it('should return false when provider not exists', async () => {
      let doc = await workspace.document
      let res = languages.hasProvider(ProviderName.TypeHierarchy, doc.textDocument)
      assert.strictEqual(res, false)
    })

    it('should return merged results', async () => {
      disposables.push(languages.registerTypeHierarchyProvider([{ language: '*' }], {
        prepareTypeHierarchy: () => {
          return null
        },
        provideTypeHierarchySubtypes: () => {
          return []
        },
        provideTypeHierarchySupertypes: () => {
          return []
        }
      }))
      disposables.push(languages.registerTypeHierarchyProvider([{ language: '*' }], {
        prepareTypeHierarchy: () => {
          return [createItem('a'), createItem('b')]
        },
        provideTypeHierarchySubtypes: () => {
          return []
        },
        provideTypeHierarchySupertypes: () => {
          return []
        }
      }))
      disposables.push(languages.registerTypeHierarchyProvider([{ language: '*' }], {
        prepareTypeHierarchy: () => {
          return [createItem('b'), createItem('c')]
        },
        provideTypeHierarchySubtypes: () => {
          return []
        },
        provideTypeHierarchySupertypes: () => {
          return []
        }
      }))
      let doc = await workspace.document
      let res = await languages.prepareTypeHierarchy(doc.textDocument, position, token)
      assert.strictEqual(res.length, 3)
    })

    it('should return empty array when provider not found', async () => {
      let item = createItem('foo')
      let res: any
      res = await languages.provideTypeHierarchySupertypes(item, token)
      assert.deepStrictEqual(res, [])
      res = await languages.provideTypeHierarchySubtypes(item, token)
      assert.deepStrictEqual(res, [])
    })

    it('should return subtypes and supertypes', async () => {
      disposables.push(languages.registerTypeHierarchyProvider([{ language: '*' }], {
        prepareTypeHierarchy: () => {
          return [createItem('b')]
        },
        provideTypeHierarchySubtypes: () => {
          return [createItem('c')]
        },
        provideTypeHierarchySupertypes: () => {
          return [createItem('d')]
        }
      }))
      let doc = await workspace.document
      let res = await languages.prepareTypeHierarchy(doc.textDocument, position, token)
      let arr: any[]
      arr = await languages.provideTypeHierarchySubtypes(res[0], token)
      assert.strictEqual(arr.length, 1)
      assert.notStrictEqual(arr[0].source, undefined)
      arr = await languages.provideTypeHierarchySupertypes(res[0], token)
      assert.strictEqual(arr.length, 1)
      assert.notStrictEqual(arr[0].source, undefined)
    })

    it('should not throw when prepareTypeHierarchy throws', async () => {
      disposables.push(languages.registerTypeHierarchyProvider([{ language: '*' }], {
        prepareTypeHierarchy: () => {
          throw new Error('my error')
        },
        provideTypeHierarchySubtypes: () => {
          return undefined
        },
        provideTypeHierarchySupertypes: () => {
          return undefined
        }
      }))
      let doc = await workspace.document
      let res = await languages.prepareTypeHierarchy(doc.textDocument, position, token)
      assert.deepStrictEqual(res, [])
    })

    it('should return empty supertypes and supertypes', async () => {
      disposables.push(languages.registerTypeHierarchyProvider([{ language: '*' }], {
        prepareTypeHierarchy: () => {
          return [createItem('b')]
        },
        provideTypeHierarchySubtypes: () => {
          return null
        },
        provideTypeHierarchySupertypes: () => {
          return undefined
        }
      }))
      let doc = await workspace.document
      let res = await languages.prepareTypeHierarchy(doc.textDocument, position, token)
      let arr: any[]
      arr = await languages.provideTypeHierarchySubtypes(res[0], token)
      assert.deepStrictEqual(arr, [])
      arr = await languages.provideTypeHierarchySupertypes(res[0], token)
      assert.deepStrictEqual(arr, [])
    })
  })

  describe('TypeHierarchyHandler', () => {
    it('should add children', async () => {
      let item = createItem('foo')
      addChildren(item, undefined)
      assert.strictEqual(item['children'], undefined)
      addChildren(item, [], CancellationToken.Cancelled)
      assert.strictEqual(item['children'], undefined)
    })

    it('should throw when provider not exist', async () => {
      let fn = async () => {
        await handler.showTypeHierarchyTree('supertypes')
      }
      await assert.rejects(fn(), Error)
    })

    it('should show warning when prepare return empty', async () => {
      disposables.push(languages.registerTypeHierarchyProvider([{ language: '*' }], {
        prepareTypeHierarchy() {
          return null
        },
        provideTypeHierarchySupertypes() {
          return []
        },
        provideTypeHierarchySubtypes() {
          return []
        }
      }))
      let plugin = helper.plugin
      await plugin.cocAction('showSuperTypes')
      await nvim.command('echo ""')
      await plugin.cocAction('showSubTypes')
      let line = await helper.getCmdline()
      assert.ok((line).includes('Unable'))
    })

    it('should invoke super types and sub types action', async () => {
      let doc = await workspace.document
      disposables.push(languages.registerTypeHierarchyProvider([{ language: '*' }], {
        prepareTypeHierarchy() {
          return [createItem('foo', SymbolKind.Class, doc.uri, Range.create(0, 0, 0, 3))]
        },
        provideTypeHierarchySupertypes() {
          return undefined
        },
        provideTypeHierarchySubtypes() {
          return undefined
        }
      }))
      await handler.showTypeHierarchyTree('supertypes')
      await helper.waitFor('getline', [2], '- c foo')
      await nvim.command('exe 2')
      await nvim.input('<tab>')
      await helper.waitPrompt()
      await nvim.input('4')
      await helper.waitFor('getline', [1], 'Sub types')
      await nvim.input('<tab>')
      await helper.waitPrompt()
      await nvim.input('3')
      await helper.waitFor('getline', [1], 'Super types')
    })

    it('should render description and support default action', async () => {
      let doc = await workspace.document
      let bufnr = doc.bufnr
      await doc.buffer.setLines(['foo'], { start: 0, end: -1, strictIndexing: false })
      let fsPath = await createTmpFile('foo\nbar\ncontent\n')
      let uri = URI.file(fsPath).toString()
      disposables.push(languages.registerTypeHierarchyProvider([{ language: '*' }], {
        prepareTypeHierarchy() {
          return [createItem('foo', SymbolKind.Class, doc.uri, Range.create(0, 0, 0, 3))]
        },
        provideTypeHierarchySupertypes() {
          let item = createItem('bar', SymbolKind.Class, uri, Range.create(1, 0, 1, 3))
          item.detail = 'Detail'
          item.tags = [SymbolTag.Deprecated]
          return [item]
        },
        provideTypeHierarchySubtypes() {
          return []
        }
      }))
      await handler.showTypeHierarchyTree('supertypes')
      let buf = await nvim.buffer
      let lines = await buf.lines
      assert.deepStrictEqual(lines, [
        'Super types',
        '- c foo',
        '  + c bar Detail'
      ])
      await nvim.command('exe 3')
      await nvim.input('t')
      await helper.waitFor('getline', ['.'], '  - c bar Detail')
      await nvim.input('<cr>')
      await helper.waitFor('expand', ['%:p'], fsPath)
      let res = await nvim.call('coc#cursor#position')
      assert.deepStrictEqual(res, [1, 0])
      let matches = await nvim.call('getmatches') as any[]
      assert.strictEqual(matches.length, 1)
      await nvim.command(`b ${bufnr}`)
      await helper.waitValue(async () => (await nvim.call('getmatches') as any[]).length, 0)
      matches = await nvim.call('getmatches') as any[]
      assert.strictEqual(matches.length, 0)
      await nvim.command(`wincmd o`)
    })
  })
})
