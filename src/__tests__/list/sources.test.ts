import { Neovim } from '@chemzqm/neovim'
import { CancellationToken, Emitter } from 'vscode-jsonrpc'
import { Diagnostic, DiagnosticSeverity, Disposable, Location, Range } from 'vscode-languageserver-protocol'
import diagnosticManager from '../../diagnostic/manager'
import languages from '../../languages'
import BasicList from '../../list/basic'
import manager from '../../list/manager'
import Document from '../../model/document'
import services, { IServiceProvider } from '../../services'
import { ListArgument, ListContext, ListItem, ServiceStat } from '../../types'
import { disposeAll } from '../../util'
import workspace from '../../workspace'
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
  }]
  constructor(nvim) {
    super(nvim)
    this.addLocationActions()
  }
  public loadItems(_context: ListContext, _token: CancellationToken): Promise<ListItem[]> {
    return Promise.resolve(listItems)
  }
}

let disposables: Disposable[] = []
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
  disposeAll(disposables)
  manager.reset()
  await helper.reset()
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
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
    })

    it('should do run action', async () => {
      await manager.start(['commands'])
      await manager.session?.ui.ready
      await manager.doAction()
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
      doc.forceSync()
      return doc
    }

    it('should load diagnostics source', async () => {
      await createDocument('a')
      await manager.start(['diagnostics'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
    })

    it('should not include code', async () => {
      let fn = helper.updateConfiguration('list.source.diagnostics.includeCode', false)
      disposables.push({ dispose: fn })
      await createDocument('a')
      await manager.start(['diagnostics'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
      let line = await nvim.line
      expect(line.match(/100/)).toBeNull()
    })

    it('should hide file path', async () => {
      helper.updateConfiguration('list.source.diagnostics.pathFormat', 'hidden')
      await createDocument('foo')
      await manager.start(['diagnostics'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
      let line = await nvim.line
      expect(line.match(/foo/)).toBeNull()
      helper.updateConfiguration('list.source.diagnostics.pathFormat', 'full')
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
      expect(lines.length).toBe(1)
    })
  })

  describe('extensions', () => {
    it('should load extensions source', async () => {
      await manager.start(['extensions'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('folders', () => {
    it('should load folders source', async () => {
      await manager.start(['folders'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('lists', () => {
    it('should load lists source', async () => {
      await manager.start(['lists'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
      await helper.listInput('<cr>')
      let s = manager.getSession()
      expect(s.name != 'lists').toBe(true)
    })
  })

  describe('outline', () => {
    it('should load outline source', async () => {
      await manager.start(['outline'])
      await manager.session?.ui.ready
      expect(manager.isActivated).toBe(true)
    })
  })

  describe('services', () => {
    function createService(name: string): IServiceProvider {
      let _onServcieReady = new Emitter<void>()
      // public readonly onServcieReady: Event<void> = this.
      let service: IServiceProvider = {
        id: name,
        name,
        selector: [{ language: 'vim' }],
        state: ServiceStat.Initial,
        start(): Promise<void> {
          service.state = ServiceStat.Running
          _onServcieReady.fire()
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
          _onServcieReady.fire()
        },
        onServiceReady: _onServcieReady.event
      }
      disposables.push(services.regist(service))
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
    it('should load symbols source', async () => {
      let disposable = languages.registerWorkspaceSymbolProvider({
        provideWorkspaceSymbols: () => []
      })
      await manager.start(['symbols'])
      await manager.session?.ui.ready
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
      expect(manager.isActivated).toBe(true)
      disposable.dispose()
    })
  })
})
