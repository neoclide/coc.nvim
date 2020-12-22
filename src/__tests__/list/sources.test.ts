import { Neovim } from '@chemzqm/neovim'
import { ListContext, ListItem, ListArgument } from '../../types'
import manager from '../../list/manager'
import languages from '../../languages'
import helper from '../helper'
import workspace from '../../workspace'
import { CancellationToken } from 'vscode-jsonrpc'
import { Location, Range } from 'vscode-languageserver-types'
import BasicList from '../../list/basic'

let listItems: ListItem[] = []
class OptionList extends BasicList {
  public name = 'option'
  public options: ListArgument[] = [{
    name: '-w, -word',
    description: 'word'
  }, {
    name: '-i, -input INPUT',
    hasValue: true,
    description: 'input'
  }]
  constructor(nvim) {
    super(nvim)
    this.addLocationActions()
  }
  public loadItems(_context: ListContext, _token: CancellationToken): Promise<ListItem[]> {
    return Promise.resolve(listItems)
  }
}
jest.setTimeout(3000)

let nvim: Neovim
beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  manager.dispose()
  await helper.shutdown()
})

afterEach(async () => {
  manager.reset()
  await helper.reset()
  await helper.wait(100)
})

describe('BasicList', () => {
  describe('parse arguments', () => {
    it('should parse args #1', () => {
      let list = new OptionList(nvim)
      let res = list.parseArguments(['-w'])
      expect(res).toEqual({ word: true })
    })

    it('should parse args #2', () => {
      let list = new OptionList(nvim)
      let res = list.parseArguments(['-word'])
      expect(res).toEqual({ word: true })
    })

    it('should parse args #3', () => {
      let list = new OptionList(nvim)
      let res = list.parseArguments(['-input', 'foo'])
      expect(res).toEqual({ input: 'foo' })
    })
  })

  describe('preview()', () => {
    it('should preview sketch buffer', async () => {
      await nvim.command('new')
      await nvim.setLine('foo')
      let buffer = await nvim.buffer
      await helper.wait(30)
      let doc = workspace.getDocument(buffer.id)
      expect(doc.uri).toMatch('untitled')
      let list = new OptionList(nvim)
      listItems.push({
        label: 'foo',
        location: Location.create(doc.uri, Range.create(0, 0, 0, 0))
      })
      let disposable = manager.registerList(list)
      await manager.start(['option'])
      await helper.wait(100)
      await manager.doAction('preview')
      await helper.wait(100)
      await nvim.command('wincmd p')
      let win = await nvim.window
      let isPreview = await win.getVar('previewwindow')
      expect(isPreview).toBe(1)
      let line = await nvim.line
      expect(line).toBe('foo')
      disposable.dispose()
    })
  })
})

describe('list sources', () => {

  describe('commands', () => {
    it('should load commands source', async () => {
      await manager.start(['commands'])
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })

    it('should do run action', async () => {
      await manager.start(['commands'])
      await helper.wait(100)
      await manager.doAction()
    })
  })

  describe('diagnostics', () => {
    it('should load diagnostics source', async () => {
      await manager.start(['diagnostics'])
      await manager.session?.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('extensions', () => {
    it('should load extensions source', async () => {
      await manager.start(['extensions'])
      await manager.session?.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('folders', () => {
    it('should load folders source', async () => {
      await manager.start(['folders'])
      await manager.session?.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('lists', () => {
    it('should load lists source', async () => {
      await manager.start(['lists'])
      await manager.session?.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('outline', () => {
    it('should load outline source', async () => {
      await manager.start(['outline'])
      await manager.session?.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('services', () => {
    it('should load services source', async () => {
      await manager.start(['services'])
      await manager.session?.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('sources', () => {
    it('should load sources source', async () => {
      await manager.start(['sources'])
      await manager.session?.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('symbols', () => {
    it('should load symbols source', async () => {
      let disposable = languages.registerWorkspaceSymbolProvider({
        provideWorkspaceSymbols: () => []
      })
      await manager.start(['symbols'])
      await manager.session?.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
      disposable.dispose()
    })
  })

  describe('links', () => {
    it('should load links source', async () => {
      let disposable = languages.registerDocumentLinkProvider([{ scheme: 'file' }, { scheme: 'untitled' }], {
        provideDocumentLinks: () => []
      })
      await manager.start(['links'])
      await manager.session?.ui.ready
      await helper.wait(100)
      expect(manager.isActivated).toBe(true)
      disposable.dispose()
    })
  })
})
