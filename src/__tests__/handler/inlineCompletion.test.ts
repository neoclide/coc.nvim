import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, CancellationTokenSource, Disposable, InlineCompletionContext, InlineCompletionItem, InlineCompletionTriggerKind } from 'vscode-languageserver-protocol'
import languages from '../../languages'
import { disposeAll } from '../../util'
import window from '../../window'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

beforeEach(() => {
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
