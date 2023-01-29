import { Neovim } from '@chemzqm/neovim'
import fs from 'fs'
import os from 'os'
import { v4 as uuid } from 'uuid'
import { CancellationToken, Diagnostic, DiagnosticSeverity, Disposable, DocumentLink, DocumentSymbol, Emitter, Location, Position, Range, SymbolInformation, SymbolKind, SymbolTag, TextEdit } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import diagnosticManager, { DiagnosticItem } from '../../diagnostic/manager'
import events from '../../events'
import extensions from '../../extension/index'
import { ExtensionInfo, ExtensionManager } from '../../extension/manager'
import { ExtensionStat } from '../../extension/stat'
import languages from '../../languages'
import BasicList, { PreviewOptions, toVimFiletype } from '../../list/basic'
import { fixWidth, formatListItems, formatPath, formatUri, UnformattedListItem } from '../../list/formatting'
import manager from '../../list/manager'
import { convertToLabel } from '../../list/source/diagnostics'
import ExtensionList, { getExtensionPrefix, getExtensionPriority, sortExtensionItem } from '../../list/source/extensions'
import FolderList from '../../list/source/folders'
import { mruScore } from '../../list/source/lists'
import OutlineList, { contentToItems, getFilterText, loadCtagsSymbols, symbolsToListItems } from '../../list/source/outline'
import SymbolsList, { sortSymbolItems } from '../../list/source/symbols'
import { ListArgument, ListContext, ListItem, ListOptions } from '../../list/types'
import Document from '../../model/document'
import services, { IServiceProvider, ServiceStat } from '../../services'
import { QuickfixItem } from '../../types'
import { disposeAll } from '../../util'
import * as extension from '../../util/extensionRegistry'
import { path, which } from '../../util/node'
import { Registry } from '../../util/registry'
import window from '../../window'
import workspace from '../../workspace'
import Parser from '../handler/parser'
import helper from '../helper'

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
  }, {
    key: 'name',
    description: '',
    name: '-name'
  }]
  constructor() {
    super()
    this.addLocationActions()
  }
  public loadItems(_context: ListContext, _token: CancellationToken): Promise<ListItem[]> {
    return Promise.resolve(listItems)
  }
}

let previewOptions: PreviewOptions
class SimpleList extends BasicList {
  public name = 'simple'
  public defaultAction: 'preview'
  constructor() {
    super()
    this.addAction('preview', async (_item, context) => {
      await this.preview(previewOptions, context)
    })
  }
  public loadItems(): Promise<ListItem[]> {
    return Promise.resolve(['a', 'b', 'c'].map((s, idx) => {
      return { label: s, location: Location.create('test:///a', Range.create(idx, 0, idx + 1, 0)) } as ListItem
    }))
  }
}

async function createContext(option: Partial<ListOptions>): Promise<ListContext> {
  let buffer = await nvim.buffer
  let window = await nvim.window
  return {
    args: [],
    buffer,
    cwd: process.cwd(),
    input: '',
    listWindow: nvim.createWindow(1002),
    options: Object.assign({
      position: 'bottom',
      reverse: false,
      input: '',
      ignorecase: false,
      smartcase: false,
      interactive: false,
      sort: false,
      mode: 'normal',
      matcher: 'strict',
      autoPreview: false,
      numberSelect: false,
      noQuit: false,
      first: false
    }, option),
    window
  }
}

let disposables: Disposable[] = []
let nvim: Neovim
const locations: QuickfixItem[] = [{
  filename: __filename,
  range: Range.create(0, 0, 0, 6),
  targetRange: Range.create(0, 0, 0, 6),
  text: 'foo',
  type: 'Error'
}, {
  filename: __filename,
  range: Range.create(2, 0, 2, 6),
  text: 'Bar',
  type: 'Warning'
}, {
  filename: __filename,
  range: Range.create(3, 0, 4, 6),
  text: 'multiple'
}, {
  filename: path.join(os.tmpdir(), '3195369f-5b9f-4c46-99cd-6007c0224595'),
  range: Range.create(3, 0, 4, 6),
  text: 'tmpdir'
}]

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  manager.dispose()
  await helper.shutdown()
})

afterEach(async () => {
  listItems = []
  disposeAll(disposables)
  manager.reset()
  await helper.reset()
})

describe('formatting', () => {
  it('should format path', () => {
    expect(formatPath('short', 'home')).toMatch('home')
    expect(formatPath('hidden', 'path')).toBe('')
    expect(formatPath('full', __filename)).toMatch('sources.test.ts')
    expect(formatPath('short', __filename)).toMatch('sources.test.ts')
    expect(formatPath('filename', __filename)).toMatch('sources.test.ts')
  })

  it('should format uri', () => {
    let cwd = process.cwd()
    expect(formatUri('http://www.example.com', cwd)).toMatch('http')
    expect(formatUri(URI.file(__filename).toString(), cwd)).toMatch('sources')
    expect(formatUri(URI.file(os.tmpdir()).toString(), cwd)).toMatch(os.tmpdir())
  })

  it('should fixWidth', () => {
    expect(fixWidth('a'.repeat(10), 2)).toBe('a.')
  })

  it('should sort symbols', () => {
    const assert = (a, b, n) => {
      expect(sortSymbolItems(a, b)).toBe(n)
    }
    assert({ data: { score: 1 } }, { data: { score: 2 } }, 1)
    assert({ data: { kind: 1 } }, { data: { kind: 2 } }, -1)
    assert({ data: { file: 'aa' } }, { data: { file: 'b' } }, 1)
  })

  it('should format list items', () => {
    expect(formatListItems(false, [])).toEqual([])
    let items: UnformattedListItem[] = [{
      label: ['a', 'b', 'c']
    }]
    expect(formatListItems(false, items)).toEqual([{
      label: 'a\tb\tc'
    }])
    items = [{
      label: ['a', 'b', 'c']
    }, {
      label: ['foo', 'bar', 'go']
    }]
    expect(formatListItems(true, items)).toEqual([{
      label: 'a  \tb  \tc '
    }, {
      label: 'foo\tbar\tgo'
    }])
  })
})

describe('Extensions util', () => {
  it('should sortExtensionItem', () => {
    expect(sortExtensionItem({ data: { priority: 1 } }, { data: { priority: 0 } })).toBe(-1)
    expect(sortExtensionItem({ data: { id: 'a' } }, { data: { id: 'b' } })).toBe(1)
    expect(sortExtensionItem({ data: { id: 'b' } }, { data: { id: 'a' } })).toBe(-1)
  })

  it('should get extension prefix', () => {
    expect(getExtensionPrefix('')).toBe('+')
    expect(getExtensionPrefix('disabled')).toBe('-')
    expect(getExtensionPrefix('activated')).toBe('*')
    expect(getExtensionPrefix('unknown')).toBe('?')
  })

  it('should get extension priority', () => {
    expect(getExtensionPriority('')).toBe(0)
    expect(getExtensionPriority('unknown')).toBe(2)
    expect(getExtensionPriority('activated')).toBe(1)
    expect(getExtensionPriority('disabled')).toBe(-1)
  })
})

describe('Outline util', () => {
  it('should getFilterText', () => {
    expect(getFilterText(DocumentSymbol.create('name', '', SymbolKind.Function, Range.create(0, 0, 0, 1), Range.create(0, 0, 0, 1)), 'kind')).toBe('name')
    expect(getFilterText(DocumentSymbol.create('name', '', SymbolKind.Function, Range.create(0, 0, 0, 1), Range.create(0, 0, 0, 1)), '')).toBe('nameFunction')
  })

  it('should load items by ctags', async () => {
    let doc = await workspace.document
    let spy = jest.spyOn(which, 'sync').mockImplementation(() => {
      return ''
    })
    let items = await loadCtagsSymbols(doc, nvim, CancellationToken.None)
    expect(items).toEqual([])
    spy.mockRestore()
    doc = await helper.createDocument(__filename)
    items = await loadCtagsSymbols(doc, nvim, CancellationToken.None)
    expect(Array.isArray(items)).toBe(true)
  })

  it('should convert symbols to list items', async () => {
    let symbols: DocumentSymbol[] = []
    symbols.push(DocumentSymbol.create('function', '', SymbolKind.Function, Range.create(1, 0, 1, 1), Range.create(1, 0, 1, 1)))
    symbols.push(DocumentSymbol.create('class', '', SymbolKind.Class, Range.create(0, 0, 0, 1), Range.create(0, 0, 0, 1)))
    let items = symbolsToListItems(symbols, 'lsp:/1', 'class')
    expect(items.length).toBe(1)
    expect(items[0].data.kind).toBe('Class')
  })

  it('should convert to list items', async () => {
    let doc = await workspace.document
    expect(contentToItems('a\tb\t2\td\n\n', doc).length).toBe(1)
  })
})

describe('configuration', () => {
  beforeEach(() => {
    let list = new OptionList()
    manager.registerList(list)
  })

  it('should change default options', async () => {
    helper.updateConfiguration('list.source.option.defaultOptions', ['--normal'])
    await manager.start(['option'])
    await manager.session.ui.ready
    const mode = manager.prompt.mode
    expect(mode).toBe('normal')
  })

  it('should change default action', async () => {
    helper.updateConfiguration('list.source.option.defaultAction', 'split')
    await manager.start(['option'])
    await manager.session.ui.ready
    const action = manager.session.defaultAction
    expect(action.name).toBe('split')
    await manager.session.doAction()
    let tab = await nvim.tabpage
    let wins = await tab.windows
    expect(wins.length).toBeGreaterThan(1)
  })

  it('should change default arguments', async () => {
    helper.updateConfiguration('list.source.option.defaultArgs', ['-word'])
    await manager.start(['option'])
    await manager.session.ui.ready
    const context = manager.session.context
    expect(context.args).toEqual(['-word'])
  })
})

describe('BasicList', () => {
  describe('getFiletype()', () => {
    it('should get filetype', async () => {
      expect(toVimFiletype('latex')).toBe('tex')
      expect(toVimFiletype('foo')).toBe('foo')
    })
  })

  describe('parse arguments', () => {
    it('should parse args #1', () => {
      let list = new OptionList()
      let res = list.parseArguments(['-w'])
      expect(res).toEqual({ word: true })
    })

    it('should parse args #2', () => {
      let list = new OptionList()
      let res = list.parseArguments(['-word'])
      expect(res).toEqual({ word: true })
    })

    it('should parse args #3', () => {
      let list = new OptionList()
      let res = list.parseArguments(['-input', 'foo'])
      expect(res).toEqual({ input: 'foo' })
    })
  })

  describe('jumpTo()', () => {
    let list: OptionList
    beforeAll(() => {
      list = new OptionList()
    })

    it('should jump to uri', async () => {
      let uri = URI.file(__filename).toString()
      let ctx = await createContext({ position: 'tab' })
      await list.jumpTo(uri, null, ctx)
      let bufname = await nvim.call('bufname', ['%'])
      expect(bufname).toMatch('sources.test.ts')
    })

    it('should jump to location', async () => {
      let uri = URI.file(__filename).toString()
      let loc = Location.create(uri, Range.create(0, 0, 1, 0))
      await list.jumpTo(loc, 'edit')
      let bufname = await nvim.call('bufname', ['%'])
      expect(bufname).toMatch('sources.test.ts')
    })

    it('should jump to location with empty range', async () => {
      let uri = URI.file(__filename).toString()
      let loc = Location.create(uri, Range.create(0, 0, 0, 0))
      await list.jumpTo(loc, 'edit')
      let bufname = await nvim.call('bufname', ['%'])
      expect(bufname).toMatch('sources.test.ts')
    })
  })

  describe('convertLocation()', () => {
    let list: OptionList
    beforeAll(() => {
      list = new OptionList()
    })
    it('should convert uri', async () => {
      let uri = URI.file(__filename).toString()
      let res = await list.convertLocation(uri)
      expect(res.uri).toBe(uri)
    })

    it('should convert location with line', async () => {
      let uri = URI.file(__filename).toString()
      let res = await list.convertLocation({ uri, line: 'convertLocation()', text: 'convertLocation' })
      expect(res.uri).toBe(uri)
      res = await list.convertLocation({ uri, line: 'convertLocation()' })
      expect(res.uri).toBe(uri)
    })

    it('should convert location with custom schema', async () => {
      let uri = 'test:///foo'
      let res = await list.convertLocation({ uri, line: 'convertLocation()' })
      expect(res.uri).toBe(uri)
    })
  })

  describe('createAction()', () => {
    it('should overwrite action', async () => {
      let idx: number
      let list = new OptionList()
      listItems.push({
        label: 'foo',
        location: Location.create('untitled:///1', Range.create(0, 0, 0, 0))
      })
      list.createAction({
        name: 'foo',
        execute: () => { idx = 0 }
      })
      list.createAction({
        name: 'foo',
        execute: () => { idx = 1 }
      })
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', 'option'])
      await manager.session.ui.ready
      await manager.doAction('foo')
      expect(idx).toBe(1)
    })
  })

  describe('preview()', () => {
    beforeEach(() => {
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
    })

    async function doPreview(opts: PreviewOptions): Promise<number> {
      previewOptions = opts
      await manager.start(['--normal', 'simple'])
      await manager.session.ui.ready
      await manager.doAction('preview')
      let res = await nvim.call('coc#list#has_preview') as number
      expect(res).toBeGreaterThan(0)
      let winid = await nvim.call('win_getid', [res]) as number
      return winid
    }

    it('should preview lines', async () => {
      await doPreview({ filetype: '', lines: ['foo', 'bar'] })
    })

    it('should preview with bufname', async () => {
      await doPreview({
        bufname: 't.js',
        filetype: 'typescript',
        lines: ['foo', 'bar']
      })
    })

    it('should preview with range highlight', async () => {
      let winid = await doPreview({
        bufname: 't.js',
        filetype: 'typescript',
        lines: ['foo', 'bar'],
        range: Range.create(0, 0, 0, 3)
      })
      let res = await nvim.call('getmatches', [winid]) as any[]
      expect(res.length).toBeGreaterThan(0)
    })
  })

  describe('previewLocation()', () => {
    it('should preview sketch buffer', async () => {
      await nvim.command('new')
      await nvim.setLine('foo')
      let doc = await workspace.document
      expect(doc.uri).toMatch('untitled')
      let list = new OptionList()
      listItems.push({
        label: 'foo',
        location: Location.create(doc.uri, Range.create(0, 0, 0, 0))
      })
      disposables.push(manager.registerList(list))
      await manager.start(['option'])
      await manager.session.ui.ready
      await helper.wait(30)
      await manager.doAction('preview')
      await nvim.command('wincmd p')
      let win = await nvim.window
      let isPreview = await win.getVar('previewwindow')
      expect(isPreview).toBe(1)
      let line = await nvim.line
      expect(line).toBe('foo')
    })
  })
})

describe('list sources', () => {
  beforeEach(async () => {
    await nvim.setVar('coc_jump_locations', locations)
  })

  describe('locations', () => {
    it('should highlight ranges', async () => {
      await manager.start(['--normal', '--auto-preview', 'location'])
      await manager.session.ui.ready
      await helper.waitFor('winnr', ['$'], 3)
      manager.prompt.cancel()
      await nvim.command('wincmd k')
      let name = await nvim.eval('bufname("%")')
      expect(name).toMatch('sources.test.ts')
      let res = await nvim.call('getmatches') as any[]
      expect(res.length).toBe(1)
    })

    it('should not use filename when current buffer only', async () => {
      let filepath = path.join(os.tmpdir(), 'b7d9e548-00ec-4419-98a8-dc03874e405c')
      let doc = await helper.createDocument(filepath)
      let locations = [{
        filename: filepath,
        bufnr: doc.bufnr,
        lnum: 1,
        col: 1,
        text: 'multiple'
      }, {
        filename: filepath,
        bufnr: doc.bufnr,
        lnum: 1,
        col: 1,
        end_lnum: 2,
        end_col: 1,
        text: 'multiple'
      }]
      await nvim.setVar('coc_jump_locations', locations)
      await manager.start(['--normal', '--auto-preview', 'location'])
      await manager.session.ui.ready
    })

    it('should change highlight on cursor move', async () => {
      await manager.start(['--normal', '--auto-preview', 'location'])
      await manager.session.ui.ready
      await nvim.command('exe 2')
      let bufnr = await nvim.eval('bufnr("%")')
      await events.fire('CursorMoved', [bufnr, [2, 1]])
      await helper.waitFor('winnr', ['$'], 3)
      await nvim.command('wincmd k')
      let res = await nvim.call('getmatches') as any
      expect(res.length).toBe(1)
      expect(res[0]['pos1']).toEqual([3, 1, 6])
    })

    it('should highlight multiple line range', async () => {
      await manager.start(['--normal', '--auto-preview', 'location'])
      await manager.session.ui.ready
      await nvim.command('exe 3')
      let bufnr = await nvim.eval('bufnr("%")')
      await events.fire('CursorMoved', [bufnr, [2, 1]])
      await helper.waitFor('winnr', ['$'], 3)
      await nvim.command('wincmd k')
      let res = await nvim.call('getmatches') as any
      expect(res.length).toBe(1)
      expect(res[0]['pos1']).toBeDefined()
      expect(res[0]['pos2']).toBeDefined()
    })

    it('should do open action', async () => {
      await manager.start(['--normal', 'location'])
      await manager.session.ui.ready
      await manager.doAction('open')
      let name = await nvim.eval('bufname("%")')
      expect(name).toMatch('sources.test.ts')
    })

    it('should do quickfix action', async () => {
      await nvim.setVar('coc_quickfix_open_command', 'copen', false)
      await manager.start(['--normal', 'location'])
      await manager.session.ui.ready
      await manager.session.ui.selectAll()
      await manager.doAction('quickfix')
      let buftype = await nvim.eval('&buftype')
      expect(buftype).toBe('quickfix')
    })

    it('should do refactor action', async () => {
      await manager.start(['--normal', 'location'])
      await manager.session.ui.ready
      await manager.doAction('refactor')
      let name = await nvim.eval('bufname("%")')
      expect(name).toMatch('coc_refactor')
    })

    it('should do tabe action', async () => {
      await manager.start(['--normal', 'location'])
      await manager.session.ui.ready
      await manager.doAction('tabe')
      let tabs = await nvim.tabpages
      expect(tabs.length).toBe(2)
    })

    it('should do drop action', async () => {
      await manager.start(['--normal', 'location'])
      await manager.session.ui.ready
      await manager.doAction('drop')
      let name = await nvim.eval('bufname("%")')
      expect(name).toMatch('sources.test.ts')
    })

    it('should do vsplit action', async () => {
      await manager.start(['--normal', 'location'])
      await manager.session.ui.ready
      await manager.doAction('vsplit')
      let name = await nvim.eval('bufname("%")')
      expect(name).toMatch('sources.test.ts')
    })

    it('should do split action', async () => {
      await manager.start(['--normal', 'location'])
      await manager.session.ui.ready
      await manager.doAction('split')
      let name = await nvim.eval('bufname("%")')
      expect(name).toMatch('sources.test.ts')
    })
  })

  describe('commands', () => {
    it('should do run action', async () => {
      await manager.start(['commands'])
      await manager.session?.ui.ready
      await manager.doAction()
    })

    it('should load commands source', async () => {
      let registry = Registry.as<extension.IExtensionRegistry>(extension.Extensions.ExtensionContribution)
      registry.registerExtension('single', {
        name: 'single',
        directory: os.tmpdir(),
        onCommands: ['cmd', 'cmd'],
        commands: [{ command: 'cmd', title: 'title' }]
      })
      await manager.start(['commands'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
      await manager.doAction('append')
      let line = await helper.getCmdline()
      expect(line).toMatch(':CocCommand')
      registry.unregistExtension('single')
    })
  })

  describe('diagnostics', () => {

    function createDiagnostic(msg: string, range?: Range, severity?: DiagnosticSeverity, code?: number): Diagnostic {
      range = range ? range : Range.create(0, 0, 0, 1)
      return Diagnostic.create(range, msg, severity || DiagnosticSeverity.Error, code)
    }

    async function createDocument(name?: string): Promise<Document> {
      let doc = await helper.createDocument(name)
      let collection = diagnosticManager.create('test')
      disposables.push({
        dispose: () => {
          collection.clear()
          collection.dispose()
        }
      })
      let diagnostics: Diagnostic[] = []
      await doc.buffer.setLines(['foo bar foo bar', 'foo bar', 'foo', 'bar'], {
        start: 0,
        end: -1,
        strictIndexing: false
      })
      diagnostics.push(createDiagnostic('error', Range.create(0, 2, 0, 4), DiagnosticSeverity.Error, 1001))
      diagnostics.push(createDiagnostic('warning', Range.create(0, 5, 0, 6), DiagnosticSeverity.Warning, 1002))
      diagnostics.push(createDiagnostic('information', Range.create(1, 0, 1, 1), DiagnosticSeverity.Information, 1003))
      diagnostics.push(createDiagnostic('hint', Range.create(1, 2, 1, 3), DiagnosticSeverity.Hint, 1004))
      diagnostics.push(createDiagnostic('error', Range.create(2, 0, 2, 2), DiagnosticSeverity.Error, 1005))
      collection.set(doc.uri, diagnostics)
      await doc.synchronize()
      return doc
    }

    it('should get label', async () => {
      let item: DiagnosticItem = {
        code: 1000,
        col: 0,
        end_col: 1,
        end_lnum: 1,
        file: os.tmpdir(),
        level: 0,
        lnum: 1,
        location: Location.create('file:///1', Range.create(0, 0, 0, 1)),
        message: 'message',
        severity: 'error',
        source: 'source'
      }
      expect(convertToLabel(item, process.cwd(), false).indexOf('1000')).toBe(-1)
      expect(convertToLabel(item, process.cwd(), true, 'hidden').includes('[source 1000]')).toBe(true)
    })

    it('should load diagnostics source', async () => {
      await createDocument('a')
      await manager.start(['diagnostics'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
    })

    it('should refresh on diagnostics refresh', async () => {
      let doc = await createDocument('bar')
      await manager.start(['diagnostics'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
      let diagnostics: Diagnostic[] = []
      let collection = diagnosticManager.create('test')
      diagnostics.push(createDiagnostic('error', Range.create(2, 0, 2, 2), DiagnosticSeverity.Error, 1009))
      collection.set(doc.uri, diagnostics)
      await helper.wait(50)
      let buf = await nvim.buffer
      let lines = await buf.lines
      expect(lines.length).toBeGreaterThan(0)
    })
  })

  describe('extensions', () => {
    it('should load extensions source', async () => {
      let folder = path.join(os.tmpdir(), uuid())
      fs.mkdirSync(path.join(folder, 'foo'), { recursive: true })
      fs.mkdirSync(path.join(folder, 'bar'), { recursive: true })
      let infos: ExtensionInfo[] = []
      infos.push({
        id: 'foo',
        version: '1.0.0',
        description: 'foo',
        root: path.join(folder, 'foo'),
        exotic: false,
        state: 'activated',
        isLocal: false,
        isLocked: true,
        packageJSON: { name: 'foo', engines: {} }
      })
      infos.push({
        id: 'bar',
        version: '1.0.0',
        description: 'bar',
        root: path.join(folder, 'bar'),
        exotic: false,
        state: 'activated',
        isLocal: true,
        isLocked: false,
        packageJSON: { name: 'bar', engines: {} }
      })
      let spy = jest.spyOn(extensions, 'getExtensionStates').mockImplementation(() => {
        return Promise.resolve(infos)
      })
      const doAction = async (name: string, item: any) => {
        let action = source.actions.find(o => o.name == name)
        await action.execute(item)
      }
      let states = new ExtensionStat(folder)
      let manager = new ExtensionManager(states, folder)
      let source = new ExtensionList(manager)
      let items = await source.loadItems()
      expect(items.length).toBe(2)
      items[0].data.state = 'disabled'
      await doAction('toggle', items[0])
      await doAction('toggle', items[1])
      items[1].data.state = 'loaded'
      await expect(async () => {
        await doAction('toggle', items[1])
      }).rejects.toThrow(Error)
      await doAction('configuration', items[0])
      let jsonfile = path.join(folder, 'bar/package.json')
      fs.writeFileSync(jsonfile, '{}', 'utf8')
      await doAction('configuration', items[1])
      fs.writeFileSync(jsonfile, '{"contributes": {}}', 'utf8')
      await doAction('configuration', items[1])
      await helper.mockFunction('coc#ui#open_url', 0)
      await doAction('open', items[1])
      await doAction('disable', items[0])
      await doAction('disable', items[1])
      await doAction('enable', items[0])
      await doAction('enable', items[1])
      await doAction('lock', items[0])
      await expect(async () => {
        await doAction('reload', items[0])
      }).rejects.toThrow(Error)
      await doAction('uninstall', items)
      await doAction('help', items[0])
      let helpfile = path.join(folder, 'bar/readme.md')
      fs.writeFileSync(helpfile, '', 'utf8')
      await doAction('help', items[1])
      let bufname = await nvim.eval('bufname("%")')
      expect(bufname).toMatch('readme')
      source.doHighlight()
      spy.mockRestore()
    })
  })

  describe('folders', () => {
    it('should load folders source', async () => {
      await helper.createDocument(__filename)
      let uid = uuid()
      let source = new FolderList()
      const doAction = async (name: string, item: any) => {
        let action = source.actions.find(o => o.name == name)
        await action.execute(item)
      }
      let res = await source.loadItems()
      expect(res.length).toBe(1)
      await doAction('delete', res[0])
      expect(workspace.folderPaths.length).toBe(0)
      let p = doAction('edit', res[0])
      await helper.waitFor('mode', [], 'c')
      await nvim.input('<cr>')
      await p
      p = doAction('edit', res[0])
      await helper.waitFor('mode', [], 'c')
      await nvim.input('<C-u>')
      await nvim.input('<cr>')
      await p
      p = doAction('newfile', res[0])
      await helper.waitFloat()
      await helper.wait(30)
      await nvim.input('<C-u>')
      await nvim.input('<cr>')
      await p
      fs.rmSync(path.join(os.tmpdir(), uid), { recursive: true, force: true })
      let filepath = path.join(os.tmpdir(), uid, 'bar')
      let spy = jest.spyOn(window, 'requestInput').mockImplementation(() => {
        return Promise.resolve(filepath)
      })
      await doAction('newfile', res[0])
      let exists = fs.existsSync(filepath)
      expect(exists).toBe(true)
      spy.mockRestore()
      workspace.reset()
    })
  })

  describe('lists', () => {
    it('should get list score', () => {
      expect(mruScore(['foo'], 'foo')).toBe(1)
      expect(mruScore([], 'foo')).toBe(-1)
    })

    it('should load lists source', async () => {
      await manager.start(['lists'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
      await manager.doAction()
      await helper.waitValue(() => {
        let s = manager.getSession()
        return s && s.name !== 'lists'
      }, true)
    })
  })

  describe('outline', () => {
    it('should load items from provider', async () => {
      let doc = await workspace.document
      disposables.push(languages.registerDocumentSymbolProvider([{ language: '*' }], {
        provideDocumentSymbols: document => {
          let text = document.getText()
          let parser = new Parser(text, text.includes('detail'))
          let res = parser.parse()
          return Promise.resolve(res)
        }
      }))
      let source = new OutlineList()
      let context = await createContext({})
      let res = await source.loadItems(context, CancellationToken.None)
      expect(res).toEqual([])
      let code = `class myClass {
      fun1() {
      }
    }`
      await doc.applyEdits([TextEdit.insert(Position.create(0, 0), code)])
      res = await source.loadItems(context, CancellationToken.None)
      expect(res.length).toBe(2)
      source.doHighlight()
    })

    it('should load items by ctags', async () => {
      helper.updateConfiguration('list.source.outline.ctagsFiletypes', ['vim'])
      await nvim.command('edit +setl\\ filetype=vim foo')
      let doc = await workspace.document
      expect(doc.filetype).toBe('vim')
      let source = new OutlineList()
      let context = await createContext({})
      context.args = ['-kind', 'function', '-name', 'name']
      let res = await source.loadItems(context, CancellationToken.None)
      expect(res).toEqual([])
      res = await source.loadItems(context, CancellationToken.Cancelled)
      expect(res).toEqual([])
    })
  })

  describe('services', () => {
    function createService(name: string): IServiceProvider {
      let _onServiceReady = new Emitter<void>()
      // public readonly onServiceReady: Event<void> = this.
      let service: IServiceProvider = {
        id: name,
        name,
        selector: [{ language: 'vim' }],
        state: ServiceStat.Initial,
        start(): Promise<void> {
          service.state = ServiceStat.Running
          _onServiceReady.fire()
          return Promise.resolve()
        },
        dispose(): void {
          service.state = ServiceStat.Stopped
        },
        stop(): void {
          service.state = ServiceStat.Stopped
        },
        restart(): void {
          service.state = ServiceStat.Running
          _onServiceReady.fire()
        },
        onServiceReady: _onServiceReady.event
      }
      disposables.push(services.register(service))
      return service
    }

    it('should load services source', async () => {
      createService('foo')
      createService('bar')
      await manager.start(['services'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
      let lines = await nvim.call('getline', [1, '$']) as string[]
      expect(lines.length).toBe(2)
    })

    it('should toggle service state', async () => {
      let service = createService('foo')
      await service.start()
      await manager.start(['services'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
      let ses = manager.session
      expect(ses.name).toBe('services')
      await ses.doAction('toggle')
      expect(service.state).toBe(ServiceStat.Stopped)
      await ses.doAction('toggle')
    })
  })

  describe('sources', () => {
    it('should load sources source', async () => {
      await manager.start(['sources'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
      let session = manager.getSession()
      await session.doAction('open')
      let bufname = await nvim.call('bufname', '%')
      expect(bufname).toMatch(/native/)
    })

    it('should toggle source state', async () => {
      await manager.start(['sources'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
      let session = manager.getSession()
      await session.doAction('toggle')
      await session.doAction('toggle')
    })

    it('should refresh source', async () => {
      await manager.start(['sources'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
      let session = manager.getSession()
      await session.doAction('refresh')
    })
  })

  describe('symbols', () => {
    it('should create list item', () => {
      let source = new SymbolsList()
      let symbolItem = SymbolInformation.create('root', SymbolKind.Method, Range.create(0, 0, 0, 10), '')
      let item = source.createListItem('', symbolItem, 'kind', './foo')
      expect(item).toBeDefined()
      symbolItem.tags = [SymbolTag.Deprecated]
      item = source.createListItem('', symbolItem, 'kind', './foo')
      let highlights = item.ansiHighlights
      let find = highlights.find(o => o.hlGroup == 'CocDeprecatedHighlight')
      expect(find).toBeDefined()
      source.fuzzyMatch.setPattern('a')
      item = source.createListItem('a', symbolItem, 'kind', './foo')
      expect(item).toBeDefined()
      source.fuzzyMatch.setPattern('r')
      item = source.createListItem('r', symbolItem, 'kind', './foo')
      highlights = item.ansiHighlights
      find = highlights.find(o => o.hlGroup == 'CocListSearch')
      expect(find).toBeDefined()
    })

    it('should resolve item', async () => {
      let source = new SymbolsList()
      let res = await source.resolveItem({ label: 'label', data: {} })
      expect(res).toBeNull()
      let haveResult = false
      let disposable = languages.registerWorkspaceSymbolProvider({
        provideWorkspaceSymbols: () => [
          SymbolInformation.create('root', SymbolKind.Method, Range.create(0, 0, 0, 10), '')
        ],
        resolveWorkspaceSymbol: symbolItem => {
          symbolItem.location = Location.create('lsp:///1', Range.create(0, 0, 1, 0))
          return haveResult ? symbolItem : null
        }
      })
      disposables.push(disposable)
      let symbols = await languages.getWorkspaceSymbols('', CancellationToken.None)
      res = await source.resolveItem({ label: 'label', data: { original: symbols[0] } })
      expect(res).toBeNull()
      haveResult = true
      symbols[0].location = { uri: 'lsp:///1' }
      res = await source.resolveItem({ label: 'label', data: { original: symbols[0] } })
      expect(Location.is(res.location)).toBe(true)
      if (Location.is(res.location)) {
        expect(res.location.uri).toBe('lsp:///1')
      }
    })

    it('should load items', async () => {
      let source = new SymbolsList()
      let context = await createContext({ interactive: true })
      await expect(async () => {
        await source.loadItems(context, CancellationToken.None)
      }).rejects.toThrow(Error)
      disposables.push(languages.registerWorkspaceSymbolProvider({
        provideWorkspaceSymbols: () => [
          SymbolInformation.create('root', SymbolKind.Method, Range.create(0, 0, 0, 10), URI.file(__filename).toString())
        ]
      }))
      let res = await source.loadItems(context, CancellationToken.Cancelled)
      expect(res).toEqual([])
      context.args = ['-kind', 'function']
      res = await source.loadItems(context, CancellationToken.None)
      expect(res).toEqual([])
      context.args = []
      helper.updateConfiguration('list.source.symbols.excludes', ['**/*.ts'])
      res = await source.loadItems(context, CancellationToken.None)
      expect(res).toEqual([])
      helper.updateConfiguration('list.source.symbols.excludes', [])
      res = await source.loadItems(context, CancellationToken.None)
      expect(res.length).toBe(1)
    })

    it('should load symbols source', async () => {
      await helper.createDocument()
      disposables.push(languages.registerWorkspaceSymbolProvider({
        provideWorkspaceSymbols: () => []
      }))
      await manager.start(['--interactive', 'symbols'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('links', () => {
    it('should load links source', async () => {
      let disposable = languages.registerDocumentLinkProvider([{ scheme: 'file' }, { scheme: 'untitled' }], {
        provideDocumentLinks: () => {
          return [
            DocumentLink.create(Range.create(0, 0, 0, 5), 'file:///foo'),
            DocumentLink.create(Range.create(1, 0, 1, 5), 'file:///bar')
          ]
        }
      })
      await manager.start(['links'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
      await manager.doAction('jump')
      disposable.dispose()
    })

    it('should resolve target', async () => {
      let disposable = languages.registerDocumentLinkProvider([{ scheme: 'file' }, { scheme: 'untitled' }], {
        provideDocumentLinks: () => {
          return [
            DocumentLink.create(Range.create(0, 0, 0, 5)),
          ]
        },
        resolveDocumentLink: link => {
          link.target = 'file:///foo'
          return link
        }
      })
      await manager.start(['links'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
      await manager.doAction('open')
      disposable.dispose()
    })
  })
})
