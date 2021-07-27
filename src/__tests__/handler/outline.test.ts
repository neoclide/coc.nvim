import { Buffer, Neovim } from '@chemzqm/neovim'
import { Disposable, SymbolTag } from 'vscode-languageserver-protocol'
import Symbols from '../../handler/symbols/index'
import languages from '../../languages'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
import events from '../../events'
import helper from '../helper'
import Parser from './parser'

let nvim: Neovim
let symbols: Symbols
let disposables: Disposable[] = []

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
  symbols = helper.plugin.getHandler().symbols
})

beforeEach(() => {
  disposables.push(languages.registerDocumentSymbolProvider([{ language: 'javascript' }], {
    provideDocumentSymbols: document => {
      let parser = new Parser(document.getText())
      let res = parser.parse()
      if (res.length) {
        res[0].tags = [SymbolTag.Deprecated]
      }
      return Promise.resolve(res)
    }
  }))
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  await helper.reset()
  disposeAll(disposables)
  disposables = []
})

async function getOutlineBuffer(): Promise<Buffer | undefined> {
  let winid = await nvim.call('coc#window#find', ['cocViewId', 'OUTLINE'])
  if (winid == -1) return undefined
  let bufnr = await nvim.call('winbufnr', [winid])
  if (bufnr == -1) return undefined
  return nvim.createBuffer(bufnr)
}

describe('symbols outline', () => {

  let defaultCode = `class myClass {
  fun1() { }
  fun2() {}
}`

  async function createBuffer(code = defaultCode): Promise<Buffer> {
    await helper.edit()
    let buf = await nvim.buffer
    await nvim.command('setf javascript')
    await buf.setLines(code.split('\n'), { start: 0, end: -1, strictIndexing: false })
    let doc = await workspace.document
    doc.forceSync()
    return buf
  }

  describe('configuration', () => {
    afterEach(() => {
      let { configurations } = workspace
      configurations.updateUserConfig({
        'outline.splitCommand': 'botright 30vs',
        'outline.followCursor': true,
        'outline.keepWindow': false,
        'outline.sortBy': 'category',
        'outline.expandLevel': 1,
        'outline.checkBufferSwitch': true
      })
    })

    it('should follow cursor', async () => {
      await createBuffer()
      let curr = await nvim.call('bufnr', ['%'])
      await symbols.showOutline(0)
      let bufnr = await nvim.call('bufnr', ['%'])
      await nvim.command('wincmd p')
      await nvim.command('exe 3')
      await events.fire('CursorHold', [curr])
      await helper.wait(50)
      let buf = nvim.createBuffer(bufnr)
      let lines = await buf.getLines()
      expect(lines).toEqual([
        'OUTLINE', '- c myClass', '    m fun1', '    m fun2'
      ])
      let signs = await buf.getSigns({ group: 'CocTree' })
      expect(signs.length).toBe(1)
      expect(signs[0]).toEqual({
        lnum: 2,
        id: 3001,
        name: 'CocTreeSelected',
        priority: 10,
        group: 'CocTree'
      })
    })

    it('should not follow cursor', async () => {
      workspace.configurations.updateUserConfig({
        'outline.followCursor': false,
      })
      await createBuffer()
      let curr = await nvim.call('bufnr', ['%'])
      await symbols.showOutline(0)
      let bufnr = await nvim.call('bufnr', ['%'])
      await nvim.command('wincmd p')
      await nvim.command('exe 3')
      await events.fire('CursorHold', [curr])
      await helper.wait(50)
      let buf = nvim.createBuffer(bufnr)
      let signs = await buf.getSigns({ group: 'CocTree' })
      expect(signs.length).toBe(0)
    })

    it('should keep current window', async () => {
      workspace.configurations.updateUserConfig({
        'outline.keepWindow': true,
      })
      await createBuffer()
      let curr = await nvim.call('bufnr', ['%'])
      await symbols.showOutline()
      let bufnr = await nvim.call('bufnr', ['%'])
      expect(curr).toBe(bufnr)
    })

    it('should check on buffer switch', async () => {
      workspace.configurations.updateUserConfig({
        'outline.checkBufferSwitch': true,
      })
      await createBuffer()
      await symbols.showOutline(1)
      await helper.edit('unnamed')
      await helper.wait(200)
      let buf = await getOutlineBuffer()
      let lines = await buf.lines
      expect(lines).toEqual(['Document symbol provider not found'])
    })

    it('should not check on buffer switch', async () => {
      workspace.configurations.updateUserConfig({
        'outline.checkBufferSwitch': false
      })
      await helper.wait(30)
      await createBuffer()
      await symbols.showOutline(1)
      await helper.edit('unnamed')
      await helper.wait(100)
      let buf = await getOutlineBuffer()
      let lines = await buf.lines
      expect(lines).toEqual([
        'OUTLINE', '- c myClass', '    m fun1', '    m fun2'
      ])
    })

    it('should not check on buffer reload', async () => {
      workspace.configurations.updateUserConfig({
        'outline.checkBufferSwitch': false
      })
      await symbols.showOutline(1)
      await helper.wait(50)
      await createBuffer()
      await helper.wait(50)
      let buf = await getOutlineBuffer()
      expect(buf).toBeUndefined()
    })

    it('should sort by position', async () => {
      let code = `class myClass {
  fun2() { }
  fun1() {}
}`
      workspace.configurations.updateUserConfig({
        'outline.sortBy': 'position',
      })
      await createBuffer(code)
      await symbols.showOutline(1)
      let buf = await getOutlineBuffer()
      let lines = await buf.lines
      expect(lines).toEqual([
        'OUTLINE', '- c myClass', '    m fun2', '    m fun1'
      ])
    })

    it('should sort by name', async () => {
      let code = `class myClass {
  fun2() {}
  fun1() {}
}`
      workspace.configurations.updateUserConfig({
        'outline.sortBy': 'name',
      })
      await createBuffer(code)
      await symbols.showOutline(1)
      let buf = await getOutlineBuffer()
      let lines = await buf.lines
      expect(lines).toEqual([
        'OUTLINE', '- c myClass', '    m fun1', '    m fun2'
      ])
    })
  })

  describe('events', () => {

    it('should dispose on buffer unload', async () => {
      await createBuffer()
      let curr = await nvim.call('bufnr', ['%'])
      await symbols.showOutline(0)
      await nvim.command('tabe')
      await nvim.command(`bd! ${curr}`)
      await helper.wait(30)
      let buf = await getOutlineBuffer()
      expect(buf).toBeUndefined()
    })

    it('should recreated when original window exists', async () => {
      await symbols.showOutline(1)
      await createBuffer()
      await helper.wait(50)
      let buf = await getOutlineBuffer()
      expect(buf).toBeDefined()
    })

    it('should keep old outline when new buffer not attached', async () => {
      await createBuffer()
      await symbols.showOutline(1)
      await nvim.command(`vnew +setl\\ buftype=nofile`)
      await helper.wait(50)
      let buf = await getOutlineBuffer()
      expect(buf).toBeDefined()
      let lines = await buf.lines
      expect(lines).toEqual([
        'OUTLINE', '- c myClass', '    m fun1', '    m fun2'
      ])
    })

    it('should not reload when switch to original buffer', async () => {
      await createBuffer()
      await symbols.showOutline(0)
      let buf = await getOutlineBuffer()
      let name = await buf.name
      await nvim.command('wincmd p')
      await helper.wait(50)
      buf = await getOutlineBuffer()
      let curr = await buf.name
      expect(curr).toBe(name)
    })

    it('should dispose provider on outline hide', async () => {
      await createBuffer()
      let bufnr = await nvim.call('bufnr', ['%'])
      await symbols.showOutline(0)
      await nvim.command('q')
      await helper.wait(30)
      let exists = symbols.hasOutline(bufnr)
      expect(exists).toBe(false)
    })
  })

  describe('show()', () => {
    it('should throw when document not attached', async () => {
      await nvim.command(`edit +setl\\ buftype=nofile t`)
      await helper.wait(50)
      let err
      try {
        await symbols.showOutline(1)
      } catch (e) {
        err = e
      }
      expect(err).toBeDefined()
    })

    it('should not throw when provider not exists', async () => {
      await symbols.showOutline(1)
      let buf = await getOutlineBuffer()
      expect(buf).toBeDefined()
    })

    it('should not throw when symbols is empty', async () => {
      await createBuffer('')
      await symbols.showOutline(1)
      let buf = await getOutlineBuffer()
      expect(buf).toBeDefined()
    })

    it('should jump to selected symbol', async () => {
      await createBuffer()
      let bufnr = await nvim.call('bufnr', ['%'])
      await symbols.showOutline(0)
      await helper.wait(50)
      await nvim.command('exe 3')
      await nvim.input('<cr>')
      await helper.wait(50)
      let curr = await nvim.call('bufnr', ['%'])
      expect(curr).toBe(bufnr)
      let cursor = await nvim.call('coc#util#cursor')
      expect(cursor).toEqual([1, 2])
    })

    it('should update symbols', async () => {
      await createBuffer()
      let bufnr = await nvim.call('bufnr', ['%'])
      await symbols.showOutline(1)
      await helper.wait(10)
      let buf = nvim.createBuffer(bufnr)
      let code = 'class foo{}'
      await buf.setLines(code.split('\n'), {
        start: 0,
        end: -1,
        strictIndexing: false
      })
      await helper.wait(200)
      buf = await getOutlineBuffer()
      let lines = await buf.lines
      expect(lines).toEqual(['OUTLINE'])
    })
  })

  describe('hide()', () => {
    it('should hide outline', async () => {
      await createBuffer('')
      await symbols.showOutline(0)
      await symbols.hideOutline()
      let buf = await getOutlineBuffer()
      expect(buf).toBeUndefined()
    })

    it('should not throw when outline not exists', async () => {
      await symbols.hideOutline()
      let buf = await getOutlineBuffer()
      expect(buf).toBeUndefined()
    })
  })

  describe('dispose', () => {
    it('should dispose provider and views', async () => {
      await createBuffer('')
      let bufnr = await nvim.call('bufnr', ['%'])
      await symbols.showOutline(1)
      symbols.dispose()
      await helper.wait(50)
      expect(symbols.hasOutline(bufnr)).toBe(false)
      let buf = await getOutlineBuffer()
      expect(buf).toBeUndefined()
    })
  })
})
