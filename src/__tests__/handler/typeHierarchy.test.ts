import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, TypeHierarchyItem, Disposable, Range, SymbolKind, Position } from 'vscode-languageserver-protocol'
import languages from '../../languages'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  // hover = helper.plugin.getHandler().hover
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

function createItem(name: string): TypeHierarchyItem {
  return {
    uri: 'file:///1',
    name,
    kind: SymbolKind.Function,
    range: Range.create(0, 0, 0, 3),
    selectionRange: Range.create(0, 0, 0, 3),
  }
}
const position = Position.create(0, 0)
const token = CancellationToken.None

describe('TypeHierarchy', () => {
  describe('TypeHierarchyManager', () => {
    it('should return false when provider not exists', async () => {
      let doc = await workspace.document
      let res = languages.hasProvider('typeHierarchy', doc.textDocument)
      expect(res).toBe(false)
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
      expect(res.length).toBe(3)
    })

    it('should return empty array when provider not found', async () => {
      let item = createItem('foo')
      let res: any
      res = await languages.provideTypeHierarchySupertypes(item, token)
      expect(res).toEqual([])
      res = await languages.provideTypeHierarchySubtypes(item, token)
      expect(res).toEqual([])
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
      expect(arr.length).toBe(1)
      expect(arr[0].source).toBeDefined()
      arr = await languages.provideTypeHierarchySupertypes(res[0], token)
      expect(arr.length).toBe(1)
      expect(arr[0].source).toBeDefined()
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
      expect(arr).toEqual([])
      arr = await languages.provideTypeHierarchySupertypes(res[0], token)
      expect(arr).toEqual([])
    })
  })
})
