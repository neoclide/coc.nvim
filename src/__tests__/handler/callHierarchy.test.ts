import { getCurrentPlugin } from '../../attach'
import * as shared from '../sharedUtil'
import CallHierarchyHandler from '../../handler/callHierarchy'
import languages from '../../languages'
import workspace from '../../workspace'
import { disposeAll } from '../../util'
import commands from '../../commands'
import { Neovim } from '@chemzqm/neovim'
import { Disposable, CallHierarchyItem, SymbolKind, Range, SymbolTag, CancellationToken, Position } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'


let nvim: Neovim
let callHierarchy: CallHierarchyHandler
let disposables: Disposable[] = []
before(async () => {
  nvim = workspace.nvim
  callHierarchy = getCurrentPlugin().getHandler().callHierarchy
})

afterEach(async () => {
  disposeAll(disposables)
})

function createCallItem(name: string, kind: SymbolKind, uri: string, range: Range): CallHierarchyItem {
  return {
    name,
    kind,
    uri,
    range,
    selectionRange: range
  }
}

afterEach(editorReset)

describe('CallHierarchy', () => {
  it('should throw when provider does not exist', async t => {
    await assert.rejects(callHierarchy.getIncoming(), Error)
  })

  it('should return null when provider not exist', async t => {
    let token = CancellationToken.None
    let doc = await workspace.document
    let res: any
    res = await languages.prepareCallHierarchy(doc.textDocument, Position.create(0, 0), token)
    assert.strictEqual(res, null)
    let item = createCallItem('name', SymbolKind.Class, doc.uri, Range.create(0, 0, 1, 0))
    res = await languages.provideOutgoingCalls(doc.textDocument, item, token)
    assert.strictEqual(res, null)
    res = await languages.provideIncomingCalls(doc.textDocument, item, token)
    assert.strictEqual(res, null)
  })

  it('should throw when prepare failed', async t => {
    disposables.push(languages.registerCallHierarchyProvider([{ language: '*' }], {
      prepareCallHierarchy() {
        return undefined
      },
      provideCallHierarchyIncomingCalls() {
        return []
      },
      provideCallHierarchyOutgoingCalls() {
        return []
      }
    }))
    let fn = async () => {
      await callHierarchy.getOutgoing()
    }
    await assert.rejects(fn(), Error)
  })

  it('should get incoming & outgoing callHierarchy items', async t => {
    disposables.push(languages.registerCallHierarchyProvider([{ language: '*' }], {
      prepareCallHierarchy() {
        return createCallItem('foo', SymbolKind.Class, 'test:///foo', Range.create(0, 0, 0, 5))
      },
      provideCallHierarchyIncomingCalls() {
        return [{
          from: createCallItem('bar', SymbolKind.Class, 'test:///bar', Range.create(1, 0, 1, 5)),
          fromRanges: [Range.create(0, 0, 0, 5)]
        }]
      },
      provideCallHierarchyOutgoingCalls() {
        return [{
          to: createCallItem('bar', SymbolKind.Class, 'test:///bar', Range.create(1, 0, 1, 5)),
          fromRanges: [Range.create(1, 0, 1, 5)]
        }]
      }
    }))
    let res = await shared.doAction('incomingCalls')
    assert.strictEqual(res.length, 1)
    assert.strictEqual(res[0].from.name, 'bar')
    let outgoing = await shared.doAction('outgoingCalls')
    assert.strictEqual(outgoing.length, 1)
    res = await callHierarchy.getIncoming(outgoing[0].to)
    assert.strictEqual(res.length, 1)
  })

  it('should show warning when provider does not exist', async t => {
    await shared.doAction('showIncomingCalls')
    let line = await shared.getCmdline()
    assert.match(line, new RegExp('not found'))
  })

  it('should show message when no result returned.', async t => {
    disposables.push(languages.registerCallHierarchyProvider([{ language: '*' }], {
      prepareCallHierarchy() {
        return null
      },
      provideCallHierarchyIncomingCalls() {
        return []
      },
      provideCallHierarchyOutgoingCalls() {
        return []
      }
    }))
    await callHierarchy.showCallHierarchyTree('incoming')
    let line = await shared.getCmdline()
    assert.match(line, new RegExp('Unable'))
  })

  it('should render description and support default action', async t => {
    shared.updateConfiguration('callHierarchy.enableTooltip', false)
    let doc = await workspace.document
    let bufnr = doc.bufnr
    await doc.buffer.setLines(['foo'], { start: 0, end: -1, strictIndexing: false })
    let fsPath = await shared.createTmpFile('foo\nbar\ncontent\n')
    let uri = URI.file(fsPath).toString()
    disposables.push(languages.registerCallHierarchyProvider([{ language: '*' }], {
      prepareCallHierarchy() {
        return createCallItem('foo', SymbolKind.Class, doc.uri, Range.create(0, 0, 0, 3))
      },
      provideCallHierarchyIncomingCalls() {
        let item = createCallItem('bar', SymbolKind.Class, uri, Range.create(1, 0, 1, 3))
        item.detail = 'Detail'
        item.tags = [SymbolTag.Deprecated]
        return [{
          from: item,
          fromRanges: [Range.create(2, 0, 2, 5)]
        }]
      },
      provideCallHierarchyOutgoingCalls() {
        return []
      }
    }))
    await commands.executeCommand('document.showIncomingCalls')
    let buf = await nvim.buffer
    let lines = await buf.lines
    assert.deepStrictEqual(lines, [
      'INCOMING CALLS',
      '- c foo',
      '  + c bar Detail'
    ])
    await nvim.command('exe 3')
    await nvim.input('t')
    await shared.waitFor('getline', ['.'], '  - c bar Detail')
    await nvim.input('<cr>')
    await shared.waitFor('expand', ['%:p'], fsPath)
    let res = await nvim.call('coc#cursor#position')
    assert.deepStrictEqual(res, [1, 0])
    let matches = await nvim.call('getmatches') as any[]
    assert.strictEqual(matches.length, 2)
    await nvim.command(`b ${bufnr}`)
    await shared.waitValue(async () => (await nvim.call('getmatches') as any[]).length, 0)
    matches = await nvim.call('getmatches') as any[]
    assert.strictEqual(matches.length, 0)
    await nvim.command(`wincmd o`)
  })

  it('should invoke reveal command', async t => {
    let doc = await shared.createDocument('foo')
    await nvim.setLine('foo')
    let item: any = createCallItem('name', SymbolKind.Class, doc.uri, Range.create(0, 0, 1, 0))
    let winid = await nvim.call('win_getid') as number
    let commandId = 'callHierarchy.reveal'
    await commands.executeCommand(commandId, winid, item)
    item.ranges = [Range.create(0, 0, 0, 1)]
    item.sourceUri = 'lsp:/1'
    await commands.executeCommand(commandId, winid, item)
    let newDoc = await shared.createDocument('bar')
    await workspace.jumpTo(doc.uri)
    item.sourceUri = newDoc.uri
    await commands.executeCommand(commandId, winid, item)
  })

  it('should invoke open in new tab action', async t => {
    let doc = await workspace.document
    await doc.buffer.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false })
    let fsPath = await shared.createTmpFile('foo\nbar\ncontent\n')
    let uri = URI.file(fsPath).toString()
    disposables.push(languages.registerCallHierarchyProvider([{ language: '*' }], {
      prepareCallHierarchy() {
        return createCallItem('foo', SymbolKind.Class, doc.uri, Range.create(0, 0, 0, 3))
      },
      provideCallHierarchyIncomingCalls() {
        return []
      },
      provideCallHierarchyOutgoingCalls() {
        let item = createCallItem('bar', SymbolKind.Class, uri, Range.create(0, 0, 0, 1))
        item.detail = 'Detail'
        return [{
          to: item,
          fromRanges: [Range.create(1, 0, 1, 3)]
        }]
      }
    }))
    let win = await nvim.window
    await commands.executeCommand('document.showOutgoingCalls')
    let buf = await nvim.buffer
    let lines = await buf.lines
    assert.deepStrictEqual(lines, [
      'OUTGOING CALLS',
      '- c foo',
      '  + c bar Detail'
    ])
    await nvim.command('exe 3')
    await nvim.input('<tab>')
    await shared.waitPrompt()
    await nvim.input('<cr>')
    await shared.waitFor('tabpagenr', [], 2)
    doc = await workspace.document
    assert.strictEqual(doc.uri, uri)
    await shared.waitValue(async () => {
      let res = await nvim.call('getmatches', [win.id]) as any[]
      return res.length
    }, 1)
  })

  it('should invoke show incoming calls action', async t => {
    let doc = await workspace.document
    await doc.buffer.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false })
    let fsPath = await shared.createTmpFile('foo\nbar\ncontent\n')
    let uri = URI.file(fsPath).toString()
    disposables.push(languages.registerCallHierarchyProvider([{ language: '*' }], {
      prepareCallHierarchy() {
        return createCallItem('foo', SymbolKind.Class, doc.uri, Range.create(0, 0, 0, 3))
      },
      provideCallHierarchyIncomingCalls() {
        return [{
          from: createCallItem('test', SymbolKind.Class, 'test:///bar', Range.create(1, 0, 1, 5)),
          fromRanges: [Range.create(0, 0, 0, 5)]
        }]
      },
      provideCallHierarchyOutgoingCalls() {
        let item = createCallItem('bar', SymbolKind.Class, uri, Range.create(0, 0, 0, 1))
        item.detail = 'Detail'
        return [{
          to: item,
          fromRanges: [Range.create(1, 0, 1, 3)]
        }]
      }
    }))
    await callHierarchy.showCallHierarchyTree('outgoing')
    let buf = await nvim.buffer
    let lines = await buf.lines
    assert.deepStrictEqual(lines, [
      'OUTGOING CALLS',
      '- c foo',
      '  + c bar Detail'
    ])
    await nvim.command('exe 3')
    await nvim.input('<tab>')
    await shared.waitPrompt()
    await nvim.input('3')
    await shared.waitValue(async () => buf.lines, [
      'INCOMING CALLS',
      '- c bar Detail',
      '  + c test'
    ])
    lines = await buf.lines
    assert.deepStrictEqual(lines, [
      'INCOMING CALLS',
      '- c bar Detail',
      '  + c test'
    ])
  })

  it('should invoke show outgoing calls action', async t => {
    let doc = await workspace.document
    await doc.buffer.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false })
    let fsPath = await shared.createTmpFile('foo\nbar\ncontent\n')
    let uri = URI.file(fsPath).toString()
    disposables.push(languages.registerCallHierarchyProvider([{ language: '*' }], {
      prepareCallHierarchy() {
        return createCallItem('foo', SymbolKind.Class, doc.uri, Range.create(0, 0, 0, 3))
      },
      provideCallHierarchyIncomingCalls() {
        return [{
          from: createCallItem('test', SymbolKind.Class, 'test:///bar', Range.create(1, 0, 1, 5)),
          fromRanges: [Range.create(0, 0, 0, 5)]
        }]
      },
      provideCallHierarchyOutgoingCalls() {
        let item = createCallItem('bar', SymbolKind.Class, uri, Range.create(0, 0, 0, 1))
        item.detail = 'Detail'
        return [{
          to: item,
          fromRanges: [Range.create(1, 0, 1, 3)]
        }]
      }
    }))
    await callHierarchy.showCallHierarchyTree('incoming')
    let buf = await nvim.buffer
    let lines = await buf.lines
    assert.deepStrictEqual(lines, [
      'INCOMING CALLS',
      '- c foo',
      '  + c test'
    ])
    await nvim.command('exe 3')
    await nvim.input('<tab>')
    await shared.waitPrompt()
    await nvim.input('4')
    await shared.waitValue(async () => buf.lines, [
      'OUTGOING CALLS',
      '- c test',
      '  + c bar Detail'
    ])
    lines = await buf.lines
    assert.deepStrictEqual(lines, [
      'OUTGOING CALLS',
      '- c test',
      '  + c bar Detail'
    ])
  })

  it('should invoke dismiss action #1', async t => {
    let doc = await workspace.document
    await doc.buffer.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false })
    let fsPath = await shared.createTmpFile('foo\nbar\ncontent\n')
    let uri = URI.file(fsPath).toString()
    disposables.push(languages.registerCallHierarchyProvider([{ language: '*' }], {
      prepareCallHierarchy() {
        return createCallItem('foo', SymbolKind.Class, doc.uri, Range.create(0, 0, 0, 3))
      },
      provideCallHierarchyIncomingCalls() {
        return []
      },
      provideCallHierarchyOutgoingCalls() {
        let item = createCallItem('bar', SymbolKind.Class, uri, Range.create(0, 0, 0, 1))
        item.detail = 'Detail'
        return [{
          to: item,
          fromRanges: [Range.create(1, 0, 1, 3)]
        }]
      }
    }))
    await callHierarchy.showCallHierarchyTree('outgoing')
    let buf = await nvim.buffer
    let lines = await buf.lines
    assert.deepStrictEqual(lines, [
      'OUTGOING CALLS',
      '- c foo',
      '  + c bar Detail'
    ])
    await nvim.command('exe 3')
    await nvim.input('<tab>')
    await shared.waitPrompt()
    await nvim.input('2')
    await shared.waitValue(async () => buf.lines, [
      'OUTGOING CALLS',
      '- c foo'
    ])
    lines = await buf.lines
    assert.deepStrictEqual(lines, [
      'OUTGOING CALLS',
      '- c foo'
    ])
    await nvim.command('exe 2')
    await nvim.input('<tab>')
    await shared.waitPrompt()
    await nvim.input('2')
    await shared.wait(30)
  })

  it('should invoke dismiss action #2', async t => {
    let doc = await workspace.document
    await doc.buffer.setLines(['foo', 'bar'], { start: 0, end: -1, strictIndexing: false })
    let fsPath = await shared.createTmpFile('foo\nbar\ncontent\n')
    let uri = URI.file(fsPath).toString()
    disposables.push(languages.registerCallHierarchyProvider([{ language: '*' }], {
      prepareCallHierarchy() {
        return createCallItem('foo', SymbolKind.Class, doc.uri, Range.create(0, 0, 0, 3))
      },
      provideCallHierarchyIncomingCalls() {
        return []
      },
      provideCallHierarchyOutgoingCalls() {
        let item = createCallItem('bar', SymbolKind.Class, uri, Range.create(0, 0, 0, 1))
        item.detail = 'Detail'
        return [{
          to: item,
          fromRanges: [Range.create(1, 0, 1, 3)]
        }]
      }
    }))
    await shared.doAction('showOutgoingCalls')
    let buf = await nvim.buffer
    let lines = await buf.lines
    assert.deepStrictEqual(lines, [
      'OUTGOING CALLS',
      '- c foo',
      '  + c bar Detail'
    ])
    await nvim.command('exe 3')
    await nvim.input('t')
    await shared.waitFor('line', ['$'], 4)
    await nvim.command('exe 4')
    await nvim.input('<tab>')
    await shared.waitPrompt()
    await nvim.input('2')
    await shared.waitFor('line', ['$'], 3)
    lines = await buf.lines
    assert.deepStrictEqual(lines, [
      'OUTGOING CALLS',
      '- c foo',
      '  - c bar Detail'
    ])
  })
})
