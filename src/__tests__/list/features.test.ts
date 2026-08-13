import * as shared from '../sharedUtil'
// Merged from source-funcs.test.ts, worker.test.ts, session.test.ts and
// commandTask.test.ts to share a single nvim session and reduce per-file
// startup overhead.
import BasicList, { toVimFiletype } from '../../list/basic'
import { fixWidth, formatListItems, formatPath, formatUri, UnformattedListItem } from '../../list/formatting'
import manager from '../../list/manager'
import Prompt from '../../list/prompt'
import ListSession from '../../list/session'
import { getExtensionPrefix, getExtensionPriority, sortExtensionItem } from '../../list/source/extensions'
import { mruScore } from '../../list/source/lists'
import { contentToItems, getFilterText, loadCtagsSymbols, symbolsToListItems } from '../../list/source/outline'
import { sortSymbolItems, toTargetLocation } from '../../list/source/symbols'
import { IList, ListContext, ListItem, ListOptions, ListTask } from '../../list/types'
import Worker, { convertItemLabel, indexOf, parseInput, toInputs } from '../../list/worker'
import { disposeAll } from '../../util'
import { os, path } from '../../util/node'
import window from '../../window'
import workspace from '../../workspace'
import { Neovim } from '@chemzqm/neovim'
import styles from 'ansi-styles'
import { EventEmitter } from 'events'
import { CancellationToken, Disposable } from 'vscode-languageserver-protocol'
import { DocumentSymbol, Location, Range, SymbolKind } from 'vscode-languageserver-types'
import { URI } from 'vscode-uri'
import which from 'which'
import type ListSessionType from '../../list/session'


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
      await shared.wait(100)
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
    let fsPath = await shared.createTmpFile(`console.log('foo');console.log('');console.log('bar');`)
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
    let fsPath = await shared.createTmpFile(`console.error('stderr');console.log('stdout')`)
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
      cwd: import.meta.dirname,
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

before(async () => {
  nvim = workspace.nvim
})

afterEach(async () => {
  disposeAll(disposables)
  await manager.cancel(true)
  manager.reset()
  await nvim.command('windo setl winfixbuf&')
})

describe('List util', () => {
  it('should get list score', t => {
    assert.strictEqual(mruScore(['foo'], 'foo'), 1)
    assert.strictEqual(mruScore([], 'foo'), -1)
  })
})

describe('BasicList util', () => {
  let list: FuncsSimpleList
  before(() => {
    list = new FuncsSimpleList()
  })

  it('should get filetype', async t => {
    assert.strictEqual(toVimFiletype('latex'), 'tex')
    assert.strictEqual(toVimFiletype('foo'), 'foo')
  })

  it('should convert uri', async t => {
    let uri = URI.file(import.meta.filename).toString()
    let res = await list.convertLocation(uri)
    assert.strictEqual(res.uri, uri)
  })

  it('should convert location with line', async t => {
    let uri = URI.file(import.meta.filename).toString()
    let res = await list.convertLocation({ uri, line: 'convertLocation()', text: 'convertLocation' })
    assert.strictEqual(res.uri, uri)
    res = await list.convertLocation({ uri, line: 'convertLocation()' })
    assert.strictEqual(res.uri, uri)
  })

  it('should convert location with custom schema', async t => {
    let uri = 'test:///foo'
    let res = await list.convertLocation({ uri, line: 'convertLocation()' })
    assert.strictEqual(res.uri, uri)
  })
})

describe('Outline util', () => {
  it('should getFilterText', t => {
    assert.strictEqual(getFilterText(DocumentSymbol.create('name', '', SymbolKind.Function, Range.create(0, 0, 0, 1), Range.create(0, 0, 0, 1)), 'kind'), 'name')
    assert.strictEqual(getFilterText(DocumentSymbol.create('name', '', SymbolKind.Function, Range.create(0, 0, 0, 1), Range.create(0, 0, 0, 1)), ''), 'nameFunction')
  })

  it('should load items by ctags', async t => {
    let doc = await workspace.document
    let spy = t.mock.method(which, 'sync', (() => {
      return ''
    }) as any)
    let items = await loadCtagsSymbols(doc, nvim, CancellationToken.None)
    assert.deepStrictEqual(items, [])
    doc = await shared.createDocument(import.meta.filename)
    items = await loadCtagsSymbols(doc, nvim, CancellationToken.None)
    assert.strictEqual(Array.isArray(items), true)
  })

  it('should convert symbols to list items', async t => {
    let symbols: DocumentSymbol[] = []
    symbols.push(DocumentSymbol.create('function', '', SymbolKind.Function, Range.create(1, 0, 1, 1), Range.create(1, 0, 1, 1)))
    symbols.push(DocumentSymbol.create('class', '', SymbolKind.Class, Range.create(0, 0, 0, 1), Range.create(0, 0, 0, 1)))
    let items = symbolsToListItems(symbols, 'lsp:/1', 'class')
    assert.strictEqual(items.length, 1)
    assert.strictEqual(items[0].data.kind, 'Class')
  })

  it('should convert to list items', async t => {
    let doc = await workspace.document
    assert.strictEqual(contentToItems('a\tb\t2\td\n\n', doc).length, 1)
  })
})

describe('Extensions util', () => {
  it('should sortExtensionItem', t => {
    assert.strictEqual(sortExtensionItem({ data: { priority: 1 } }, { data: { priority: 0 } }), -1)
    assert.strictEqual(sortExtensionItem({ data: { id: 'a' } }, { data: { id: 'b' } }), 1)
    assert.strictEqual(sortExtensionItem({ data: { id: 'b' } }, { data: { id: 'a' } }), -1)
  })

  it('should get extension prefix', t => {
    assert.strictEqual(getExtensionPrefix(''), '+')
    assert.strictEqual(getExtensionPrefix('disabled'), '-')
    assert.strictEqual(getExtensionPrefix('activated'), '*')
    assert.strictEqual(getExtensionPrefix('unknown'), '?')
  })

  it('should get extension priority', t => {
    assert.strictEqual(getExtensionPriority(''), 0)
    assert.strictEqual(getExtensionPriority('unknown'), 2)
    assert.strictEqual(getExtensionPriority('activated'), 1)
    assert.strictEqual(getExtensionPriority('disabled'), -1)
  })
})

describe('Symbols util', () => {
  it('should convert to location', t => {
    let res = toTargetLocation({ uri: 'untitled:1' })
    assert.strictEqual(Location.is(res), true)
  })
})

describe('formatting', () => {
  it('should format path', t => {
    let base = path.basename(import.meta.filename)
    assert.match(formatPath('short', 'home'), new RegExp('home'))
    assert.strictEqual(formatPath('hidden', 'path'), '')
    assert.match(formatPath('full', import.meta.filename), new RegExp(base))
    assert.match(formatPath('short', import.meta.filename), new RegExp(base))
    assert.match(formatPath('filename', import.meta.filename), new RegExp(base))
  })

  it('should format uri', t => {
    let cwd = process.cwd()
    assert.match(formatUri('http://www.example.com', cwd), new RegExp('http'))
    assert.match(formatUri(URI.file(import.meta.filename).toString(), cwd), new RegExp('list'))
    assert.match(formatUri(URI.file(os.tmpdir()).toString(), cwd), new RegExp(os.tmpdir()))
  })

  it('should fixWidth', t => {
    assert.strictEqual(fixWidth('a'.repeat(10), 2), 'a.')
  })

  it('should sort symbols', t => {
    const checkSort = (a, b, n) => {
      assert.strictEqual(sortSymbolItems(a, b), n)
    }
    checkSort({ data: { score: 1 } }, { data: { score: 2 } }, 1)
    checkSort({ data: { kind: 1 } }, { data: { kind: 2 } }, -1)
    checkSort({ data: { file: 'aa' } }, { data: { file: 'b' } }, 1)
  })

  it('should format list items', t => {
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
  afterEach(editorReset)

  it('should get index', t => {
    assert.strictEqual(indexOf('Abc', 'a', true, false), 0)
    assert.strictEqual(indexOf('Abc', 'A', false, false), 0)
    assert.strictEqual(indexOf('abc', 'A', false, true), 0)
  })

  it('should parse input with space', t => {
    let res = parseInput('a b')
    assert.deepStrictEqual(res, ['a', 'b'])
    res = parseInput('a b ')
    assert.deepStrictEqual(res, ['a', 'b'])
    res = parseInput('ab ')
    assert.deepStrictEqual(res, ['ab'])
  })

  it('should parse input with escaped space', t => {
    let res = parseInput('a\\ b')
    assert.deepStrictEqual(res, ['a b'])
  })

  it('should convert item label', t => {
    assert.strictEqual(convertItemLabel({ label: 'foo\nbar\nx' }).label, 'foo')
    const redOpen = '\x1B[31m'
    const redClose = '\x1B[39m'
    let label = redOpen + 'foo' + redClose
    assert.strictEqual(convertItemLabel({ label }).label, 'foo')
  })

  it('should convert input', t => {
    assert.deepStrictEqual(toInputs('foo bar', false), ['foo bar'])
  })
})

describe('list worker', () => {
  afterEach(editorReset)


  it('should work with long running task', async t => {
    disposables.push(manager.registerList(new IntervalTaskList()))
    await manager.start(['task'])
    await manager.session.worker.drawItems()
    await manager.session.ui.ready
    await shared.waitValue(() => {
      return manager.session?.length > 2
    }, true)
    await manager.cancel()
  })

  it('should sort by sortText', async t => {
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
    await shared.listInput('a')
    await shared.waitFor('getline', ['.'], 'ade')
    await manager.cancel()
  })

  it('should ready with undefined result', async t => {
    items = undefined
    disposables.push(manager.registerList(new DataList()))
    await manager.start(['data'])
    await manager.session.ui.ready
    await manager.cancel()
  })

  it('should show empty line for empty task', async t => {
    disposables.push(manager.registerList(new EmptyList()))
    await manager.start(['empty'])
    await manager.session.ui.ready
    let line = await nvim.call('getline', [1]) as string
    assert.match(line, new RegExp('No results'))
    await manager.cancel()
  })

  it('should cancel task by use CancellationToken', async t => {
    disposables.push(manager.registerList(new IntervalTaskList()))
    await manager.start(['task'])
    assert.strictEqual(manager.session?.worker.isLoading, true)
    await shared.listInput('1')
    await shared.wait(50)
    manager.session?.stop()
    assert.strictEqual(manager.session?.worker.isLoading, false)
  })

  it('should render slow interactive list', async t => {
    disposables.push(manager.registerList(new DelayTask()))
    await manager.start(['delay'])
    await shared.listInput('a')
    await shared.waitFor('getline', [2], 'abort')
  })

  it('should work with interactive list', async t => {
    disposables.push(manager.registerList(new InteractiveList()))
    await manager.start(['-I', 'test'])
    await manager.session?.ui.ready
    assert.strictEqual(manager.isActivated, true)
    await shared.listInput('f')
    await shared.listInput('a')
    await shared.listInput('x')
    await shared.waitFor('getline', ['.'], 'fax')
    await manager.cancel(true)
  })

  it('should not activate on load error', async t => {
    disposables.push(manager.registerList(new ErrorList()))
    await manager.start(['test'])
    assert.strictEqual(manager.isActivated, false)
  })

  it('should deactivate on task error', async t => {
    disposables.push(manager.registerList(new ErrorTaskList()))
    await manager.start(['task'])
    await shared.waitValue(() => {
      return manager.isActivated
    }, false)
  })

  function createWorker(loadItems: IList['loadItems']): Worker {
    let prompt = new Prompt(nvim)
    let options: ListOptions = {
      position: 'bottom',
      reverse: false,
      input: '',
      ignorecase: false,
      interactive: true,
      sort: true,
      mode: 'insert',
      matcher: 'fuzzy',
      autoPreview: false,
      numberSelect: false,
      noQuit: false,
      first: false
    }
    let list = {
      name: 'test',
      actions: [],
      defaultAction: 'open',
      loadItems
    } as IList
    return new Worker(list, prompt, options)
  }

  it('resets loading and token when loadItems rejects', async t => {
    let worker = createWorker(() => Promise.reject(new Error('boom')))
    await assert.rejects(worker.loadItems({} as any), new RegExp('boom'))
    assert.strictEqual(worker.isLoading, false)
    assert.strictEqual((worker as any).tokenSource, null)
  })

  it('a stale cancelled request cannot clobber the state of a newer request', async t => {
    let calls = 0
    let resolveFirst: (v: any) => void = () => {}
    let worker = createWorker(() => {
      calls++
      if (calls === 1) {
        return new Promise(resolve => {
          resolveFirst = resolve
        })
      }
      return Promise.reject(new Error('second boom'))
    })
    let first = worker.loadItems({} as any)
    worker.stop()
    await assert.rejects(worker.loadItems({} as any), new RegExp('second boom'))
    assert.strictEqual(worker.isLoading, false)
    resolveFirst([{ label: 'x' }])
    await first
    assert.strictEqual(worker.isLoading, false)
    assert.strictEqual(calls, 2)
  })
})

describe('list session', () => {
  afterEach(editorReset)

  describe('doDefaultAction()', () => {
    it('should throw error when default action does not exist', async t => {
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
    it('should invoke multiple action', async t => {
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
      let line = await shared.getCmdline()
      assert.match(line, new RegExp('not found'))
    })

    it('should invoke parallel action', async t => {
      labels = ['a', 'b', 'c']
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      await ui.selectAll()
      let d = Date.now()
      await manager.doAction('parallel')
      assert.ok(Date.now() - d < 300)
    })

    it('should support tabPersist action', async t => {
      labels = ['a', 'b', 'c']
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', '--tab', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      await manager.doAction('open')
      let tabnr = await nvim.call('tabpagenr') as number
      assert.ok(tabnr > 1)
      let win = nvim.createWindow(ui.winid)
      let valid = await win.valid
      assert.strictEqual(valid, true)
    })

    it('should invoke reload action', async t => {
      labels = ['a', 'b', 'c']
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      labels = ['d', 'e']
      await manager.doAction('reload')
      let buf = await nvim.buffer
      await shared.waitValue(async () => (await buf.lines).join('\n'), 'd\ne')
      let lines = await buf.lines
      assert.deepStrictEqual(lines, ['d', 'e'])
    })
  })

  describe('reloadItems()', () => {
    it('should not reload items when window is hidden', async t => {
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
      assert.strictEqual(fn.mock.callCount(), 1)
    })
  })

  describe('resume()', () => {
    it('should do preview on resume', async t => {
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
      await shared.wait(50)
      await nvim.call('coc#window#close', [ui.winid])
      await shared.wait(100)
      await manager.session.resume()
      await shared.waitValue(() => lastItem != null, true)
      assert.notStrictEqual(lastItem, undefined)
    })
  })

  describe('jumpBack()', () => {
    it('should jump back', async t => {
      let win = await nvim.window
      labels = ['a', 'b', 'c']
      let list = new SimpleList()
      disposables.push(manager.registerList(list))
      await manager.start(['--normal', 'simple'])
      let ui = manager.session.ui
      await ui.ready
      manager.session.jumpBack()
      await shared.waitValue(() => nvim.call('win_getid'), win.id)
      let winid = await nvim.call('win_getid')
      assert.strictEqual(winid, win.id)
    })
  })

  describe('hide()', () => {
    it('should not throw when window undefined', async t => {
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
    async function create(len: number): Promise<ListSessionType> {
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

    it('should return false for invalid number', async t => {
      let session = await create(5)
      let res = await session.doNumberSelect('a')
      assert.strictEqual(res, false)
      res = await session.doNumberSelect('8')
      assert.strictEqual(res, false)
    })

    it('should consider 0 as 10', async t => {
      let session = await create(15)
      let res = await session.doNumberSelect('0')
      assert.strictEqual(res, true)
      assert.strictEqual(lastItem, 'j')
    })
  })
})

describe('showHelp()', () => {
  afterEach(editorReset)

  it('should show description and options in help', async t => {
    labels = ['a', 'b', 'c']
    let list = new SimpleList()
    disposables.push(manager.registerList(list))
    await manager.start(['--normal', 'simple'])
    let ui = manager.session.ui
    await ui.ready
    await manager.session.showHelp()
    let lines = await nvim.call('getline', [1, '$']) as string[]
    assert.ok(lines.indexOf('DESCRIPTION') > 0)
    assert.ok(lines.indexOf('ARGUMENTS') > 0)
  })
})

describe('chooseAction()', () => {
  afterEach(editorReset)

  it('should filter actions not have shortcuts', async t => {
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
    await shared.wait(50)
    await nvim.input('a')
    await p
    assert.ok(fn.mock.callCount() > 0)
  })

  it('should choose action by menu picker', async t => {
    shared.updateConfiguration('list.menuAction', true)
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
    await shared.waitPrompt()
    await nvim.input('<cr>')
    await p
  })
})

describe('Command task', () => {
  afterEach(editorReset)

  it('should not show stderr', async t => {
    disposables.push(manager.registerList(new StderrList()))
    await manager.start(['stderr'])
    await manager.session.ui.ready
    let lines = await nvim.call('getline', [1, '$']) as string[]
    assert.deepStrictEqual(lines, ['stdout'])
  })

  it('should not show error', async t => {
    disposables.push(manager.registerList(new ErrorTask()))
    await manager.start(['error'])
    await shared.waitValue(() => manager.session?.ui.length, 0)
    await nvim.command('redraw')
    let len = manager.session.ui.length
    assert.strictEqual(len, 0)
  })

  it('should create command task', async t => {
    let list = new CommandDataList()
    disposables.push(manager.registerList(list))
    await manager.start(['data'])
    await manager.session.ui.ready
    await shared.waitValue(async () => nvim.call('getline', [1, '$']), ['foo', 'bar'])
    let lines = await nvim.call('getline', [1, '$']) as string[]
    assert.deepStrictEqual(lines, ['foo', 'bar'])
  })

  it('should stop command task', async t => {
    let list = new SleepList()
    disposables.push(manager.registerList(list))
    await manager.start(['sleep'])
    manager.session.stop()
  })
})
