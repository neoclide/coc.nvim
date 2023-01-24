import { Neovim } from '@chemzqm/neovim'
import { Disposable, SymbolKind } from 'vscode-languageserver-protocol'
import commands from '../../commands'
import Handler from '../../handler/index'
import { handleError, toDocumentation } from '../../handler/util'
import { ProviderName } from '../../languages'
import { disposeAll } from '../../util'
import helper from '../helper'

let nvim: Neovim
let handler: Handler
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  handler = (helper.plugin as any).handler
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

describe('Handler', () => {
  describe('util', () => {
    it('should handleError', () => {
      handleError(new Error('error'))
    })

    it('should to documentation', () => {
      expect(toDocumentation('doc')).toEqual({ content: 'doc', filetype: 'txt' })
      expect(toDocumentation({ kind: 'markdown', value: 'doc' })).toEqual({ content: 'doc', filetype: 'markdown' })
    })
  })

  describe('hasProvider', () => {
    it('should check provider for document', async () => {
      let res = await helper.doAction('hasProvider', 'definition')
      expect(res).toBe(false)
      await nvim.command(`edit +setl\\ buftype=nofile foo`)
      res = await handler.hasProvider('formatOnType')
      expect(res).toBe(false)
    })
  })

  describe('getIcon', () => {
    it('should get icon', () => {
      helper.updateConfiguration('suggest.completionItemKindLabels', {
        default: 'd'
      })
      let res = handler.getIcon(SymbolKind.Array)
      expect(res).toBeDefined()
      res = handler.getIcon('a' as any)
      expect(res.text).toBe('d')
    })
  })

  describe('commands', () => {
    it('should open url', async () => {
      let fn = jest.fn()
      let spy = jest.spyOn(nvim, 'call').mockImplementation(() => {
        fn()
        return null
      })
      await commands.executeCommand('vscode.open', 'http://www.example.com')
      spy.mockRestore()
      expect(fn).toBeCalled()
    })

    it('should restart', async () => {
      let fn = jest.fn()
      let spy = jest.spyOn(nvim, 'command').mockImplementation(() => {
        fn()
        return null
      })
      await commands.executeCommand('workbench.action.reloadWindow')
      spy.mockRestore()
      expect(fn).toBeCalled()
    })
  })

  describe('checkProvier', () => {
    it('should throw error when provider not found', async () => {
      let doc = await helper.createDocument()
      let err
      try {
        handler.checkProvider(ProviderName.Definition, doc.textDocument)
      } catch (e) {
        err = e
      }
      expect(err).toBeDefined()
    })
  })

  describe('withRequestToken', () => {
    it('should cancel previous request when called again', async () => {
      let cancelled = false
      let p = handler.withRequestToken('test', token => {
        return new Promise(s => {
          token.onCancellationRequested(() => {
            cancelled = true
            clearTimeout(timer)
            s(undefined)
          })
          let timer = setTimeout(() => {
            s(undefined)
          }, 3000)
        })
      }, false)
      setTimeout(async () => {
        await handler.withRequestToken('test', () => {
          return Promise.resolve(undefined)
        }, false)
      }, 50)
      await p
      expect(cancelled).toBe(true)
    })

    it('should cancel request on insert start', async () => {
      let cancelled = false
      let p = handler.withRequestToken('test', token => {
        return new Promise(s => {
          token.onCancellationRequested(() => {
            cancelled = true
            clearTimeout(timer)
            s(undefined)
          })
          let timer = setTimeout(() => {
            s(undefined)
          }, 3000)
        })
      }, false)
      await nvim.input('i')
      await p
      expect(cancelled).toBe(true)
    })
  })
})
