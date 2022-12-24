import { Neovim } from '@chemzqm/neovim'
import { Disposable } from 'vscode-languageserver-protocol'
import commandManager from '../../commands'
import CommandsHandler from '../../handler/commands'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import helper from '../helper'

let nvim: Neovim
let commands: CommandsHandler
let disposables: Disposable[] = []
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  commands = helper.plugin.handler.commands
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

describe('Commands', () => {
  describe('addVimCommand', () => {
    it('should register global vim commands', async () => {
      await commandManager.executeCommand('vim.config')
      let val = await nvim.getVar('coc_config_init')
      expect(val).toBe(1)
      let list = await helper.doAction('commandList')
      expect(list.includes('vim.config')).toBe(true)
    })

    it('should add vim command with title', async () => {
      await helper.plugin.cocAction('addCommand', { id: 'bad', cmd: '', title: '' })
      commands.addVimCommand({ id: 'list', cmd: 'CocList', title: 'list of coc.nvim' })
      let res = commandManager.titles.get('vim.list')
      expect(res).toBe('list of coc.nvim')
      commandManager.unregister('vim.list')
      commandManager.unregister('unknown.command')
      let list = commands.getCommandList()
      expect(list.includes('bad')).toBe(false)
    })
  })

  describe('commandManager', () => {
    it('should replace builtin command', async () => {
      let fn = jest.fn()
      commandManager.registerCommand('editor.action.restart', () => {
        fn()
      })
      await commandManager.executeCommand('editor.action.restart')
      expect(fn).toBeCalled()
    })

    it('should throw when command not found', async () => {
      await expect(async () => {
        await commandManager.executeCommand('')
      }).rejects.toThrow(Error)
    })

    it('should add to recent', async () => {
      await commandManager.addRecent('document.checkBuffer', true)
      let mru = workspace.createMru('commands')
      let list = await mru.load()
      expect(list[0]).toBe('document.checkBuffer')
    })
  })

  describe('getCommands', () => {
    it('should get command items', async () => {
      let res = await helper.doAction('commands')
      let idx = res.findIndex(o => o.id == 'workspace.showOutput')
      expect(idx != -1).toBe(true)
    })
  })

  describe('repeat', () => {
    it('should repeat command', async () => {
      // let buf = await nvim.buffer
      await nvim.call('setline', [1, ['a', 'b', 'c']])
      await nvim.call('cursor', [1, 1])
      commands.addVimCommand({ id: 'remove', cmd: 'normal! dd' })
      await helper.doAction('runCommand', 'vim.remove')
      await helper.waitFor('getline', ['.'], 'b')
      await helper.doAction('repeatCommand')
      await helper.waitFor('getline', ['.'], 'c')
    })
  })

  describe('runCommand', () => {
    it('should open command list without id', async () => {
      await commands.runCommand()
      await helper.waitFor('bufname', ['%'], 'list:///commands')
    })
  })
})
