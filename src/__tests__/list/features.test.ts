// Merged from source-funcs.test.ts, worker.test.ts, session.test.ts and
// commandTask.test.ts to share a single nvim session and reduce per-file
// startup overhead.
import { Neovim } from '@chemzqm/neovim'
import styles from 'ansi-styles'
import { EventEmitter } from 'events'
import { CancellationToken, Disposable } from 'vscode-languageserver-protocol'
import { DocumentSymbol, Location, Range, SymbolKind } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import which from 'which'
import BasicList, { toVimFiletype } from '../../list/basic'
import { fixWidth, formatListItems, formatPath, formatUri, UnformattedListItem } from '../../list/formatting'
import manager from '../../list/manager'
import Prompt from '../../list/prompt'
import ListSession from '../../list/session'
import { getExtensionPrefix, getExtensionPriority, sortExtensionItem } from '../../list/source/extensions'
import { mruScore } from '../../list/source/lists'
import { contentToItems, getFilterText, loadCtagsSymbols, symbolsToListItems } from '../../list/source/outline'
import { sortSymbolItems, toTargetLocation } from '../../list/source/symbols'
import { IList, ListContext, ListItem, ListTask } from '../../list/types'
import { convertItemLabel, indexOf, parseInput, toInputs } from '../../list/worker'
import { disposeAll } from '../../util'
import { os, path } from '../../util/node'
import workspace from '../../workspace'
import helper, { createTmpFile } from '../helper'

let items: ListItem[] = []
let labels: string[] = []
let lastItem: string
let lastItems: ListItem[]
let nvim: Neovim
let disposables: Disposable[] = []

class DataList extends BasicList {
  public name = 'data'
  public loadItems(): Promise<ListItem[]> {
    return Promise.resolve(items)
  }
}

class EmptyList extends BasicList {
  public name = 'empty'
  public loadItems(): Promise<ListItem[]> {
    let emitter: any = new EventEmitter()
    setTimeout(() => {
      emitter.emit('end')
    }, 20)
    return emitter
  }
}

class IntervalTaskList extends BasicList {
  public name = 'task'
  public timeout = 3000
  public loadItems(_context: ListContext, token: CancellationToken): Promise<ListTask> {
    let emitter: any = new EventEmitter()
    let i = 0
    let interval = setInterval(() => {
      emitter.emit('data', { label: i.toFixed() })
      i++
    }, 20)
    emitter.dispose = () => {
      clearInterval(interval)
      emitter.emit('end')
    }
    token.onCancellationRequested(() => {
      emitter.dispose()
    })
    return emitter
  }
}

class DelayTask extends BasicList {
  public name = 'delay'
  public interactive = true
  public loadItems(_context: ListContext, token: CancellationToken): Promise<ListTask> {
    let emitter: any = new EventEmitter()
    let disposed = false
    setTimeout(() => {
      if (disposed) return
      emitter.emit('data', { label: 'ahead' })
    }, 10)
    setTimeout(() => {
      if (disposed) return
      emitter.emit('data', { label: 'abort' })
    }, 20)
    emitter.dispose = () => {
      disposed = true
      emitter.emit('end')
    }
    token.onCancellationRequested(() => {
      emitter.dispose()
    })
    return emitter
  }
}

class InteractiveList extends BasicList {
  public name = 'test'
  public interactive = true
  public loadItems(context: ListContext, _token: CancellationToken): Promise<ListItem[]> {
    return Promise.resolve([{
      label: styles.magenta.open + (context.input || '') + styles.magenta.close
    }])
  }
}

class ErrorList extends BasicList {
  public name = 'error'
  public interactive = true
  public loadItems(_context: ListContext, _token: CancellationToken): Promise<ListItem[]> {
    return Promise.reject(new Error('test error'))
  }
}

class ErrorTaskList extends BasicList {
  public name = 'task'
  public loadItems(_context: ListContext, _token: CancellationToken): Promise<ListTask> {
    let emitter: any = new EventEmitter()
    let timeout = setTimeout(() => {
      emitter.emit('error', new Error('task error'))
    }, 100)
    emitter.dispose = () => {
      clearTimeout(timeout)
    }
    return emitter
  }
}

class SimpleList extends BasicList {
  public name = 'simple'
  public detail = 'detail'
  public options = [{
    name: 'foo',
    description: 'foo'
  }]
  constructor() {
    super()
    this.addAction('open', item => {
      lastItem = item.label
    }, { tabPersist: true })
    this.addMultipleAction('multiple', items => {
      lastItems = items
    })
    this.addAction('parallel', async () => {
      await helper.wait(100)
    }, { parallel: true })
    this.addAction('reload', item => {
      lastItem = item.label
    }, { persist: true, reload: true })
  }
  public loadItems(): Promise<ListItem[]> {
    return Promise.resolve(labels.map(s => {
      return { label: s } as ListItem
    }))
  }
}

class CommandDataList extends BasicList {
  public name = 'data'
  public async loadItems(_context: ListContext): Promise<ListTask> {
    let fsPath = await createTmpFile(`console.log('foo');console.log('');console.log('bar');`)
    return this.createCommandTask({
      cmd: 'node',
      args: [fsPath],
      cwd: path.dirname(fsPath),
      onLine: line => {
        if (!line) return undefined
        return {
          label: line
        }
      }
    })
  }
}

class SleepList extends BasicList {
  public name = 'sleep'
  public loadItems(_context: ListContext): Promise<ListTask> {
    return Promise.resolve(this.createCommandTask({
      cmd: 'sleep',
      args: ['10'],
      onLine: line => {
        return {
          label: line
        }
      }
    }))
  }
}

class StderrList extends BasicList {
  public name = 'stderr'
  public async loadItems(_context: ListContext): Promise<ListTask> {
    let fsPath = await createTmpFile(`console.error('stderr');console.log('stdout')`)
    return Promise.resolve(this.createCommandTask({
      cmd: 'node',
      args: [fsPath],
      cwd: path.dirname(fsPath),
      onLine: line => {
        return {
          label: line
        }
      }
    }))
  }
}

class ErrorTask extends BasicList {
  public name = 'error'
  public async loadItems(_context: ListContext): Promise<ListTask> {
    return Promise.resolve(this.createCommandTask({
      cmd: 'NOT_EXISTS',
      args: [],
      cwd: __dirname,
      onLine: line => {
        return {
          label: line
        }
      }
    }))
  }
}

class FuncsSimpleList extends BasicList {
  public name = 'simple'
  public declare defaultAction: 'preview'
  constructor() {
    super()
  }
  public loadItems(): Promise<ListItem[]> {
    return Promise.resolve([])
  }
}

beforeAll(async () => {
  await helper.setup()
  nvim = helper.nvim
})

afterAll(async () => {
  await helper.shutdown()
})

afterEach(async () => {
  disposeAll(disposables)
  manager.reset()
  await helper.reset()
})

describe('List util', () => {
  it('should get list score', () => {
    assert.strictEqual(mruScore(['foo'], 'foo'), 1)
    assert.strictEqual(mruScore([], 'foo'), -1)
  })
})

describe('BasicList util', () => {
  let list: FuncsSimpleList
  beforeAll(() => {
    list = new FuncsSimpleList()
  })

  it('should get filetype', async () => {
    assert.strictEqual(toVimFiletype('latex'), 'tex')
    assert.strictEqual(toVimFiletype('foo'), 'foo')
  })

  it('should convert uri', async () => {
    let uri = URI.file(__filename).toString()
    let res = await list.convertLocation(uri)
    assert.strictEqual(res.uri, uri)
  })

  it('should convert location with line', async () => {
    let uri = URI.file(__filename).toString()
    let res = await list.convertLocation({ uri, line: 'convertLocation()', text: 'convertLocation' })
    assert.strictEqual(res.uri, uri)
    res = await list.convertLocation({ uri, line: 'convertLocation()' })
    assert.strictEqual(res.uri, uri)
  })

  it('should convert location with custom schema', async () => {
    let uri = 'test:///foo'
    let res = await list.convertLocation({ uri, line: 'convertLocation()' })
    assert.strictEqual(res.uri, uri)
  })
})

describe('Outline util', () => {
  it('should getFilterText', () => {
    assert.strictEqual(getFilterText(DocumentSymbol.create('name', '', SymbolKind.Function, Range.create(0, 0, 0, 1), Range.create(0, 0, 0, 1)), 'kind'), 'name')
    assert.strictEqual(getFilterText(DocumentSymbol.create('name', '', SymbolKind.Function, Range.create(0, 0, 0, 1), Range.create(0, 0, 0, 1)), ''), 'nameFunction')
  })

  it('should load items by ctags', async (t) => {
    let doc = await workspace.document
    let spy = t.mock.method(which, 'sync', () => {
      return ''
    })
    let items = await loadCtagsSymbols(doc, nvim, CancellationToken.None)
    assert.deepStrictEqual(items, [])
    spy.mock.restore()
    doc = await helper.createDocument(__filename)
    items = await loadCtagsSymbols(doc, nvim, CancellationToken.None)
    assert.strictEqual(Array.isArray(items), true)
  })

  it('should convert symbols to list items', async () => {
    let symbols: DocumentSymbol[] = []
    symbols.push(DocumentSymbol.create('function', '', SymbolKind.Function, Range.create(1, 0, 1, 1), Range.create(1, 0, 1, 1)))
    symbols.push(DocumentSymbol.create('class', '', SymbolKind.Class, Range.create(0, 0, 0, 1), Range.create(0, 0, 0, 1)))
    let items = symbolsToListItems(symbols, 'lsp:/1', 'class')
    assert.strictEqual(items.length, 1)
    assert.strictEqual(items[0].data.kind, 'Class')
  })

  it('should convert to list items', async () => {
    let doc = await workspace.document
    assert.strictEqual(contentToItems('a\tb\t2\td\n\n', doc).length, 1)
  })
})

describe('Extensions util', () => {
  it('should sortExtensionItem', () => {
    assert.strictEqual(sortExtensionItem({ data: { priority: 1 } }, { data: { priority: 0 } }), -1)
    assert.strictEqual(sortExtensionItem({ data: { id: 'a' } }, { data: { id: 'b' } }), 1)
    assert.strictEqual(sortExtensionItem({ data: { id: 'b' } }, { data: { id: 'a' } }), -1)
  })

  it('should get extension prefix', () => {
    assert.strictEqual(getExtensionPrefix(''), '+')
    assert.strictEqual(getExtensionPrefix('disabled'), '-')
    assert.strictEqual(getExtensionPrefix('activated'), '*')
    assert.strictEqual(getExtensionPrefix('unknown'), '?')
  })

  it('should get extension priority', () => {
    assert.strictEqual(getExtensionPriority(''), 0)
    assert.strictEqual(getExtensionPriority('unknown'), 2)
    assert.strictEqual(getExtensionPriority('activated'), 1)
    assert.strictEqual(getExtensionPriority('disabled'), -1)
  })
})

describe('Symbols util', () => {
  it('should convert to location', () => {
    let res = toTargetLocation({ uri: 'untitled:1' })
    assert.strictEqual(Location.is(res), true)
  })
})

describe('formatting', () => {
  it('should format path', () => {
    let base = path.basename(__filename)
    assert.ok((formatPath('short', 'home')).includes('home'))
    assert.strictEqual(formatPath('hidden', 'path'), '')
    assert.ok((formatPath('full', __filename)).includes(base))
    assert.ok((formatPath('short', __filename)).includes(base))
    assert.ok((formatPath('filename', __filename)).includes(base))
  })

  it('should format uri', () => {
    let cwd = process.cwd()
    assert.ok((formatUri('http://www.example.com', cwd)).includes('http'))
    assert.ok((formatUri(URI.file(__filename).toString(), cwd)).includes('list'))
    assert.ok((formatUri(URI.file(os.tmpdir()).toString(), cwd)).includes(os.tmpdir()))
  })

  it('should fixWidth', () => {
    assert.strictEqual(fixWidth('a'.repeat(10), 2), 'a.')
  })

  it('should sort symbols', () => {
    const compare = (a, b, n) => {
      assert.strictEqual(sortSymbolItems(a, b), n)
    }
    compare({ data: { score: 1 } }, { data: { score: 2 } }, 1)
    compare({ data: { kind: 1 } }, { data: { kind: 2 } }, -1)
    compare({ data: { file: 'aa' } }, { data: { file: 'b' } }, 1)
  })

  it('should format list items', () => {
    assert.deepStrictEqual(formatListItems(false, []), [])
    let items: UnformattedListItem[] = [{
      label: ['a', 'b', 'c']
    }]
    assert.deepStrictEqual(formatListItems(false, items), [{
      label: 'a\tb\tc'
    }])
    items = [{
      label: ['a', 'b', 'c']
    }, {
      label: ['foo', 'bar', 'go']
    }]
    assert.deepStrictEqual(formatListItems(true, items), [{
      label: 'a  \tb  \tc '
    }, {
      label: 'foo\tbar\tgo'
    }])

    // items with different column counts (e.g. local vs non-local extensions)
    items = [{
      label: ['* foo', '[RTP]', '1.0.0', '/tmp/foo']
    }, {
      label: ['+ bar', '2.0.0', '/tmp/bar']
    }]
    let result = formatListItems(true, items)
    assert.deepStrictEqual(result[0].label.split('\t'), ['* foo', '[RTP]', '1.0.0   ', '/tmp/foo'])
    assert.deepStrictEqual(result[1].label.split('\t'), ['+ bar', '2.0.0', '/tmp/bar'])
  })
})

describe('util', () => {
  it('should get index', () => {
    assert.strictEqual(indexOf('Abc', 'a', true, false), 0)
    assert.strictEqual(indexOf('Abc', 'A', false, false), 0)
    assert.strictEqual(indexOf('abc', 'A', false, true), 0)
  })

  it('should parse input with space', () => {
    let res = parseInput('a b')
    assert.deepStrictEqual(res, ['a', 'b'])
    res = parseInput('a b ')
    assert.deepStrictEqual(res, ['a', 'b'])
    res = parseInput('ab ')
    assert.deepStrictEqual(res, ['ab'])
  })

  it('should parse input with escaped space', () => {
    let res = parseInput('a\\ b')
    assert.deepStrictEqual(res, ['a b'])
  })

  it('should convert item label', () => {
    assert.strictEqual(convertItemLabel({ label: 'foo\nbar\nx' }).label, 'foo')
    const redOpen = '\x1B[31m'
    const redClose = '\x1B[39m'
    let label = redOpen + 'foo' + redClose
    assert.strictEqual(convertItemLabel({ label }).label, 'foo')
  })

  it('should convert input', () => {
    assert.deepStrictEqual(toInputs('foo bar', false), ['foo bar'])
  })
})

describe('list worker', () => {

  it('should work with long running task', async () => {
    disposables.push(manager.registerList(new IntervalTaskList()))
    await manager.start(['task'])
    await manager.session.worker.drawItems()
    await manager.session.ui.ready
    await helper.waitValue(() => {
      return manager.session?.length > 2
    }, true)
    await manager.cancel()
  })

  it('should sort by sortText', async () => {
    items = [{
      label: 'abc',
      sortText: 'b'
    }, {
      label: 'ade',
      sortText: 'a'
    }]
    disposables.push(manager.registerList(new DataList()))
    await manager.start(['data'])
    await manager.session.ui.ready
    await helper.listInput('a')
    await helper.waitFor('getline', ['.'], 'ade')
    await manager.cancel()
  })

  it('should ready with undefined result', async () => {
    items = undefined
    disposables.push(manager.registerList(new DataList()))
    await manager.start(['data'])
    await manager.session.ui.ready
    await manager.cancel()
  })

  it('should show empty line for empty task', async () => {
    disposables.push(manager.registerList(new EmptyList()))
    await manager.start(['empty'])
    await manager.session.ui.ready
    let line = await nvim.call('getline', [1])
    assert.ok(typeof line === 'string' && line.includes('No results'))
    await manager.cancel()
  })

  it('should cancel task by use CancellationToken', async () => {
    disposables.push(manager.registerList(new IntervalTaskList()))
    await manager.start(['task'])
    assert.strictEqual(manager.session?.worker.isLoading, true)
    await helper.listInput('1')
    await helper.wait(50)
    manager.session?.stop()
    assert.strictEqual(manager.session?.worker.isLoading, false)
  })

  it('should render slow interactive list', async () => {
    disposables.push(manager.registerList(new DelayTask()))
    await manager.start(['delay'])
    await helper.listInput('a')
    await helper.waitFor('getline', [2], 'abort')
  })

  it('should work with interactive list', async () => {
    disposables.push(manager.registerList(new InteractiveList()))
    await manager.start(['-I', 'test'])
    await manager.session?.ui.ready
    assert.strictEqual(manager.isActivated, true)
    await helper.listInput('f')
    await helper.listInput('a')
    await helper.listInput('x')
    await helper.waitFor('getline', ['.'], 'fax')
    await manager.cancel(true)
  })

  it('should not activate on load error', async () => {
    disposables.push(manager.registerList(new ErrorList()))
    await manager.start(['test'])
    assert.strictEqual(manager.isActivated, false)
  })

  it('should deactivate on task error', async () => {
    disposables.push(manager.registerList(new ErrorTaskList()))
    await manager.start(['task'])
    await helper.waitValue(() => {
      return manager.isActivated
    }, false)
  })
})

describe('list session', () => {
  describe('doDefaultAction()', () => {
    it('should throw error when default action does not exist', async () => {
      labels = ['a', 'b', 'c']
      let list = new SimpleList()
      list.defaultAction = 'foo'
      let len = list.actions.length
      list.actions.splice(0, len)
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      let err
      try {
        await manager.session.first()
      } catch (e) {
        err = e
      }
      assert.notStrictEqual(err, undefined)
      err = null
      try {
        await manager.session.last()
      } catch (e) {
        err = e
      }
      assert.notStrictEqual(err, undefined)
    })
  })

  describe('doItemAction()', () => {
    it('should invoke multiple action', async () => {
      labels = ['a', 'b', 'c']
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      await ui.selectAll()
      await manager.doAction('multiple')
      assert.strictEqual(lastItems.length, 3)
      lastItems = undefined
      await manager.session.doPreview(0)
      await manager.doAction('not_exists')
      let line = await helper.getCmdline()
      assert.ok((line).includes('not found'))
    })

    it('should invoke parallel action', async () => {
      labels = ['a', 'b', 'c']
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      await ui.selectAll()
      let d = Date.now()
      await manager.doAction('parallel')
      assert.ok((Date.now() - d) < (300))
    })

    it('should support tabPersist action', async () => {
      labels = ['a', 'b', 'c']
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', '--tab', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      await manager.doAction('open')
      let tabnr = await nvim.call('tabpagenr')
      assert.ok((tabnr as number) > 1)
      let win = nvim.createWindow(ui.winid)
      let valid = await win.valid
      assert.strictEqual(valid, true)
    })

    it('should invoke reload action', async () => {
      labels = ['a', 'b', 'c']
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      labels = ['d', 'e']
      await manager.doAction('reload')
      let buf = await nvim.buffer
      await helper.waitValue(async () => (await buf.lines).join('\n'), 'd\ne')
      let lines = await buf.lines
      assert.deepStrictEqual(lines, ['d', 'e'])
    })
  })

  describe('reloadItems()', () => {
    it('should not reload items when window is hidden', async (t) => {
      let fn = t.mock.fn()
      let list: IList = {
        name: 'reload',
        defaultAction: 'open',
        actions: [{
          name: 'open',
          execute: () => {}
        }],
        loadItems: () => {
          fn()
          return Promise.resolve([])
        }
      }
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', 'reload'])
      let ui = manager.session.ui
      await ui.ready
      await manager.cancel(true)
      let ses = manager.getSession('reload')
      await ses.reloadItems()
      assert.strictEqual((fn).mock.callCount(), 1)
    })
  })

  describe('resume()', () => {
    it('should do preview on resume', async () => {
      labels = ['a', 'b', 'c']
      let lastItem
      let list = new SimpleList()
      list.actions.push({
        name: 'preview',
        execute: item => {
          lastItem = item
        }
      })
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', '--auto-preview', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      await ui.selectLines(1, 2)
      await helper.wait(50)
      await nvim.call('coc#window#close', [ui.winid])
      await helper.wait(100)
      await manager.session.resume()
      await helper.waitValue(() => lastItem != null, true)
      assert.notStrictEqual(lastItem, undefined)
    })
  })

  describe('jumpBack()', () => {
    it('should jump back', async () => {
      let win = await nvim.window
      labels = ['a', 'b', 'c']
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      manager.session.jumpBack()
      await helper.waitValue(() => nvim.call('win_getid'), win.id)
      let winid = await nvim.call('win_getid')
      assert.strictEqual(winid, win.id)
    })
  })

  describe('hide()', () => {
    it('should not throw when window undefined', async () => {
      let session = new ListSession(nvim, new Prompt(nvim), new SimpleList(), {
        reverse: true,
        numberSelect: true,
        autoPreview: true,
        first: false,
        input: 'test',
        interactive: false,
        matcher: 'strict',
        ignorecase: true,
        position: 'top',
        mode: 'normal',
        noQuit: false,
        sort: false
      }, [])
      await assert.rejects(session.call('fn_not_exists'), Error)
      await session.doPreview(0)
      await session.first()
      await session.hide(false, true)
      let worker: any = session.worker
      worker._onDidChangeItems.fire({ items: [] })
      worker._onDidChangeLoading.fire(false)
    })
  })

  describe('doNumberSelect()', () => {
    async function create(len: number): Promise<ListSession> {
      labels = []
      for (let i = 0; i < len; i++) {
        let code = 'a'.charCodeAt(0) + i
        labels.push(String.fromCharCode(code))
      }
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', '--number-select', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      return manager.session
    }

    it('should return false for invalid number', async () => {
      let session = await create(5)
      let res = await session.doNumberSelect('a')
      assert.strictEqual(res, false)
      res = await session.doNumberSelect('8')
      assert.strictEqual(res, false)
    })

    it('should consider 0 as 10', async () => {
      let session = await create(15)
      let res = await session.doNumberSelect('0')
      assert.strictEqual(res, true)
      assert.strictEqual(lastItem, 'j')
    })
  })
})

describe('showHelp()', () => {
  it('should show description and options in help', async () => {
    labels = ['a', 'b', 'c']
    let list = new SimpleList()
    disposables.push(manager.registerList(list))
    await manager.start(['--normal', 'simple'])
    let ui = manager.session.ui
    await ui.ready
    await manager.session.showHelp()
    let lines = await nvim.call('getline', [1, '$']) as string[]
    assert.ok((lines.indexOf('DESCRIPTION')) > (0))
    assert.ok((lines.indexOf('ARGUMENTS')) > (0))
  })
})

describe('chooseAction()', () => {
  it('should filter actions not have shortcuts', async (t) => {
    labels = ['a', 'b', 'c']
    let fn = t.mock.fn()
    let list = new SimpleList()
    list.actions.push({
      name: 'a',
      execute: () => {
        fn()
      }
    })
    list.actions.push({
      name: 'b',
      execute: () => {
      }
    })
    list.actions.push({
      name: 'ab',
      execute: () => {
      }
    })
    disposables.push(manager.registerList(list))
    await manager.start(['--normal', 'simple'])
    await manager.session.ui.ready
    let p = manager.session.chooseAction()
    await helper.wait(50)
    await nvim.input('a')
    await p
    assert.ok((fn).mock.callCount() > 0)
  })

  it('should choose action by menu picker', async (t) => {
    helper.updateConfiguration('list.menuAction', true)
    labels = ['a', 'b', 'c']
    let fn = t.mock.fn()
    let list = new SimpleList()
    let len = list.actions.length
    list.actions.splice(0, len)
    list.actions.push({
      name: 'a',
      execute: () => {
        fn()
      }
    })
    list.actions.push({
      name: 'b',
      execute: () => {
        fn()
      }
    })
    disposables.push(manager.registerList(list))
    await manager.start(['--normal', 'simple'])
    await manager.session.ui.ready
    let p = manager.session.chooseAction()
    await helper.waitPrompt()
    await nvim.input('<cr>')
    await p
  })
})

describe('Command task', () => {
  it('should not show stderr', async () => {
    disposables.push(manager.registerList(new StderrList()))
    await manager.start(['stderr'])
    await manager.session.ui.ready
    let lines = await nvim.call('getline', [1, '$']) as string[]
    assert.deepStrictEqual(lines, ['stdout'])
  })

  it('should not show error', async () => {
    disposables.push(manager.registerList(new ErrorTask()))
    await manager.start(['error'])
    await helper.waitValue(() => manager.session?.ui.length, 0)
    await nvim.command('redraw')
    let len = manager.session.ui.length
    assert.strictEqual(len, 0)
  })

  it('should create command task', async () => {
    let list = new CommandDataList()
    disposables.push(manager.registerList(list))
    await manager.start(['data'])
    await manager.session.ui.ready
    await helper.waitValue(async () => nvim.call('getline', [1, '$']), ['foo', 'bar'])
    let lines = await nvim.call('getline', [1, '$']) as string[]
    assert.deepStrictEqual(lines, ['foo', 'bar'])
  })

  it('should stop command task', async () => {
    let list = new SleepList()
    disposables.push(manager.registerList(list))
    await manager.start(['sleep'])
    manager.session.stop()
  })
})
