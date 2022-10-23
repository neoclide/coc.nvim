import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import WorkspaceHandler from '../../handler/workspace'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import extensions from '../../extension'
import events from '../../events'
import helper from '../helper'

let nvim: Neovim
let handler: WorkspaceHandler
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  handler = helper.plugin.getHandler().workspace
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  disposeAll(disposables)
  await helper.reset()
})

describe('Workspace handler', () => {
  describe('methods', () => {
    it('should check env on vim resized', async () => {
      await events.fire('VimResized', [80, 80])
      expect(workspace.env.columns).toBe(80)
      await events.fire('VimResized', [160, 80])
      expect(workspace.env.columns).toBe(160)
    })

    it('should check json extension', async () => {
      let spy = jest.spyOn(extensions, 'has').mockImplementation(() => {
        return true
      })
      await helper.doAction('checkJsonExtension')
      spy.mockRestore()
      await helper.doAction('checkJsonExtension')
      let line = await helper.getCmdline()
      expect(line).toBeDefined()
    })

    it('should get rootPatterns', async () => {
      let bufnr = await nvim.call('bufnr', ['%'])
      let res = await helper.doAction('rootPatterns', bufnr)
      expect(res).toBeDefined()
    })

    it('should get config by key', async () => {
      let res = await helper.doAction('getConfig', ['suggest'])
      expect(res.autoTrigger).toBeDefined()
    })

    it('should open log', async () => {
      await helper.doAction('openLog')
      let bufname = await nvim.call('bufname', ['%']) as string
      expect(bufname).toMatch('coc-nvim')
    })

    it('should get configuration of current document', async () => {
      let config = await handler.getConfiguration('suggest')
      let wait = config.get<number>('triggerCompletionWait')
      expect(wait).toBe(0)
    })

    it('should get root patterns', async () => {
      let doc = await helper.createDocument()
      let patterns = handler.getRootPatterns(doc.bufnr)
      expect(patterns).toBeDefined()
      patterns = handler.getRootPatterns(999)
      expect(patterns).toBeNull()
    })
  })

  describe('doKeymap()', () => {
    it('should return default value when key mapping does not exist', async () => {
      let res = await handler.doKeymap('not_exists', '', '<C-a')
      expect(res).toBe('')
    })

    it('should support repeat key mapping', async () => {
      let called = false
      await nvim.command('nmap do <Plug>(coc-test)')
      disposables.push(workspace.registerKeymap(['n'], 'test', () => {
        called = true
      }, { repeat: true, silent: true, sync: false }))
      await helper.waitValue(async () => {
        let res = await nvim.call('maparg', ['<Plug>(coc-test)', 'n']) as string
        return res.length > 0
      }, true)
      await nvim.call('feedkeys', ['do', 'i'])
      await helper.waitValue(() => {
        return called
      }, true)
    })
  })

  describe('snippetCheck()', () => {
    it('should return false when coc-snippets not found', async () => {
      let fn = async () => {
        expect(await handler.snippetCheck(true, false)).toBe(false)
      }
      await expect(fn()).rejects.toThrow(Error)
      let spy = jest.spyOn(extensions.manager, 'call').mockImplementation(() => {
        return Promise.resolve(true)
      })
      expect(await handler.snippetCheck(true, false)).toBe(true)
      spy.mockRestore()
    })

    it('should check jump', async () => {
      expect(await handler.snippetCheck(false, true)).toBe(false)
    })
  })
})
