import style from 'ansi-styles'
import * as assert from 'assert'
import cp, { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import vm from 'vm'
import { AnnotatedTextEdit, CancellationToken, CancellationTokenSource, ChangeAnnotation, Color, Position, Range, SymbolKind, TextDocumentEdit, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { ConfigurationScope } from '../../configuration/types'
import { LinesTextDocument } from '../../model/textdocument'
import { DocumentChange } from '../../types'
import { concurrent, delay, disposeAll, wait, waitWithToken } from '../../util'
import { ansiparse, parseAnsiHighlights } from '../../util/ansiparse'
import * as arrays from '../../util/array'
import { filter, forEach, map, YieldOptions } from '../../util/async'
import * as color from '../../util/color'
import { pluginRoot } from '../../util/constants'
import { getSymbolKind } from '../../util/convert'
import * as diff from '../../util/diff'
import * as errors from '../../util/errors'
import * as extension from '../../util/extensionRegistry'
import * as factory from '../../util/factory'
import * as fuzzy from '../../util/fuzzy'
import * as Is from '../../util/is'
import { Extensions, IJSONContributionRegistry } from '../../util/jsonRegistry'
import * as lodash from '../../util/lodash'
import { Mutex } from '../../util/mutex'
import * as numbers from '../../util/numbers'
import * as objects from '../../util/object'
import * as platform from '../../util/platform'
import * as positions from '../../util/position'
import { executable, isRunning, runCommand, terminate } from '../../util/processes'
import { convertProperties, Registry } from '../../util/registry'
import { Sequence } from '../../util/sequence'
import * as strings from '../../util/string'
import * as textedits from '../../util/textedit'
import { createTiming } from '../../util/timing'
import { waitValue } from './testUtils'
import { after, before, describe, it, test } from 'node:test'

function createTextDocument(lines: string[]): LinesTextDocument {
  return new LinesTextDocument('file://a', 'txt', 1, lines, 1, true)
}

function toEdit(sl, sc, el, ec, text): TextEdit {
  return TextEdit.replace(Range.create(sl, sc, el, ec), text)
}

let logfile = path.join(os.tmpdir(), 'log_test.js')
before(() => {
  let code = `const {wait, nvim} = require('coc.nvim')
console.log('log')
console.debug('debug')
console.info('info')
console.error('error')
console.warn('warn')
module.exports = () => {
  return {wait, nvim}
}`
  fs.writeFileSync(logfile, code, 'utf8')
})

after(() => {
  fs.unlinkSync(logfile)
})

describe('factory', () => {
  after(() => {
    global.__TEST__ = true
  })

  const emptyLogger: factory.ILogger = {
    log: () => {},
    info: () => {},
    error: () => {},
    debug: () => {},
    warn: () => {},
    trace: () => {},
    fatal: () => {},
    mark: () => {}
  }

  it('should create logger', t => {
    let fn = t.mock.fn()
    const sandbox = factory.createSandbox(logfile, {
      log: () => {
        fn()
      },
      info: () => {
        fn()
      },
      error: () => {
        fn()
      },
      debug: () => {
        fn()
      },
      warn: () => {
        fn()
      },
      trace: () => {
      },
      fatal: () => {
      },
      mark: () => {
      }
    })
    vm.runInContext(`
console.log('log')
console.debug('debug')
console.info('info')
console.error('error')
console.warn('warn')`, sandbox)
    assert.ok(fn.mock.callCount() > 0)
  })

  it('should create console', () => {
    let res = factory.createConsole({ x: 1 }, {} as any)
    assert.deepStrictEqual(res, { x: 1 })
    let called = false
    let val = 1
    res = factory.createConsole({
      warn: () => {
      },
      custom: () => {
        val = 2
      }
    }, {
      warn: () => {
        called = true
      }
    } as any)
      ; (res as any).custom()
      ; (res as Console).warn()
    assert.strictEqual(val, 1)
    assert.strictEqual(called, true)
  })

  it('should copy properties', () => {
    let obj = factory.copyGlobalProperties({} as any, global)
    assert.strictEqual(typeof obj['fetch'], 'function')
  })

  it('should not throw process.chdir', () => {
    const sandbox = factory.createSandbox(logfile, emptyLogger)
    let res = vm.runInContext(`process.chdir()`, sandbox)
    assert.strictEqual(res, undefined)
  })

  it('should throw with umask', () => {
    const sandbox = factory.createSandbox(logfile, emptyLogger)
    let res = vm.runInContext(`process.umask()`, sandbox)
    assert.strictEqual(typeof res, 'number')
    let err
    try {
      res = vm.runInContext(`process.umask(18)`, sandbox)
    } catch (e) {
      err = e
    }
    assert.notStrictEqual(err, undefined)
  })

  it('should throw with process.exit', () => {
    const sandbox = factory.createSandbox(logfile, emptyLogger)
    let err
    try {
      vm.runInContext(`process.exit()`, sandbox)
    } catch (e) {
      err = e
    }
    assert.notStrictEqual(err, undefined)
  })

  it('should get module prototype', () => {
    const Module = require('module')
    assert.notStrictEqual(factory.getProtoWithCompile(Module as any), undefined)
    function fn() {}
    assert.throws(() => {
      factory.getProtoWithCompile(fn)
    }, Error)
    fn.prototype._compile = () => {}
    assert.notStrictEqual(factory.getProtoWithCompile(fn), undefined)
  })

  it('should clear the cache', () => {
    const Module = require('module')
    let filename = path.join(os.tmpdir(), 'cache_test.js')
    fs.writeFileSync(filename, 'module.exports = {x: 1}', 'utf8')
    let sandbox = factory.createSandbox(filename, emptyLogger, 'hook')
    let exports = sandbox.require(filename)
    delete Module._cache[require.resolve(filename)]
    fs.writeFileSync(filename, 'module.exports = {y: 1}', 'utf8')
    sandbox = factory.createSandbox(filename, emptyLogger, 'hook')
    exports = sandbox.require(filename)
    // sandbox.require returns a VM-realm object whose prototype differs;
    // deepEqual (like Vitest toEqual) ignores prototypes.
    assert.deepEqual(exports, { y: 1 })
    fs.rmSync(filename, { force: true })
  })
})

describe('platform', () => {
  it('should get platform', () => {
    assert.strictEqual(platform.getPlatform({ platform: 'win32' } as any), platform.Platform.Windows)
    assert.strictEqual(platform.getPlatform({ platform: 'darwin' } as any), platform.Platform.Mac)
    assert.strictEqual(platform.getPlatform({ platform: 'linux' } as any), platform.Platform.Linux)
    assert.strictEqual(platform.getPlatform({ platform: 'unknown' } as any), platform.Platform.Unknown)
  })

  it('should check platform', () => {
    assert.notStrictEqual(platform.isWeb, undefined)
    assert.notStrictEqual(platform.isLinux, undefined)
    assert.notStrictEqual(platform.isNative, undefined)
    assert.notStrictEqual(platform.isWindows, undefined)
    assert.notStrictEqual(platform.isMacintosh, undefined)
  })
})

describe('textedit', () => {

  function createEdit(uri: string): WorkspaceEdit {
    let edit = TextEdit.insert(Position.create(0, 0), 'a')
    let doc = { uri, version: null }
    return { documentChanges: [TextDocumentEdit.create(doc, [edit])] }
  }

  function addPosition(position: Position, line: number, character: number): Position {
    return Position.create(position.line + line, position.character + character)
  }

  test('getChangedPosition', () => {
    const assertPosition = (start, edit, arr) => {
      let res = textedits.getChangedPosition(start, edit)
      assert.deepStrictEqual(res, Position.create(arr[0], arr[1]))
    }
    let pos = Position.create(0, 0)
    assertPosition(pos, TextEdit.insert(pos, 'abc'), [0, 3])
    assertPosition(pos, TextEdit.insert(pos, 'a\nb\nc'), [2, 1])
    let edit = TextEdit.replace(Range.create(pos, Position.create(0, 3)), 'abc')
    assertPosition(pos, edit, [0, 0])
    pos = Position.create(0, 1)
    let r = Range.create(addPosition(pos, 0, -1), pos)
    assertPosition(pos, TextEdit.replace(r, 'a\nb\n'), [2, -1])
    pos = Position.create(1, 3)
    edit = TextEdit.replace(Range.create(Position.create(0, 1), Position.create(1, 0)), 'abc')
    assertPosition(pos, edit, [-1, 4])
  })

  test('getChangedLineCount', () => {
    let pos = Position.create(5, 0)
    let edits: TextEdit[] = [
      TextEdit.replace(Range.create(0, 1, 1, 0), ''),
      TextEdit.replace(Range.create(2, 1, 3, 0), ''),
      TextEdit.replace(Range.create(10, 1, 12, 0), 'foo'),
    ]
    assert.strictEqual(textedits.getChangedLineCount(pos, edits), -2)
  })

  test('getPosition()', () => {
    let pos = Position.create(1, 3)
    const assertChange = (rl, rc, el, ec, text, val): void => {
      let edit = TextEdit.replace(Range.create(rl, rc, el, ec), text)
      let lines = text.split('\n')
      let res = textedits.getPosition(pos, edit)
      let resWithLines = textedits.getPosition(pos, edit, lines)
      assert.deepStrictEqual(res, val)
      assert.deepStrictEqual(resWithLines, res)
    }
    assertChange(0, 1, 1, 0, 'abc', Position.create(0, 7))
    assertChange(0, 1, 1, 1, 'abc', Position.create(0, 6))
    assertChange(0, 1, 1, 0, 'abc\n', Position.create(1, 3))
    assertChange(1, 1, 1, 2, '', Position.create(1, 2))
    assertChange(1, 1, 3, 0, '', Position.create(1, 3))
  })

  test('getStartLine()', () => {
    const assertLine = (rl, rc, el, ec, text, val: number): void => {
      let edit = TextEdit.replace(Range.create(rl, rc, el, ec), text)
      let res = textedits.getStartLine(edit)
      assert.strictEqual(res, val)
    }
    assertLine(0, 0, 0, 0, 'abc\n', -1)
    assertLine(1, 0, 1, 0, 'd\n', 0)
    assertLine(0, 0, 0, 0, 'abc', 0)
  })

  test('getPositionFromEdits()', () => {
    const assertEdits = (pos, edits, exp: [number, number]) => {
      let res = textedits.getPositionFromEdits(pos, edits)
      assert.deepStrictEqual(res, Position.create(exp[0], exp[1]))
    }
    let pos = Position.create(5, 1)
    let edits: TextEdit[] = [
      TextEdit.replace(Range.create(0, 3, 1, 0), ''),
      TextEdit.replace(Range.create(2, 4, 3, 0), ''),
      TextEdit.replace(Range.create(3, 4, 4, 0), ''),
      TextEdit.replace(Range.create(4, 1, 5, 0), ''),
      TextEdit.replace(Range.create(6, 1, 6, 1), 'foo'),
    ]
    assertEdits(pos, edits, [1, 10])
  })

  it('should check empty workspaceEdit', () => {
    let workspaceEdit: WorkspaceEdit = createEdit('untitled:/1')
    assert.strictEqual(textedits.emptyWorkspaceEdit(workspaceEdit), false)
    assert.strictEqual(textedits.emptyWorkspaceEdit({ documentChanges: [] }), true)
  })

  it('should get ranges', async () => {
    let ranges = textedits.getRangesFromEdit('test:/1', {})
    assert.strictEqual(ranges, undefined)
    let edit: WorkspaceEdit = { changes: { 'test:/2': [TextEdit.insert(Position.create(0, 0), ' ')] } }
    ranges = textedits.getRangesFromEdit('test:/1', edit)
    assert.strictEqual(ranges, undefined)
    ranges = textedits.getRangesFromEdit('test:/2', edit)
    assert.notStrictEqual(ranges, undefined)
    edit = { documentChanges: [TextDocumentEdit.create({ uri: 'test:/1', version: null }, [TextEdit.insert(Position.create(0, 0), ' ')])] }
    ranges = textedits.getRangesFromEdit('test:/1', edit)
    assert.notStrictEqual(ranges, undefined)
  })

  it('should get all annotation ids for confirm', () => {
    let doc = { uri: 'test:///1', version: null }
    let changes: DocumentChange[] = []
    let ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    changes.push({
      textDocument: doc,
      edits: [
        AnnotatedTextEdit.insert(Position.create(0, 0), 'foo', ids[0]),
        AnnotatedTextEdit.insert(Position.create(1, 0), 'bar', ids[1]),
      ]
    })
    changes.push({
      kind: 'delete',
      uri: 'test:///2',
      annotationId: ids[2]
    })
    changes.push({
      kind: 'delete',
      uri: 'test:///3',
    })
    let annotations: { [id: string]: ChangeAnnotation } = {}
    annotations[ids[0]] = { label: '0', needsConfirmation: true }
    annotations[ids[1]] = { label: '1', needsConfirmation: true }
    annotations[ids[2]] = { label: '2', needsConfirmation: true }
    let res = textedits.getConfirmAnnotations(changes, annotations)
    assert.strictEqual(res.length, 3)
  })

  it('should create filtered changes', () => {
    let doc = { uri: 'test:///1', version: null }
    let changes: DocumentChange[] = []
    let ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]
    changes.push({
      textDocument: doc,
      edits: [
        AnnotatedTextEdit.insert(Position.create(0, 0), 'foo', ids[0]),
        AnnotatedTextEdit.insert(Position.create(1, 0), 'bar', ids[1]),
      ]
    })
    changes.push({
      kind: 'delete',
      uri: 'test:///2',
      annotationId: ids[2]
    })
    changes.push({
      kind: 'delete',
      uri: 'test:///3',
    })
    let res = textedits.createFilteredChanges(changes, [ids[0], ids[2]])
    assert.strictEqual(res.length, 2)
    assert.deepStrictEqual(res, [{
      textDocument: {
        uri: "test:///1",
        version: null
      },
      edits: [{
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 }
        },
        newText: "bar",
        annotationId: ids[1]
      }]
    },
    {
      kind: "delete",
      uri: "test:///3"
    }])
    res = textedits.createFilteredChanges(changes, ids)
    assert.strictEqual(res.length, 1)
  })

  it('should check edit is denied', () => {
    let ids = [crypto.randomUUID(), crypto.randomUUID()]
    let edits = [
      AnnotatedTextEdit.insert(Position.create(0, 0), 'foo', ids[0]),
      AnnotatedTextEdit.insert(Position.create(1, 0), 'bar', ids[1]),
    ]
    assert.strictEqual(textedits.isDeniedEdit(edits[0], [ids[0]]), true)
    assert.strictEqual(textedits.isDeniedEdit(edits[1], [ids[0]]), false)
  })

  it('should check empty TextEdit', () => {
    assert.strictEqual(textedits.emptyTextEdit(TextEdit.insert(Position.create(0, 0), '')), true)
    assert.strictEqual(textedits.emptyTextEdit(TextEdit.insert(Position.create(0, 0), 'a')), false)
  })

  it('should get well formed edit', () => {
    let r = Range.create(1, 0, 0, 0)
    let edit: TextEdit = { range: r, newText: 'foo' }
    let res = textedits.getWellformedEdit(edit)
    assert.deepStrictEqual(res.range, Range.create(0, 0, 1, 0))
    r = Range.create(0, 0, 1, 0)
    edit = { range: r, newText: 'foo' }
    res = textedits.getWellformedEdit(edit)
    assert.strictEqual(res.range, r)
  })

  it('should check line count change', () => {
    let r = Range.create(0, 0, 0, 5)
    let edit: TextEdit = { range: r, newText: 'foo' }
    assert.strictEqual(textedits.lineCountChange(edit), 0)
    edit = { range: Range.create(0, 0, 1, 0), newText: 'foo' }
    assert.strictEqual(textedits.lineCountChange(edit), -1)
  })

  it('should filter and sort textedits', () => {
    let doc = createTextDocument(['foo'])
    assert.deepStrictEqual(textedits.filterSortEdits(doc, [TextEdit.insert(Position.create(0, 0), 'a\r\nb')]), [
      TextEdit.insert(Position.create(0, 0), 'a\nb')
    ])
    assert.deepStrictEqual(textedits.filterSortEdits(doc, [TextEdit.replace(Range.create(0, 0, 0, 3), 'foo')]), [])
    assert.deepStrictEqual(textedits.filterSortEdits(doc, [
      TextEdit.insert(Position.create(0, 1), 'b'),
      TextEdit.insert(Position.create(0, 0), 'a'),
    ]), [
      TextEdit.insert(Position.create(0, 0), 'a'),
      TextEdit.insert(Position.create(0, 1), 'b'),
    ])
  })

  it('should fix edit range', () => {
    let doc = createTextDocument(['foo'])
    let range = Range.create(0, 0, 0, 5)
    let res = textedits.filterSortEdits(doc, [TextEdit.replace(range, 'bar')])
    assert.deepStrictEqual(res[0].range, Range.create(0, 0, 0, 3))
  })

  it('should get range text', async () => {
    {
      let text = textedits.getRangeText([''], Range.create(0, 0, 0, 0))
      assert.strictEqual(text, '')
    }
    {
      let lines = ['foo', 'aabb', 'bar']
      let text = textedits.getRangeText(lines, Range.create(0, 1, 2, 1))
      assert.strictEqual(text, 'oo\naabb\nb')
    }
  })

  it('should reduceTextEdit', () => {
    let e: TextEdit
    e = TextEdit.replace(Range.create(0, 0, 0, 3), 'foo')
    assert.deepStrictEqual(textedits.reduceTextEdit(e, ''), e)
    e = TextEdit.replace(Range.create(0, 0, 0, 3), 'foo\nbar')
    assert.deepStrictEqual(textedits.reduceTextEdit(e, 'bar'), TextEdit.replace(Range.create(0, 0, 0, 0), 'foo\n'))
    e = TextEdit.replace(Range.create(0, 0, 0, 3), 'foo\nbar')
    assert.deepStrictEqual(textedits.reduceTextEdit(e, 'foo'), TextEdit.replace(Range.create(0, 3, 0, 3), '\nbar'))
    e = TextEdit.replace(Range.create(0, 0, 0, 3), 'def')
    assert.deepStrictEqual(textedits.reduceTextEdit(e, 'daf'), TextEdit.replace(Range.create(0, 1, 0, 2), 'e'))
    e = TextEdit.replace(Range.create(2, 0, 3, 0), 'ascii ascii bar\n')
    assert.deepStrictEqual(textedits.reduceTextEdit(e, 'xyz ascii bar\n'), TextEdit.replace(Range.create(2, 0, 2, 3), 'ascii'))
  })

  it('should get revert edit', async () => {
    {
      let res = textedits.getRevertEdit(['aa'], ['aa'], 0)
      assert.strictEqual(res, undefined)
    } {
      let res = textedits.getRevertEdit(['foo', 'bar'], ['foo 1', 'bar 2'], 0)
      assert.deepStrictEqual(res, TextEdit.replace(Range.create(0, 0, 2, 0), 'foo\nbar\n'))
    } {
      let res = textedits.getRevertEdit(['foo', 'bar'], ['foo', 'bar', 'after'], 2)
      assert.deepStrictEqual(res, TextEdit.replace(Range.create(2, 0, 3, 0), ''))
    }
  })

  it('should merge textedits #1', () => {
    let edits = [toEdit(0, 0, 0, 0, 'foo'), toEdit(0, 1, 0, 1, 'bar')]
    let lines = ['ab']
    let res = textedits.mergeTextEdits(edits, lines, ['fooabarb'])
    assert.deepStrictEqual(res, toEdit(0, 0, 0, 1, 'fooabar'))
  })

  it('should merge textedits #2', () => {
    let edits = [toEdit(0, 0, 1, 0, 'foo\n')]
    let lines = ['bar']
    let res = textedits.mergeTextEdits(edits, lines, ['foo'])
    assert.deepStrictEqual(res, toEdit(0, 0, 1, 0, 'foo\n'))
  })

  it('should merge textedits #3', () => {
    let edits = [toEdit(0, 0, 0, 1, 'd'), toEdit(1, 0, 1, 1, 'e'), toEdit(2, 0, 3, 0, 'f\n')]
    let lines = ['a', 'b', 'c']
    let res = textedits.mergeTextEdits(edits, lines, ['d', 'e', 'f'])
    assert.deepStrictEqual(res, toEdit(0, 0, 3, 0, 'd\ne\nf\n'))
  })

  it('should convert to text changes', () => {
    assert.strictEqual(textedits.validEdit(TextEdit.insert(Position.create(0, 0), 'abc')), false)
    assert.strictEqual(textedits.validEdit(TextEdit.insert(Position.create(0, 1), 'abc\n')), false)
    assert.deepStrictEqual(textedits.toTextChanges(['foo'], []), [])
    assert.deepStrictEqual(textedits.toTextChanges(['foo'], [TextEdit.insert(Position.create(3, 1), '')]), [])
    assert.deepStrictEqual(textedits.toTextChanges(['foo'], [TextEdit.insert(Position.create(1, 1), '')]), [])
    assert.deepStrictEqual(textedits.toTextChanges(['foo'], [TextEdit.insert(Position.create(1, 0), 'bar\n')]), [[['', 'bar'], 0, 3, 0, 3]])
    assert.deepStrictEqual(textedits.toTextChanges(['foo'], [TextEdit.replace(Range.create(0, 0, 1, 0), 'bar\n')]), [[['bar'], 0, 0, 0, 3]])
  })
})

describe('Registry', () => {
  it('should add to registry', () => {
    Registry.add('key', {})
    assert.strictEqual(Registry.knows('key'), true)
    assert.deepStrictEqual(Registry.as('key'), {})
    assert.strictEqual(Registry.as('not_exists'), null)
  })

  it('should get jsonRegistry', () => {
    let r = Registry.as<IJSONContributionRegistry>(Extensions.JSONContribution)
    assert.notStrictEqual(r, undefined)
    r.registerSchema('uri', {} as any)
    let res = r.getSchemaContributions()
    assert.notStrictEqual(res.schemas.uri, undefined)
  })

  it('should convertProperties', () => {
    assert.deepStrictEqual(convertProperties(undefined), {})
    assert.deepStrictEqual(convertProperties({ key: { type: 'number' } }, ConfigurationScope.RESOURCE), {
      key: { scope: ConfigurationScope.RESOURCE, type: 'number' }
    })
    let properties = {
      foo: {
      },
      bar: {
        type: 'string',
        scope: 'language-overridable'
      },
      resource: {
        type: 'string',
        scope: 'resource'
      },
      window: {
        type: 'string',
        default: ''
      },
      format: {
        type: 'string',
        scope: 'window'
      },
      'coc.source.name': {
        type: 'string',
        scope: 'resource'
      },
      'list.source.name': {
        type: 'string',
        scope: 'resource'
      },
    }
    let res = convertProperties(properties)
    assert.notStrictEqual(res.foo, undefined)
    assert.strictEqual(res.format.scope, ConfigurationScope.WINDOW)
    assert.strictEqual(res.bar.scope, ConfigurationScope.LANGUAGE_OVERRIDABLE)
    assert.strictEqual(res.resource.scope, ConfigurationScope.RESOURCE)
    assert.strictEqual(res.window.scope, ConfigurationScope.WINDOW)
    assert.strictEqual(res['coc.source.name'].scope, ConfigurationScope.APPLICATION)
    assert.strictEqual(res['list.source.name'].scope, ConfigurationScope.APPLICATION)
  })

  it('should parse extension name', () => {
    let parseSource = extension.parseExtensionName
    assert.strictEqual(parseSource(``), undefined)
    assert.strictEqual(parseSource(`a)`, 0), 'coc.nvim')
    assert.strictEqual(parseSource(`a`, 0), 'coc.nvim')
    let registry = Registry.as<extension.IExtensionRegistry>(extension.Extensions.ExtensionContribution)
    let filepath = path.join(os.tmpdir(), 'single')
    registry.registerExtension('single', { name: 'single', directory: os.tmpdir(), filepath })
    assert.strictEqual(parseSource(`\n\n${filepath}:1:1`), 'single')
    // expect(parseSource(`\n\n${filepath.slice(0, -3)}:1:1`)).toBeUndefined()
    assert.strictEqual(parseSource(`\n\n/a/b:1:1`), 'coc.nvim')
    let dir = fs.realpathSync(os.tmpdir())
    assert.strictEqual(parseSource(`\n\n${path.join(dir, 'foo')}:1:1`), 'single')
    let lines = [
      `at FormatRangeManager.addProvider (${pluginRoot}/src/provider/manager.ts:28:55`,
      `at FormatRangeManager.register (${pluginRoot}/formatRangeManager.ts:17:17)`,
      `at PrettierEditService.registerDocumentFormatEditorProviders (${filepath}:253:17)`
    ]
    let res = parseSource(`\n\n${lines.join('\n')}`, 2)
    assert.strictEqual(res, 'single')
    registry.unregistExtension('single')
  })

  it('should check rootPattern and commands', () => {
    assert.strictEqual(extension.validRootPattern({} as any), false)
    assert.strictEqual(extension.validCommandContribution({} as any), false)
  })

  it('should get properties', () => {
    let properties = extension.getProperties({})
    assert.deepStrictEqual(properties, {})
    properties = extension.getProperties({ properties: { x: 1 } })
    assert.deepStrictEqual(properties, { x: 1 })
    properties = extension.getProperties([{ properties: { x: 1 } }, { properties: { y: 2 } }])
    assert.deepStrictEqual(properties, { x: 1, y: 2 })
  })

  it('should get onCommands and commands', () => {
    let registry = Registry.as<extension.IExtensionRegistry>(extension.Extensions.ExtensionContribution)
    registry.registerExtension('single', {
      name: 'single',
      directory: os.tmpdir(),
      onCommands: ['a', 'b', 'cmd', undefined],
      commands: [{ command: 'cmd', title: 'title' }]
    })
    assert.ok(registry.commands.length > 0)
    assert.ok(registry.onCommands.length > 0)
    assert.strictEqual(registry.getCommandTitle('cmd'), 'title')
    assert.strictEqual(registry.getCommandTitle('not_exists'), undefined)
    registry.unregistExtension('single')
  })

  it('should get rootPatterns by fieltype', () => {
    let registry = Registry.as<extension.IExtensionRegistry>(extension.Extensions.ExtensionContribution)
    registry.registerExtension('single', {
      name: 'single',
      directory: os.tmpdir(),
      rootPatterns: [{ filetype: 'vim', patterns: ['.foo', '.bar', undefined] }]
    })
    assert.deepStrictEqual(registry.getRootPatternsByFiletype('vim'), ['.foo', '.bar'])
    assert.deepStrictEqual(registry.getRootPatternsByFiletype('ts'), [])
    registry.unregistExtension('single')
  })
})

describe('errors', () => {
  it('should return errors', () => {
    assert.match(errors.directoryNotExists('dir').message, new RegExp('dir'))
    assert.strictEqual(errors.illegalArgument('name') instanceof Error, true)
    assert.strictEqual(errors.illegalArgument() instanceof Error, true)
    assert.strictEqual(errors.shouldNotAsync('method') instanceof Error, true)
    errors.onUnexpectedError(new errors.CancellationError())
    assert.throws(() => {
      errors.onUnexpectedError(new Error('my error'))
    })
    assert.throws(() => {
      errors.onUnexpectedError('error')
    })
    errors.assert(true)
    assert.throws(() => {
      errors.assert(false)
    })
  })

  it('should check CancellationError', () => {
    let err = new Error('Canceled')
    err.name = 'Canceled'
    assert.strictEqual(errors.isCancellationError(err), true)
    assert.strictEqual(errors.shouldIgnore(err), true)
  })

  it('should check shouldIgnore', async () => {
    assert.strictEqual(errors.shouldIgnore(new errors.CancellationError()), true)
    let err = new Error('transport disconnected')
    assert.strictEqual(errors.shouldIgnore(err), true)
  })
})

describe('numbers', () => {
  it('should work with numbers', () => {
    assert.strictEqual(numbers.toNumber(undefined, 5), 5)
    assert.strictEqual(numbers.toNumber(undefined), 0)
    assert.strictEqual(numbers.toNumber(1, 5), 1)
    assert.strictEqual(numbers.clamp(1, 1, 3), 1)
    assert.strictEqual(numbers.clamp(5, 1, 3), 3)
    assert.strictEqual(numbers.rot(6, 5), 1)
  })
})

describe('strings', () => {
  it('should get byte indexes', () => {
    let bytes = strings.bytes
    let fn = bytes('abcde')
    assert.strictEqual(fn(0), 0)
    assert.strictEqual(fn(1), 1)
    assert.strictEqual(fn(8), 5)
    fn = bytes('你ab好')
    assert.strictEqual(fn(0), 0)
    assert.strictEqual(fn(1), 3)
    assert.strictEqual(fn(2), 4)
    fn = bytes('abcdefghi', 3)
    assert.strictEqual(fn(5), 3)
    fn = bytes('😘😘')
    assert.strictEqual(fn(2), 4)
    assert.strictEqual(fn(4), 8)
    fn = bytes(String.fromCharCode(0xdc02) + 'ab')
    assert.strictEqual(fn(2), 4)
  })

  it('should get byte index from utf16 index', () => {
    let testIndex = (text: string, index: number) => {
      let res = Buffer.byteLength(text.slice(0, index))
      assert.strictEqual(strings.byteIndex(text, index), res)
    }
    testIndex('abc', 2)
    testIndex('汉字abc', 2)
    testIndex('汉字abc', 4)
    testIndex('😘foo', 3)
    testIndex('', 3)
    testIndex(String.fromCharCode(0xdc02) + 'ab', 2)
  })

  it('should get byte length', () => {
    assert.strictEqual(strings.byteLength('a'), 1)
    assert.strictEqual(strings.byteLength('你'), 3)
    assert.strictEqual(strings.byteLength('a😘b'), 6)
    assert.strictEqual(strings.byteLength('a😘b', 1), 5)
    assert.strictEqual(strings.byteLength('a😘b', 3), 1)
  })

  it('should get character index from byte index', () => {
    assert.strictEqual(strings.characterIndex('ab', 0), 0)
    assert.strictEqual(strings.characterIndex('abc', 1), 1)
    assert.strictEqual(strings.characterIndex('ab', 99), 2)
    assert.strictEqual(strings.characterIndex('abc', 1), 1)
    assert.strictEqual(strings.characterIndex('ôbc', 2), 1)
    assert.strictEqual(strings.characterIndex('ô你c', 2), 1)
    assert.strictEqual(strings.characterIndex('你c', 3), 1)
    assert.strictEqual(strings.characterIndex('😘def', 4), 2)
    assert.strictEqual(strings.characterIndex('\ude18def', 3), 1)
    assert.strictEqual(strings.utf8_code2len(65537), 4)
  })

  it('should slice content by bytes', () => {
    assert.strictEqual(strings.byteSlice('你', 0, 1), '你')
    assert.strictEqual(strings.byteSlice('你', 0, 3), '你')
    assert.strictEqual(strings.byteSlice('abc你', 3, 6), '你')
    assert.strictEqual(strings.byteSlice('foo', 1), 'oo')
  })

  it('should get case', () => {
    assert.strictEqual(strings.getCase('a'.charCodeAt(0)), 1)
    assert.strictEqual(strings.getCase('A'.charCodeAt(0)), 2)
    assert.strictEqual(strings.getCase('#'.charCodeAt(0)), 0)
  })

  it('should get next word code', () => {
    function assertNext(text: string, index: number, res: [number, string] | undefined): void {
      let arr = res === undefined ? undefined : [res[0], res[1].charCodeAt(0)]
      let result = strings.getNextWord(fuzzy.getCharCodes(text), index)
      assert.deepStrictEqual(result, arr)
    }
    assertNext('abc', 0, [0, 'a'])
    assertNext('abc', 1, undefined)
    assertNext('abC', 1, [2, 'C'])
  })

  it('should get character indexes', () => {
    assert.deepStrictEqual(strings.getCharIndexes('abaca', 'a'), [0, 2, 4])
    assert.deepStrictEqual(strings.getCharIndexes('abd', 'f'), [])
  })

  it('should convert to lines', () => {
    assert.deepStrictEqual(strings.contentToLines('foo', false), ['foo'])
    assert.deepStrictEqual(strings.contentToLines('foo\n', true), ['foo'])
  })

  it('should get smartcaseIndex', () => {
    assert.strictEqual(strings.smartcaseIndex('a', 'A'), 0)
    assert.strictEqual(strings.smartcaseIndex('a', 'a'), 0)
    assert.strictEqual(strings.smartcaseIndex('ab', 'a'), -1)
    assert.strictEqual(strings.smartcaseIndex('', 'a'), 0)
    assert.strictEqual(strings.smartcaseIndex('ab', 'xaB'), 1)
    assert.strictEqual(strings.smartcaseIndex('aA', 'aaA'), 1)
    assert.strictEqual(strings.smartcaseIndex('aB', 'aaA'), -1)
    assert.strictEqual(strings.smartcaseIndex('AA', 'aaA'), -1)
    assert.strictEqual(strings.smartcaseIndex('aA', 'axdefA'), -1)
    assert.strictEqual(strings.smartcaseIndex('abC', 'aaBDefabC'), 6)
  })

  it('should convert to integer', () => {
    assert.strictEqual(strings.toErrorText('a'), 'a')
    assert.strictEqual(strings.toInteger('a'), undefined)
    assert.strictEqual(strings.toInteger('1'), 1)
  })

  it('should check highlight character', () => {
    assert.strictEqual(strings.isHighlightGroupCharCode('1'.charCodeAt(0)), true)
    assert.strictEqual(strings.isHighlightGroupCharCode('9'.charCodeAt(0)), true)
    assert.strictEqual(strings.isHighlightGroupCharCode('a'.charCodeAt(0)), true)
    assert.strictEqual(strings.isHighlightGroupCharCode('z'.charCodeAt(0)), true)
    assert.strictEqual(strings.isHighlightGroupCharCode('A'.charCodeAt(0)), true)
    assert.strictEqual(strings.isHighlightGroupCharCode('Z'.charCodeAt(0)), true)
    assert.strictEqual(strings.isHighlightGroupCharCode('.'.charCodeAt(0)), true)
    assert.strictEqual(strings.isHighlightGroupCharCode('_'.charCodeAt(0)), true)
    assert.strictEqual(strings.isHighlightGroupCharCode('@'.charCodeAt(0)), true)
    assert.strictEqual(strings.isHighlightGroupCharCode(' '.charCodeAt(0)), false)
  })

  it('should convert to text', () => {
    assert.strictEqual(strings.toText(undefined), '')
    assert.strictEqual(strings.toText(null), '')
    assert.strictEqual(strings.toText(3), '3')
  })

  it('should check isEmojiImprecise', () => {
    assert.strictEqual(strings.isEmojiImprecise(999), false)
    assert.strictEqual(strings.isEmojiImprecise(0x1F1E7), true)
    assert.strictEqual(strings.isEmojiImprecise(8987), true)
    assert.strictEqual(strings.isEmojiImprecise(128764), true)
    assert.strictEqual(strings.isEmojiImprecise(129008), true)
    assert.strictEqual(strings.isEmojiImprecise(129782), true)
    assert.strictEqual(strings.isEmojiImprecise(129535), true)
  })

  it('should get parts', () => {
    let res = strings.rangeParts('foo bar', Range.create(0, 0, 0, 4))
    assert.deepStrictEqual(res, ['', 'bar'])
    res = strings.rangeParts('foo\nbar', Range.create(0, 1, 1, 1))
    assert.deepStrictEqual(res, ['f', 'ar'])
    res = strings.rangeParts('x\nfoo\nbar\ny', Range.create(0, 1, 2, 3))
    assert.deepStrictEqual(res, ['x', '\ny'])
    res = strings.rangeParts('foo\nbar\nx', Range.create(1, 0, 1, 1))
    assert.deepStrictEqual(res, ['foo\n', 'ar\nx'])
    res = strings.rangeParts('x\nfoo\nbar\ny', Range.create(0, 1, 1, 0))
    assert.deepStrictEqual(res, ['x', 'foo\nbar\ny'])
  })

  it('should equalsIgnoreCase', () => {
    assert.strictEqual(strings.equalsIgnoreCase('', ''), true)
    assert.strictEqual(!strings.equalsIgnoreCase('', '1'), true)
    assert.strictEqual(!strings.equalsIgnoreCase('1', ''), true)
    assert.strictEqual(strings.equalsIgnoreCase('a', 'a'), true)
    assert.strictEqual(strings.equalsIgnoreCase('abc', 'Abc'), true)
    assert.strictEqual(strings.equalsIgnoreCase('abc', 'ABC'), true)
    assert.strictEqual(strings.equalsIgnoreCase('Höhenmeter', 'HÖhenmeter'), true)
    assert.strictEqual(strings.equalsIgnoreCase('ÖL', 'Öl'), true)
  })

  it('should doEqualsIgnoreCase', () => {
    assert.strictEqual(strings.doEqualsIgnoreCase('a', undefined), false)
    assert.strictEqual(strings.doEqualsIgnoreCase('a', 'b'), false)
    assert.strictEqual(strings.doEqualsIgnoreCase('你', '的'), false)
  })

  it('should find index', () => {
    assert.strictEqual(strings.indexOf('a,b,c', ',', 2), 3)
    assert.strictEqual(strings.indexOf('a,b,c', ',', 1), 1)
    assert.strictEqual(strings.indexOf('a,b,c', 't'), -1)
  })

  it('should upperFirst', () => {
    assert.strictEqual(strings.upperFirst(''), '')
    assert.strictEqual(strings.upperFirst('abC'), 'AbC')
    assert.strictEqual(strings.upperFirst(undefined), '')
  })

  it('should getUnicodeClass', () => {
    assert.strictEqual(strings.getUnicodeClass(null), 'other')
    assert.strictEqual(strings.getUnicodeClass(''), 'other')
    assert.strictEqual(strings.getUnicodeClass('\0'), 'other')
    assert.strictEqual(strings.getUnicodeClass('\x1b'), 'punctuation')
    assert.strictEqual(strings.getUnicodeClass('，'), 'punctuation')
    assert.strictEqual(strings.getUnicodeClass('你'), 'cjkideograph')
    assert.strictEqual(strings.getUnicodeClass('😘'), 'other')
    assert.strictEqual(strings.getUnicodeClass('a'), 'word')
  })
})

describe('getSymbolKind()', () => {
  it('should get symbol kind', () => {
    for (let i = 1; i <= 27; i++) {
      assert.notStrictEqual(getSymbolKind(i as SymbolKind), undefined)
    }
  })
})

describe('Is', () => {
  it('should url', () => {
    assert.strictEqual(Is.isUrl(''), false)
    assert.strictEqual(Is.isUrl(undefined), false)
    assert.strictEqual(Is.isUrl('file:1'), true)
  })

  it('should check insert replace edit', () => {
    assert.strictEqual(Is.isEditRange(null), false)
    let r = Range.create(0, 0, 0, 1)
    assert.strictEqual(Is.isEditRange(r), true)
    assert.strictEqual(Is.isEditRange({ insert: r, replace: r }), true)
  })

  it('should check command', () => {
    assert.strictEqual(Is.isCommand(undefined), false)
    assert.strictEqual(Is.isCommand({}), false)
    assert.strictEqual(Is.isCommand({ title: '', command: '' }), false)
    assert.strictEqual(Is.isCommand({ title: 'title', command: 'cmd' }), true)
  })

  it('should check array', () => {
    assert.strictEqual(Is.array(false), false)
  })

  it('should check empty object', () => {
    assert.strictEqual(Is.emptyObject(false), false)
    assert.strictEqual(Is.emptyObject({}), true)
    assert.strictEqual(Is.emptyObject({ x: 1 }), false)
  })

  it('should check typed array', () => {
    let arr = new Array(10)
    arr.fill(1)
    assert.strictEqual(Is.typedArray<Uint32Array>(arr, v => {
      return v >= 0
    }), true)
  })
})

describe('lodash', () => {
  it('should set defaults', () => {
    let res = lodash.defaults({ a: 1 }, { b: 2 }, { a: 3 }, null)
    assert.deepStrictEqual(res, { a: 1, b: 2 })
    res = lodash.defaults({}, { constructor: 'fn' })
    assert.strictEqual(res.constructor, 'fn')
  })
})

describe('color', () => {
  it('should check dark color', () => {
    assert.strictEqual(color.isDark(Color.create(0.03, 0.01, 0.01, 0)), true)
  })
})

describe('parseAnsiHighlights', () => {
  function testColorHighlight(highlight: string, hlGroup: string, markdown = true) {
    let text = `${style[highlight].open}text${style[highlight].close}`
    let res = parseAnsiHighlights(text, markdown)
    assert.ok(res.highlights.length > 0)
    let o = res.highlights.find(o => o.hlGroup == hlGroup)
    assert.notStrictEqual(o, undefined)
  }

  it('should parse foreground color', () => {
    testColorHighlight('yellow', 'CocMarkdownCode')
    testColorHighlight('blue', 'CocMarkdownLink')
    testColorHighlight('magenta', 'CocMarkdownHeader')
    testColorHighlight('green', 'CocListFgGreen')
    testColorHighlight('green', 'CocListFgGreen', false)
  })

  it('should parse background color', () => {
    let text = `${style.bgRed.open}text${style.bgRed.close}`
    let res = parseAnsiHighlights(text, false)
    assert.ok(res.highlights.length > 0)
    assert.strictEqual(res.highlights[0].hlGroup, 'CocListBgRed')
    text = '\u001b[33m\u001b[mnormal'
    res = parseAnsiHighlights(text, false)
    assert.strictEqual(res.highlights.length, 0)
  })

  it('should parse foreground and background', () => {
    let text = `${style.bgRed.open}${style.blue.open}text${style.blue.close}${style.bgRed.close}`
    let res = parseAnsiHighlights(text, true)
    assert.ok(res.highlights.length > 0)
    assert.strictEqual(res.highlights[0].hlGroup, 'CocListBlueRed')
  })

  it('should erase char', () => {
    let text = `foo\u0008bar`
    let res = parseAnsiHighlights(text, true)
    assert.strictEqual(res.line, 'fobar')
    text = `${style.bgRed.open}foo${style.bgRed.close}\u0008bar`
    res = parseAnsiHighlights(text, true)
    assert.strictEqual(res.line, 'fobar')
    text = `${style.bgRed.open}f${style.bgRed.close}\u0008bar`
    res = parseAnsiHighlights(text, true)
    assert.strictEqual(res.line, 'bar')
  })

  it('should not throw for bad control character', () => {
    let text = '\x1bafoo'
    let res = parseAnsiHighlights(text)
    assert.notStrictEqual(res.line, undefined)
    text = '\x1b[33;44mabc\x1b[33,44m'
    res = parseAnsiHighlights(text)
    assert.strictEqual(res.line, 'abc')
  })
})

describe('Arrays', () => {

  it('distinct()', () => {
    function compare(a: string): string {
      return a
    }

    assert.deepStrictEqual(arrays.distinct(['32', '4', '5'], compare), ['32', '4', '5'])
    assert.deepStrictEqual(arrays.distinct(['32', '4', '5', '4'], compare), ['32', '4', '5'])
    assert.deepStrictEqual(arrays.distinct(['32', 'constructor', '5', '1'], compare), ['32', 'constructor', '5', '1'])
    assert.deepStrictEqual(arrays.distinct(['32', 'constructor', 'proto', 'proto', 'constructor'], compare), ['32', 'constructor', 'proto'])
    assert.deepStrictEqual(arrays.distinct(['32', '4', '5', '32', '4', '5', '32', '4', '5', '5'], compare), ['32', '4', '5'])
  })

  it('tail()', () => {
    assert.strictEqual(arrays.tail([1, 2, 3]), 3)
  })

  it('intersect()', () => {
    assert.ok(!arrays.intersect([1, 2, 3], [4, 5]))
  })

  it('isFalsyOrEmpty()', () => {
    assert.ok(arrays.isFalsyOrEmpty([]))
    assert.ok(arrays.isFalsyOrEmpty(false))
    assert.ok(!arrays.isFalsyOrEmpty([1]))
  })

  it('should check intable', () => {
    assert.ok(arrays.intable(1, [[0, 1], [2, 3], [4, 5]]))
    assert.ok(arrays.intable(2, [[0, 1], [4, 6], [8, 9]]) === false)
    assert.ok(arrays.intable(5, [[0, 1], [2, 3], [4, 5]]))
    assert.ok(arrays.intable(6, [[0, 1], [2, 3], [4, 5]]) === false)
  })

  it('binarySearch()', () => {
    let comparator = (a, b) => a - b
    assert.ok(typeof arrays.binarySearch2 === 'function')
    assert.ok(arrays.binarySearch([1, 2, 3], 2, comparator) == 1)
    assert.ok(arrays.binarySearch([1, 2, 3, 4], 3, comparator) == 2)
    assert.ok(arrays.binarySearch([1, 2, 3, 4], 1, comparator) == 0)
    assert.ok(arrays.binarySearch([1, 2, 3, 4], 0.5, comparator) == -1)
    assert.ok(arrays.binarySearch([1, 2, 3, 5], 6, comparator) == -5)
  })

  it('toArray()', () => {
    assert.deepStrictEqual(arrays.toArray(1), [1])
    assert.deepStrictEqual(arrays.toArray(null), [])
    assert.deepStrictEqual(arrays.toArray(undefined), [])
    assert.deepStrictEqual(arrays.toArray([1, 2]), [1, 2])
  })

  it('findIndex()', () => {
    assert.strictEqual(arrays.findIndex([1, 2, 3, 4], 3, 1), 2)
    assert.strictEqual(arrays.findIndex([1, 2, 3, 4], 3), 2)
  })

  it('group()', () => {
    let res = arrays.group([1, 2, 3, 4, 5], 3)
    assert.deepStrictEqual(res, [[1, 2, 3], [4, 5]])
  })

  it('groupBy()', () => {
    let res = arrays.groupBy([0, 0, 3, 4], v => v != 0)
    assert.deepStrictEqual(res, [[3, 4], [0, 0]])
  })

  it('lastIndex()', () => {
    let res = arrays.lastIndex([1, 2, 3], x => x < 3)
    assert.strictEqual(res, 1)
  })

  it('flatMap()', () => {
    let objs: { [key: string]: number[] }[] = [{ x: [1, 2] }, { y: [3, 4] }, { z: [5, 6] }]
    function values(item: { [key: string]: number[] }): number[] {
      return Object.keys(item).reduce((p, c) => p.concat(item[c]), [])
    }
    let res = arrays.flatMap(objs, values)
    assert.deepStrictEqual(res, [1, 2, 3, 4, 5, 6])
  })

  it('addSortedArray()', () => {
    assert.deepStrictEqual(arrays.addSortedArray('a', ['d', 'e']), ['a', 'd', 'e'])
    assert.deepStrictEqual(arrays.addSortedArray('f', ['d', 'e']), ['d', 'e', 'f'])
    assert.deepStrictEqual(arrays.addSortedArray('d', ['d', 'e']), ['d', 'e'])
    assert.deepStrictEqual(arrays.addSortedArray('e', ['d', 'f']), ['d', 'e', 'f'])
  })
})

describe('Position', () => {
  function addPosition(position: Position, line: number, character: number): Position {
    return Position.create(position.line + line, position.character + character)
  }

  test('samePosition', () => {
    let pos = Position.create(0, 0)
    assert.strictEqual(positions.samePosition(pos, Position.create(0, 0)), true)
  })

  test('adjacentPosition', () => {
    let pos = Position.create(0, 0)
    assert.strictEqual(positions.adjacentPosition(pos, Range.create(0, 0, 0, 1)), true)
    assert.strictEqual(positions.adjacentPosition(pos, Range.create(1, 0, 1, 1)), false)
    pos = Position.create(1, 1)
    assert.strictEqual(positions.adjacentPosition(pos, Range.create(1, 0, 1, 1)), true)
  })

  test('equalsRange', () => {
    let r = Range.create(0, 0, 0, 1)
    assert.strictEqual(positions.equalsRange(r, r), true)
    assert.strictEqual(positions.equalsRange(r, Range.create(0, 1, 0, 1)), false)
  })

  test('compareRangesUsingStarts', () => {
    let pos = Position.create(3, 3)
    let range = Range.create(pos, pos)
    const r = (a, b, c, d) => {
      return Range.create(a, b, c, d)
    }
    assert.strictEqual(positions.compareRangesUsingStarts(range, range), 0)
    assert.ok(positions.compareRangesUsingStarts(r(1, 1, 1, 1), range) < 0)
    assert.ok(positions.compareRangesUsingStarts(r(3, 3, 3, 4), range) > 0)
    assert.ok(positions.compareRangesUsingStarts(r(4, 0, 4, 1), range) > 0)
    assert.ok(positions.compareRangesUsingStarts(r(3, 3, 4, 1), range) > 0)
  })

  test('adjustRangePosition', () => {
    let pos = Position.create(3, 3)
    assert.deepStrictEqual(positions.adjustRangePosition(Range.create(0, 0, 1, 0), pos), Range.create(3, 3, 4, 0))
  })

  test('rangeInRange', () => {
    let pos = Position.create(0, 0)
    let r = Range.create(pos, pos)
    assert.strictEqual(positions.rangeInRange(r, r), true)
    assert.strictEqual(positions.rangeInRange(r, Range.create(addPosition(pos, 1, 0), pos)), false)
    assert.strictEqual(positions.rangeInRange(Range.create(0, 1, 0, 1), Range.create(0, 0, 0, 1)), true)
  })

  test('rangeOverlap', () => {
    let r = Range.create(0, 0, 0, 0)
    assert.strictEqual(positions.rangeOverlap(r, Range.create(0, 0, 0, 0)), false)
    assert.strictEqual(positions.rangeOverlap(Range.create(0, 0, 0, 10), Range.create(0, 1, 0, 2)), true)
    assert.strictEqual(positions.rangeOverlap(Range.create(0, 0, 0, 1), Range.create(0, 1, 0, 2)), false)
    assert.strictEqual(positions.rangeOverlap(Range.create(0, 1, 0, 2), Range.create(0, 0, 0, 1)), false)
    assert.strictEqual(positions.rangeOverlap(Range.create(0, 0, 0, 1), Range.create(0, 2, 0, 3)), false)
  })

  test('rangeAdjacent', () => {
    let r = Range.create(1, 1, 1, 2)
    assert.strictEqual(positions.rangeAdjacent(r, Range.create(0, 0, 0, 0)), false)
    assert.strictEqual(positions.rangeAdjacent(r, Range.create(1, 1, 1, 3)), false)
    assert.strictEqual(positions.rangeAdjacent(r, Range.create(0, 0, 1, 1)), true)
    assert.strictEqual(positions.rangeAdjacent(r, Range.create(1, 2, 1, 4)), true)
  })

  test('positionInRange', () => {
    let pos = Position.create(0, 0)
    let r = Range.create(pos, pos)
    assert.strictEqual(positions.positionInRange(pos, r), 0)
    pos = Position.create(0, 1)
    r = Range.create(0, 0, 0, 3)
    assert.strictEqual(positions.positionInRange(pos, r), 0)
  })

  test('comparePosition', () => {
    let pos = Position.create(0, 0)
    assert.strictEqual(positions.comparePosition(pos, pos), 0)
  })

  test('should get start end position by content', () => {
    assert.deepStrictEqual(positions.getEnd(Position.create(0, 0), 'foo'), { line: 0, character: 3 })
    assert.deepStrictEqual(positions.getEnd(Position.create(0, 1), 'foo\nbar'), { line: 1, character: 3 })
  })

  test('isSingleLine', () => {
    let pos = Position.create(0, 0)
    let r = Range.create(pos, pos)
    assert.strictEqual(positions.isSingleLine(r), true)
  })

  test('toValidRange', () => {
    assert.deepStrictEqual(positions.toValidRange(Range.create(1, 0, 0, 1)), Range.create(0, 1, 1, 0))
    assert.deepStrictEqual(positions.toValidRange({
      start: { line: -1, character: -1 },
      end: { line: -1, character: -1 },
    }), Range.create(0, 0, 0, 0))
  })

})

describe('utility', () => {

  it('should not throw for invalid ms', async () => {
    await wait(-1)
  })

  it('should disposeAll', () => {
    disposeAll([undefined, undefined])
  })

  it('should wait with token', async () => {
    let res = await waitWithToken(1, CancellationToken.None)
    assert.strictEqual(res, false)
    let tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    let p = waitWithToken(200, token)
    await wait(20)
    tokenSource.cancel()
    res = await p
    assert.strictEqual(res, true)
    res = await waitWithToken(10, CancellationToken.Cancelled)
    assert.strictEqual(res, true)
    res = await waitWithToken(0, CancellationToken.None)
    assert.strictEqual(res, true)
  })

  it('should check executable', () => {
    let res = executable('command_not_exists')
    assert.strictEqual(res, false)
  })

  it('should check isRunning', t => {
    assert.strictEqual(isRunning(process.pid), true)
    t.mock.method(process, 'kill', () => {
      let e = new Error() as any
      e.code = 'EPERM'
      throw e
    })
    assert.strictEqual(isRunning(process.pid), true)
  })

  it('should run command on windows', async () => {
    await runCommand('echo 1')
    await runCommand('echo 1', { cwd: import.meta.dirname }, 1, true)
  })

  it('should run command with timeout', async () => {
    await assert.rejects(runCommand('sleep 2', { cwd: import.meta.dirname }, 0.01), errors.CancellationError)
  })

  it('should run command with Cancellation token', async () => {
    let tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    setTimeout(() => {
      tokenSource.cancel()
    }, 20)
    await assert.rejects(runCommand('sleep 2', { cwd: import.meta.dirname, encoding: 'unknown' }, token), errors.CancellationError)
  })

  it('should run command with encoding support', async () => {
    let res = await runCommand('echo "\\xc4\\xe3\\x0a"', { cwd: import.meta.dirname, encoding: 'cp936' }, 1, true)
    assert.ok(res.length > 0)
  })

  it('should throw on command error', async () => {
    await assert.rejects(runCommand('command_not_exists', { cwd: import.meta.dirname }), Error)
  })

  it('should resolve concurrent with empty task', async t => {
    let fn = t.mock.fn()
    await concurrent([], fn, 3)
    assert.strictEqual(fn.mock.callCount(), 0)
  })

  it('should run concurrent', async () => {
    let res: number[] = []
    let fn = (n: number): Promise<void> => {
      return new Promise(resolve => {
        setTimeout(() => {
          res.push(n)
          resolve()
        }, n * 10)
      })
    }
    let arr = [5, 4, 3, 6, 8]
    let ts = Date.now()
    await concurrent(arr, fn, 3)
    let dt = Date.now() - ts
    assert.ok(dt >= 100)
    assert.deepStrictEqual(res, [3, 4, 5, 6, 8])
  })

  it('should delay function #1', () => {
    let times = 0
    let fn = () => {
      times++
    }
    let delied = delay(fn, 50)
    delied()
    delied(100)
    assert.strictEqual(times, 0)
    delied.clear()
  })

  it('should delay function #2', async () => {
    let times = 0
    let fn = () => {
      times++
    }
    let delied = delay(fn, 50)
    delied(100)
    delied(10)
    await waitValue(() => times, 1)
    assert.strictEqual(times, 1)
  })
})

describe('fuzzy match test', () => {
  it('should be fuzzy match', () => {
    let needle = 'aBc'
    let codes = fuzzy.getCharCodes(needle)
    assert.ok(!fuzzy.fuzzyMatch(codes, 'abc'))
    assert.ok(!fuzzy.fuzzyMatch(codes, 'ab'))
    assert.ok(!fuzzy.fuzzyMatch(codes, 'addbdd'))
    assert.ok(fuzzy.fuzzyMatch(codes, 'abbbBc'))
    assert.ok(fuzzy.fuzzyMatch(codes, 'daBc'))
    assert.ok(fuzzy.fuzzyMatch(codes, 'ABCz'))
    assert.ok(!fuzzy.fuzzyMatch(codes, 'axy'))
  })

  it('should be fuzzy for character', () => {
    assert.ok(fuzzy.fuzzyChar('a', 'a'))
    assert.ok(fuzzy.fuzzyChar('a', 'A'))
    assert.ok(fuzzy.fuzzyChar('z', 'z'))
    assert.ok(fuzzy.fuzzyChar('z', 'Z'))
    assert.ok(!fuzzy.fuzzyChar('A', 'a'))
    assert.ok(fuzzy.fuzzyChar('A', 'A'))
    assert.ok(!fuzzy.fuzzyChar('Z', 'z'))
    assert.ok(fuzzy.fuzzyChar('Z', 'Z'))
    assert.ok(fuzzy.fuzzyChar('Z', 'z', true))
    assert.ok(fuzzy.fuzzyChar('i', 'İ'))
    assert.ok(!fuzzy.fuzzyChar('a', 'İ'))
    assert.ok(fuzzy.fuzzyChar('i', 'İ', true))
    assert.ok(!fuzzy.fuzzyChar('İ', 'i'))
    assert.ok(fuzzy.fuzzyChar('İ', 'i', true))
    assert.ok(fuzzy.fuzzyChar('Ᾰ', 'ᾰ', true))
    assert.ok(fuzzy.fuzzyChar('ᾰ', 'Ᾰ'))
  })
})

describe('object test', () => {
  it('mixin should recursive', () => {
    let res = objects.mixin({ a: { b: 1 } }, { a: { c: 2 }, d: 3 })
    assert.strictEqual(res.a.b, 1)
    assert.strictEqual(res.a.c, 2)
    assert.strictEqual(res.d, 3)
    res = objects.mixin({}, true)
    assert.deepStrictEqual(res, {})
    res = objects.mixin({ x: 1 }, { x: 2 }, false)
    assert.deepStrictEqual(res, { x: 1 })
    res = objects.mixin(Date, {})
    assert.deepStrictEqual(res, {})
    res = objects.mixin({ x: 3, y: new Date() }, { y: 4 }, true)
    assert.deepStrictEqual(res, { x: 3, y: 4 })
  })

  it('should deep clone', () => {
    let re = new RegExp('a', 'g')
    assert.strictEqual(objects.deepClone(re), re)
  })

  it('should change to readonly', () => {
    let obj = { x: 1 }
    let res = objects.toReadonly(obj)
    let fn = () => {
      res.x = 3
    }
    assert.throws(fn)
  })

  it('should not deep freeze', () => {
    objects.deepFreeze(false)
    objects.deepFreeze(true)
  })

  it('should check equals', () => {
    assert.strictEqual(objects.equals(false, 1), false)
    assert.strictEqual(objects.equals([1], {}), false)
    assert.strictEqual(objects.equals([1, 2], [1, 3]), false)
  })

  it('should check empty object', () => {
    assert.strictEqual(objects.isEmpty({}), true)
    assert.strictEqual(objects.isEmpty([]), true)
    assert.strictEqual(objects.isEmpty(null), true)
    assert.strictEqual(objects.isEmpty({ x: 1 }), false)
  })

  it('should omit null and undefined properties', () => {
    assert.deepStrictEqual(objects.omitNullUndefined({ a: 1, b: null, c: undefined, d: "text" }), { a: 1, d: 'text' })
  })

  it('should deepIterate', () => {
    let obj = {
      x: 1,
      $ref: '#1',
      items: [{
        obj: [{
          y: 2,
          $ref: '#2'
        }, 4]
      }, {
        $ref: '#3'
      }]
    }
    let vals: string[] = []
    objects.deepIterate(obj, (obj, key) => {
      if (key === '$ref') {
        vals.push(obj[key])
      }
    })
    assert.deepStrictEqual(vals, ['#1', '#2', '#3'])
  })
})

describe('ansiparse', () => {
  it('ansiparse #1', () => {
    let str = '\u001b[33mText\u001b[mnormal'
    let res = ansiparse(str)
    assert.deepStrictEqual(res, [{
      foreground: 'yellow', text: 'Text'
    }, {
      text: 'normal'
    }])
  })

  it('ansiparse #2', () => {
    let str = '\u001b[33m\u001b[mText'
    let res = ansiparse(str)
    assert.deepStrictEqual(res, [
      { foreground: 'yellow', text: '' },
      { text: 'Text' }])
  })

  it('ansiparse #3', () => {
    let str = 'this.\u001b[0m\u001b[31m\u001b[1mhistory\u001b[0m.add()'
    let res = ansiparse(str)
    assert.deepStrictEqual(res[1], {
      foreground: 'red',
      bold: true, text: 'history'
    })
  })
})

describe('Mutex', () => {
  it('mutex run in serial', async () => {
    let lastTs: number
    let fn = () => new Promise<void>(resolve => {
      if (lastTs) {
        let dt = Date.now() - lastTs
        assert.ok(dt >= 2)
      }
      lastTs = Date.now()
      setTimeout(() => {
        resolve()
      }, 3)
    })
    let mutex = new Mutex()
    await Promise.all([
      mutex.use(fn),
      mutex.use(fn),
      mutex.use(fn)
    ])
  })

  it('mutex run after job finish', async () => {
    let count = 0
    let fn = () => new Promise<void>(resolve => {
      count = count + 1
      setTimeout(() => {
        resolve()
      }, 10)
    })
    let mutex = new Mutex()
    await mutex.use(fn)
    await wait(20)
    await mutex.use(fn)
    assert.strictEqual(count, 2)
  })

  it('should release on reject', async () => {
    let mutex = new Mutex()
    let err
    try {
      await mutex.use(() => {
        return Promise.reject(new Error('err'))
      })
    } catch (e) {
      err = e
    }
    assert.notStrictEqual(err, undefined)
    assert.strictEqual(mutex.busy, false)
  })
})

describe('Sequence', () => {
  it('should run sequence', async () => {
    let s = new Sequence()
    let res: number[] = []
    s.run(async () => {
      await wait(20)
      res.push(0)
    })
    s.run(async () => {
      await wait(20)
      res.push(1)
    })
    s.run(async () => {
      await wait(20)
      res.push(2)
    })
    await s.waitFinish()
    assert.deepStrictEqual(res, [0, 1, 2])
  })

  it('should cancel sequence', async () => {
    let s = new Sequence()
    let res: number[] = []
    s.run(async () => {
      await wait(20)
      res.push(0)
    })
    s.run(async () => {
      await wait(20)
      res.push(1)
    })
    s.cancel()
    await s.waitFinish()
    assert.deepStrictEqual(res, [])
  })
})

describe('terminate', () => {
  it('should terminate process', async () => {
    let cwd = process.cwd()
    let child = spawn('sleep', ['3'], { cwd, detached: true })
    let res = terminate(child, cwd)
    assert.strictEqual(res, true)
    await waitValue(() => {
      return child.connected
    }, false)
    terminate(child, cwd)
    terminate({ killed: true } as any, cwd)
  })

  it('should terminate on other platform', t => {
    let child = spawn('ls', [], { detached: true })
    let res = terminate(child, process.cwd(), platform.Platform.Windows)
    assert.strictEqual(res, false)
    res = terminate(child, undefined, platform.Platform.Windows)
    assert.strictEqual(res, false)
    res = terminate(child, process.cwd(), platform.Platform.Unknown)
    assert.strictEqual(res, true)
    t.mock.method(cp, 'execFileSync', () => {
      return undefined
    })
    child = spawn('ls', [], { detached: true })
    res = terminate(child, process.cwd(), platform.Platform.Windows)
    assert.strictEqual(res, true)
    t.mock.method(cp, 'spawnSync', () => {
      throw new Error('bad')
    })
    child = spawn('ls', [], { detached: true })
    res = terminate(child, process.cwd(), platform.Platform.Linux)
    assert.strictEqual(res, false)
    t.mock.method(cp, 'spawnSync', () => {
      return { error: new Error('bad') } as any
    })
    child = spawn('ls', [], { detached: true })
    res = terminate(child, process.cwd(), platform.Platform.Linux)
    assert.strictEqual(res, false)
  })
})

describe('diff', () => {
  describe('diff lines', () => {
    function diffLines(oldStr: string, newStr: string): diff.ChangedLines {
      let oldLines = oldStr.split('\n')
      return diff.diffLines(oldLines, newStr.split('\n'), oldLines.length - 2)
    }

    it('should consider new line insert on insert mode', async () => {
      let res = diff.getTextEdit(['abc', ''], ['abc', '', ''], Position.create(1, 0), true)
      assert.deepStrictEqual(res, toEdit(0, 3, 0, 3, '\n'))
    })

    it('should get textedit without cursor', () => {
      let res = diff.getTextEdit(['a', 'b'], ['a', 'b'])
      assert.strictEqual(res, undefined)
      res = diff.getTextEdit(['a', 'b'], ['a', 'b'], Position.create(0, 0))
      assert.strictEqual(res, undefined)
      res = diff.getTextEdit(['a', 'b'], ['a', 'b', 'c'])
      assert.deepStrictEqual(res, toEdit(2, 0, 2, 0, 'c\n'))
      res = diff.getTextEdit(['a', 'b', 'c'], ['a'])
      assert.deepStrictEqual(res, toEdit(1, 0, 3, 0, ''))
      res = diff.getTextEdit(['a', 'b'], ['a', 'd'])
      assert.deepStrictEqual(res, toEdit(1, 0, 1, 1, 'd'))
      res = diff.getTextEdit(['a', 'b'], ['a', 'd', 'e'])
      assert.deepStrictEqual(res, toEdit(1, 0, 1, 1, 'd\ne'))
      res = diff.getTextEdit(['a', 'b', 'e'], ['a', 'd', 'e'])
      assert.deepStrictEqual(res, toEdit(1, 0, 1, 1, 'd'))
      res = diff.getTextEdit(['a', 'b', 'e'], ['e'])
      assert.deepStrictEqual(res, toEdit(0, 0, 2, 0, ''))
      res = diff.getTextEdit(['a', 'b', 'e'], ['d', 'c', 'a', 'b', 'e'])
      assert.deepStrictEqual(res, toEdit(0, 0, 0, 0, 'd\nc\n'))
      res = diff.getTextEdit(['a', 'b'], ['a', 'b', ''])
      assert.deepStrictEqual(res, toEdit(2, 0, 2, 0, '\n'))
      res = diff.getTextEdit(['a', 'b'], ['a', 'b', '', ''])
      assert.deepStrictEqual(res, toEdit(2, 0, 2, 0, '\n\n'))
    })

    it('should reduceTextEdit', () => {
      let res = diff.reduceReplaceEdit(TextEdit.replace(Range.create(0, 0, 3, 1), 'abd'), 'a\nb\nc\nd', Position.create(0, 1))
      assert.deepStrictEqual(res, TextEdit.replace(Range.create(0, 1, 3, 0), 'b'))
      res = diff.reduceReplaceEdit(TextEdit.replace(Range.create(3, 1, 3, 9), ' '.repeat(5)), ' '.repeat(8), Position.create(3, 3))
      assert.deepStrictEqual(res, TextEdit.replace(Range.create(3, 3, 3, 6), ''))
      res = diff.reduceReplaceEdit(TextEdit.replace(Range.create(3, 1, 3, 4), ' '.repeat(5)), ' '.repeat(3), Position.create(3, 3))
      assert.deepStrictEqual(res, TextEdit.replace(Range.create(3, 1, 3, 1), '  '))
      res = diff.reduceReplaceEdit(TextEdit.replace(Range.create(3, 1, 3, 4), 'x'.repeat(5)), ' '.repeat(3), Position.create(3, 3))
      assert.deepStrictEqual(res, TextEdit.replace(Range.create(3, 1, 3, 4), 'x'.repeat(5)))
      res = diff.reduceReplaceEdit(TextEdit.replace(Range.create(1, 0, 2, 0), 'd\n'), 'b\n')
      assert.deepStrictEqual(res, TextEdit.replace(Range.create(1, 0, 1, 1), 'd'))
    })

    it('should get textedit for single line change', () => {
      let res = diff.getTextEdit(['foo', 'c'], ['', 'c'], Position.create(0, 0), false)
      assert.deepStrictEqual(res, toEdit(0, 0, 0, 3, ''))
      res = diff.getTextEdit([''], ['foo'], Position.create(0, 0), false)
      assert.deepStrictEqual(res, toEdit(0, 0, 0, 0, 'foo'))
      res = diff.getTextEdit(['foo bar'], ['foo r'], Position.create(0, 4), false)
      assert.deepStrictEqual(res, toEdit(0, 4, 0, 6, ''))
      res = diff.getTextEdit(['f'], ['foo f'], Position.create(0, 0), false)
      assert.deepStrictEqual(res, toEdit(0, 0, 0, 0, 'foo '))
      res = diff.getTextEdit([' foo '], [' bar '], Position.create(0, 0), false)
      assert.deepStrictEqual(res, toEdit(0, 1, 0, 4, 'bar'))
      res = diff.getTextEdit(['foo'], ['bar'], Position.create(0, 0), true)
      assert.deepStrictEqual(res, toEdit(0, 0, 0, 3, 'bar'))
      res = diff.getTextEdit(['aa'], ['aaaa'], Position.create(0, 1), true)
      assert.deepStrictEqual(res, toEdit(0, 0, 0, 0, 'aa'))
    })

    it('should diff changed lines', () => {
      let res = diffLines('a\n', 'b\n')
      assert.deepStrictEqual(res, { start: 0, end: 1, replacement: ['b'] })
      res = diff.diffLines(['a', 'b'], ['c', 'd', 'a', 'b'], -1)
      assert.deepStrictEqual(res, { start: 0, end: 0, replacement: ['c', 'd'] })
    })

    it('should diff added lines', () => {
      let res = diffLines('a\n', 'a\nb\n')
      assert.deepStrictEqual(res, {
        start: 1,
        end: 1,
        replacement: ['b']
      })
    })

    it('should diff remove lines', () => {
      let res = diffLines('a\n\n', 'a\n')
      assert.deepStrictEqual(res, {
        start: 1,
        end: 2,
        replacement: []
      })
    })

    it('should diff remove multiple lines', () => {
      let res = diffLines('a\n\n\n', 'a\n')
      assert.deepStrictEqual(res, {
        start: 1,
        end: 3,
        replacement: []
      })
    })

    it('should diff removed line', () => {
      let res = diffLines('a\n\n\nb', 'a\n\nb')
      assert.deepStrictEqual(res, {
        start: 2,
        end: 3,
        replacement: []
      })
    })

    it('should reduce changed lines', () => {
      let res = diff.diffLines(['a', 'b', 'c'], ['a', 'b', 'c', 'd'], 0)
      assert.deepStrictEqual(res, {
        start: 3,
        end: 3,
        replacement: ['d']
      })
    })
  })

  describe('get common prefix & suffix', () => {
    it('should getCommonPrefixLen', () => {
      assert.strictEqual(diff.getCommonPrefixLen('aa', 'abc', 0), 0)
      assert.strictEqual(diff.getCommonPrefixLen(' '.repeat(5), ' '.repeat(10), 4), 4)
      assert.strictEqual(diff.getCommonPrefixLen('xy', 'dy', 2), 0)
    })

    it('should getCommonSuffixLen', () => {
      assert.strictEqual(diff.getCommonSuffixLen('aa', 'aa', 0), 0)
      assert.strictEqual(diff.getCommonSuffixLen('aa', 'ab', 2), 0)
      assert.strictEqual(diff.getCommonSuffixLen(' '.repeat(3), ' '.repeat(5), 2), 2)
    })
  })

  describe('patch line', () => {
    it('should patch line', () => {
      let res = diff.patchLine('foo', 'bar foo bar')
      assert.strictEqual(res.length, 7)
      assert.strictEqual(res, '    foo')
      res = diff.patchLine('foo', 'foo')
      assert.strictEqual(res, 'foo')
      res = diff.patchLine('foo', 'oo')
      assert.strictEqual(res, 'oo')
    })
  })

  function mockElapsedTime(t: any): any {
    let now = 0
    return t.mock.method(Date, 'now', () => {
      now += 20
      return now
    })
  }

  describe('async', () => {
    it('should do filter', async t => {
      await filter([], () => true, () => {})
      await filter([{ label: 'a' }, { label: 'b' }, { label: 'c' }], v => {
        return { code: v.label.charCodeAt(0) }
      }, (items, done) => {
        assert.strictEqual(items.length, 3)
        assert.strictEqual(done, true)
      })
      let n = 0
      let res: string[] = []
      let finished: boolean
      mockElapsedTime(t)
      await filter<string>(['a', 'b', 'c'], () => true, (items, done) => {
        n++
        res.push(...items)
        finished = done
      })
      assert.strictEqual(n, 3)
      assert.deepStrictEqual(res, ['a', 'b', 'c'])
      assert.deepStrictEqual(finished, true)
    })

    it('should cancel filter when possible', async t => {
      let tokenSource = new CancellationTokenSource()
      let token = tokenSource.token
      process.nextTick(() => {
        tokenSource.cancel()
      })
      mockElapsedTime(t)
      await filter([1, 2, 3], () => true, (_, done) => {
        assert.ok(!done)
      }, token)
    })

    it('should perform async forEach', async t => {
      await forEach([], () => {})
      let res = []
      await forEach([1, 2], x => res.push(x))
      assert.deepStrictEqual(res, [1, 2])
      const items = [1, 2, 3]
      mockElapsedTime(t)
      let result = []
      let yielded = t.mock.fn()
      await forEach(items, item => result.push(item), undefined, { yieldCallback: yielded })
      assert.deepStrictEqual(result, items)
      assert.ok(yielded.mock.callCount() > 0)
      // it should cancel with callback called.
      let tokenSource = new CancellationTokenSource()
      let token = tokenSource.token
      let called = false
      let cb = () => {
        tokenSource.cancel()
        called = true
      }
      result = []
      await forEach(items, item => result.push(item), token, { yieldCallback: cb })
      assert.strictEqual(called, true)
      assert.ok(result.length < items.length)
    })

    it('should map with empty array should return empty array', async () => {
      const result = await map([], x => x * 2)
      assert.deepStrictEqual(result, [])
    })

    it('should map correct transform items', async t => {
      mockElapsedTime(t)
      const result = await map([1, 2, 3], item => item * 2)
      assert.deepStrictEqual(result, [2, 4, 6])
    })

    it('should map yieldCallback when yielding', async t => {
      const items = [1, 2, 3]
      let tokenSource = new CancellationTokenSource()
      let token = tokenSource.token
      let called = false
      let cb = () => {
        tokenSource.cancel()
        called = true
      }
      mockElapsedTime(t)
      const options: YieldOptions = { yieldCallback: cb }
      await map(items, item => item * 2, token, options)
      assert.strictEqual(called, true)
    })

    it('should cancel on map', async t => {
      const items = [1, 2, 3]
      let tokenSource = new CancellationTokenSource()
      let token = tokenSource.token
      process.nextTick(() => {
        tokenSource.cancel()
      }, 0)
      mockElapsedTime(t)
      let res: number[] = await map(items, item => item * 2, token)
      assert.strictEqual(res[res.length - 1], undefined)
    })
  })

  describe('timing', () => {
    it('should trace', async () => {
      let t = createTiming('name', 1)
      t.start()
      t.start('label')
      await wait(20)
      t.stop()
      t.start()
      t.stop()
    })

    it('should no timeout', () => {
      let t = createTiming('name')
      t.start()
      t.stop()
    })
  })
})
