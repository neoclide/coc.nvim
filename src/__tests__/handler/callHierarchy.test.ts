import { Neovim } from '@chemzqm/neovim'
import { Disposable, CallHierarchyItem, SymbolKind, Range } from 'vscode-languageserver-protocol'
import CallHierarchyHandler from '../../handler/callHierarchy'
import languages from '../../languages'
import { disposeAll } from '../../util'
import helper from '../helper'

let nvim: Neovim
let callHierarchy: CallHierarchyHandler
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  callHierarchy = (helper.plugin as any).handler.callHierarchy
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

function createCallItem(name: string, kind: SymbolKind, uri: string, range: Range): CallHierarchyItem {
  return {
    name,
    kind,
    uri,
    range,
    selectionRange: range
  }
}

describe('CallHierarchy', () => {
  it('should throw for invalid incoming item', async () => {
    let err
    try {
      await callHierarchy.getIncoming({} as any)
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })

  it('should throw for invalid outgoint item', async () => {
    let err
    try {
      await callHierarchy.getOutgoing({} as any)
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })

  it('should get incoming & outgoing callHierarchy items', async () => {
    disposables.push(languages.registerCallHierarchyProvider([{ language: '*' }], {
      prepareCallHierarchy() {
        return createCallItem('foo', SymbolKind.Class, 'test:///foo', Range.create(0, 0, 0, 5))
      },
      provideCallHierarchyIncomingCalls() {
        return [{
          from: createCallItem('bar', SymbolKind.Class, 'test:///bar', Range.create(1, 0, 1, 5)),
          fromRanges: [Range.create(0, 0, 0, 5)]
        }]
      },
      provideCallHierarchyOutgoingCalls() {
        return [{
          to: createCallItem('bar', SymbolKind.Class, 'test:///bar', Range.create(1, 0, 1, 5)),
          fromRanges: [Range.create(1, 0, 1, 5)]
        }]
      }
    }))
    let res = await callHierarchy.getIncoming()
    expect(res.length).toBe(1)
    expect(res[0].from.name).toBe('bar')
    let outgoing = await callHierarchy.getOutgoing()
    expect(outgoing.length).toBe(1)
  })
})
