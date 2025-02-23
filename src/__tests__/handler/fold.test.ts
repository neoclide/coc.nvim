import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, Disposable, FoldingRange } from 'vscode-languageserver-protocol'
import FoldHandler from '../../handler/fold'
import languages from '../../languages'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let folds: FoldHandler
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  folds = helper.plugin.getHandler().fold
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

describe('Folds', () => {
  it('should return empty array when provider does not exist', async () => {
    let doc = await workspace.document
    let token = (new CancellationTokenSource()).token
    expect(await languages.provideFoldingRanges(doc.textDocument, {}, token)).toEqual([])
  })

  it('should return false when no fold ranges found', async () => {
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges(_doc) {
        return []
      }
    }))
    let res = await helper.doAction('fold')
    expect(res).toBe(false)
  })

  it('should fold all fold ranges', async () => {
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges(_doc) {
        return [FoldingRange.create(1, 3), FoldingRange.create(4, 6, 0, 0, 'comment')]
      }
    }))
    await nvim.call('setline', [1, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']])
    let res = await folds.fold()
    expect(res).toBe(true)
    let closed = await nvim.call('foldclosed', [2])
    expect(closed).toBe(2)
    closed = await nvim.call('foldclosed', [5])
    expect(closed).toBe(5)
  })

  it('should merge folds from all providers', async () => {
    let doc = await workspace.document
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges() {
        return [FoldingRange.create(2, 3), FoldingRange.create(4, 6)]
      }
    }))
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges() {
        return [FoldingRange.create(1, 2), FoldingRange.create(5, 6), FoldingRange.create(7, 8)]
      }
    }))
    await nvim.call('setline', [1, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']])
    await doc.synchronize()
    let foldingRanges = await languages.provideFoldingRanges(doc.textDocument, {}, CancellationToken.None)
    expect(foldingRanges.length).toBe(4)
  })

  it('should ignore range start at the same line', async () => {
    let doc = await workspace.document
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges() {
        return [FoldingRange.create(2, 3), FoldingRange.create(4, 6)]
      }
    }))
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges() {
        return [FoldingRange.create(4, 5)]
      }
    }))
    await nvim.call('setline', [1, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']])
    await doc.synchronize()
    let foldingRanges = await languages.provideFoldingRanges(doc.textDocument, {}, CancellationToken.None)
    expect(foldingRanges.length).toBe(2)
  })

  it('should fold comment ranges', async () => {
    disposables.push(languages.registerFoldingRangeProvider([{ language: '*' }], {
      provideFoldingRanges(_doc) {
        return [FoldingRange.create(1, 3), FoldingRange.create(4, 6, 0, 0, 'comment')]
      }
    }))
    await nvim.call('setline', [1, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']])
    let res = await folds.fold('comment')
    expect(res).toBe(true)
    let closed = await nvim.call('foldclosed', [2])
    expect(closed).toBe(-1)
    closed = await nvim.call('foldclosed', [5])
    expect(closed).toBe(5)
  })
})
