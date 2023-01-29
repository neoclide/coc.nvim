import style from 'ansi-styles'
import * as assert from 'assert'
import cp, { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { v4 as uuid } from 'uuid'
import vm from 'vm'
import { AnnotatedTextEdit, CancellationToken, CancellationTokenSource, ChangeAnnotation, Color, Position, Range, SymbolKind, TextDocumentEdit, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol'
import { ConfigurationScope } from '../../configuration/types'
import { LinesTextDocument } from '../../model/textdocument'
import { DocumentChange } from '../../types'
import { concurrent, delay, disposeAll, wait, waitWithToken } from '../../util'
import { ansiparse, parseAnsiHighlights } from '../../util/ansiparse'
import * as arrays from '../../util/array'
import { filter } from '../../util/async'
import * as color from '../../util/color'
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
import helper from '../helper'

function createTextDocument(lines: string[]): LinesTextDocument {
  return new LinesTextDocument('file://a', 'txt', 1, lines, 1, true)
}

function toEdit(sl, sc, el, ec, text): TextEdit {
  return TextEdit.replace(Range.create(sl, sc, el, ec), text)
}

let logfile = path.join(os.tmpdir(), 'log_test.js')
beforeAll(() => {
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

afterAll(() => {
  fs.unlinkSync(logfile)
})

describe('factory', () => {
  afterAll(() => {
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

  it('should create logger', () => {
    let fn = jest.fn()
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
    expect(fn).toBeCalledTimes(5)
  })

  it('should not throw process.chdir', () => {
    const sandbox = factory.createSandbox(logfile, emptyLogger)
    let res = vm.runInContext(`process.chdir()`, sandbox)
    expect(res).toBeUndefined()
  })

  it('should throw with umask', () => {
    const sandbox = factory.createSandbox(logfile, emptyLogger)
    let res = vm.runInContext(`process.umask()`, sandbox)
    expect(typeof res).toBe('number')
    let err
    try {
      res = vm.runInContext(`process.umask(18)`, sandbox)
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })

  it('should throw with process.exit', () => {
    const sandbox = factory.createSandbox(logfile, emptyLogger)
    let err
    try {
      vm.runInContext(`process.exit()`, sandbox)
    } catch (e) {
      err = e
    }
    expect(err).toBeDefined()
  })

  it('should get module prototype', () => {
    const Module = require('module')
    expect(factory.getProtoWithCompile(Module as any)).toBeDefined()
    function fn() {}
    expect(() => {
      factory.getProtoWithCompile(fn)
    }).toThrow(Error)
    fn.prototype._compile = () => {}
    expect(factory.getProtoWithCompile(fn)).toBeDefined()
  })

  it('should hook require', () => {
    const sandbox = factory.createSandbox(logfile, factory.consoleLogger, 'hook', false)
    let fn = factory.compileInSandbox(sandbox, { wait() {} })
    let obj: any = {}
    fn.apply(obj, [`const {wait} = require('coc.nvim')\nmodule.exports = wait`, logfile])
    expect(typeof obj.exports).toBe('function')
  })

  it('should createSandbox', () => {
    const Module = require('module')
    const sandbox = factory.createSandbox(logfile, emptyLogger, 'hook', false)
    delete Module._cache[require.resolve(logfile)]
    let exports = sandbox.require(logfile)
    expect(typeof exports).toBe('function')
    let obj = exports()
    expect(typeof obj.wait).toBe('function')
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
    expect(exports).toEqual({ y: 1 })
    fs.rmSync(filename, { force: true })
  })

  it('should create extension', () => {
    global.__TEST__ = false
    let filename = path.join(os.tmpdir(), 'hash.js')
    fs.writeFileSync(filename, `#! /usr/bin/env node
    module.exports = function(){
      return {fs: require("fs"), resolved: require.resolve('fs')}
    }`, 'utf8')
    let exp = factory.createExtension('hash', filename, false) as any
    let res = exp.activate()
    expect(res.fs).toBeDefined()
    expect(res.resolved).toBe('fs')
    fs.rmSync(filename, { force: true })
  })
})

describe('platform', () => {
  it('should get platform', () => {
    expect(platform.getPlatform({ platform: 'win32' } as any)).toBe(platform.Platform.Windows)
    expect(platform.getPlatform({ platform: 'darwin' } as any)).toBe(platform.Platform.Mac)
    expect(platform.getPlatform({ platform: 'linux' } as any)).toBe(platform.Platform.Linux)
    expect(platform.getPlatform({ platform: 'unknown' } as any)).toBe(platform.Platform.Unknown)
  })

  it('should check platform', () => {
    expect(platform.isWeb).toBeDefined()
    expect(platform.isLinux).toBeDefined()
    expect(platform.isNative).toBeDefined()
    expect(platform.isWindows).toBeDefined()
    expect(platform.isMacintosh).toBeDefined()
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
      expect(res).toEqual(Position.create(arr[0], arr[1]))
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
    expect(textedits.getChangedLineCount(pos, edits)).toBe(-2)
  })

  test('getPosition()', () => {
    let pos = Position.create(1, 3)
    const assertChange = (rl, rc, el, ec, text, val): void => {
      let edit = TextEdit.replace(Range.create(rl, rc, el, ec), text)
      let res = textedits.getPosition(pos, edit)
      expect(res).toEqual(val)
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
      expect(res).toBe(val)
    }
    assertLine(0, 0, 0, 0, 'abc\n', -1)
    assertLine(1, 0, 1, 0, 'd\n', 0)
    assertLine(0, 0, 0, 0, 'abc', 0)
  })

  test('getPositionFromEdits()', () => {
    const assertEdits = (pos, edits, exp: [number, number]) => {
      let res = textedits.getPositionFromEdits(pos, edits)
      expect(res).toEqual(Position.create(exp[0], exp[1]))
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
    expect(textedits.emptyWorkspaceEdit(workspaceEdit)).toBe(false)
    expect(textedits.emptyWorkspaceEdit({ documentChanges: [] })).toBe(true)
  })

  it('should get ranges', async () => {
    let ranges = textedits.getRangesFromEdit('test:/1', {})
    expect(ranges).toBeUndefined()
    let edit: WorkspaceEdit = { changes: { 'test:/2': [TextEdit.insert(Position.create(0, 0), ' ')] } }
    ranges = textedits.getRangesFromEdit('test:/1', edit)
    expect(ranges).toBeUndefined()
    ranges = textedits.getRangesFromEdit('test:/2', edit)
    expect(ranges).toBeDefined()
    edit = { documentChanges: [TextDocumentEdit.create({ uri: 'test:/1', version: null }, [TextEdit.insert(Position.create(0, 0), ' ')])] }
    ranges = textedits.getRangesFromEdit('test:/1', edit)
    expect(ranges).toBeDefined()
  })

  it('should get all annotation ids for confirm', () => {
    let doc = { uri: 'test:///1', version: null }
    let changes: DocumentChange[] = []
    let ids = [uuid(), uuid(), uuid()]
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
    expect(res.length).toBe(3)
  })

  it('should create filtered changes', () => {
    let doc = { uri: 'test:///1', version: null }
    let changes: DocumentChange[] = []
    let ids = [uuid(), uuid(), uuid()]
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
    expect(res.length).toBe(2)
    expect(res).toEqual([{
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
    expect(res.length).toBe(1)
  })

  it('should check edit is denied', () => {
    let ids = [uuid(), uuid()]
    let edits = [
      AnnotatedTextEdit.insert(Position.create(0, 0), 'foo', ids[0]),
      AnnotatedTextEdit.insert(Position.create(1, 0), 'bar', ids[1]),
    ]
    expect(textedits.isDeniedEdit(edits[0], [ids[0]])).toBe(true)
    expect(textedits.isDeniedEdit(edits[1], [ids[0]])).toBe(false)
  })

  it('should check empty TextEdit', () => {
    expect(textedits.emptyTextEdit(TextEdit.insert(Position.create(0, 0), ''))).toBe(true)
    expect(textedits.emptyTextEdit(TextEdit.insert(Position.create(0, 0), 'a'))).toBe(false)
  })

  it('should get well formed edit', () => {
    let r = Range.create(1, 0, 0, 0)
    let edit: TextEdit = { range: r, newText: 'foo' }
    let res = textedits.getWellformedEdit(edit)
    expect(res.range).toEqual(Range.create(0, 0, 1, 0))
    r = Range.create(0, 0, 1, 0)
    edit = { range: r, newText: 'foo' }
    res = textedits.getWellformedEdit(edit)
    expect(res.range).toBe(r)
  })

  it('should check line count change', () => {
    let r = Range.create(0, 0, 0, 5)
    let edit: TextEdit = { range: r, newText: 'foo' }
    expect(textedits.lineCountChange(edit)).toBe(0)
    edit = { range: Range.create(0, 0, 1, 0), newText: 'foo' }
    expect(textedits.lineCountChange(edit)).toBe(-1)
  })

  it('should filter and sort textedits', () => {
    let doc = createTextDocument(['foo'])
    expect(textedits.filterSortEdits(doc, [TextEdit.insert(Position.create(0, 0), 'a\r\nb')])).toEqual([
      TextEdit.insert(Position.create(0, 0), 'a\nb')
    ])
    expect(textedits.filterSortEdits(doc, [TextEdit.replace(Range.create(0, 0, 0, 3), 'foo')])).toEqual([])
    expect(textedits.filterSortEdits(doc, [
      TextEdit.insert(Position.create(0, 1), 'b'),
      TextEdit.insert(Position.create(0, 0), 'a'),
    ])).toEqual([
      TextEdit.insert(Position.create(0, 0), 'a'),
      TextEdit.insert(Position.create(0, 1), 'b'),
    ])
  })

  it('should fix edit range', () => {
    let doc = createTextDocument(['foo'])
    let range = Range.create(0, 0, 0, 5)
    let res = textedits.filterSortEdits(doc, [TextEdit.replace(range, 'bar')])
    expect(res[0].range).toEqual(Range.create(0, 0, 0, 3))
  })

  it('should merge textedits #1', () => {
    let edits = [toEdit(0, 0, 0, 0, 'foo'), toEdit(0, 1, 0, 1, 'bar')]
    let lines = ['ab']
    let res = textedits.mergeTextEdits(edits, lines, ['fooabarb'])
    expect(res).toEqual(toEdit(0, 0, 0, 1, 'fooabar'))
  })

  it('should merge textedits #2', () => {
    let edits = [toEdit(0, 0, 1, 0, 'foo\n')]
    let lines = ['bar']
    let res = textedits.mergeTextEdits(edits, lines, ['foo'])
    expect(res).toEqual(toEdit(0, 0, 1, 0, 'foo\n'))
  })

  it('should merge textedits #3', () => {
    let edits = [toEdit(0, 0, 0, 1, 'd'), toEdit(1, 0, 1, 1, 'e'), toEdit(2, 0, 3, 0, 'f\n')]
    let lines = ['a', 'b', 'c']
    let res = textedits.mergeTextEdits(edits, lines, ['d', 'e', 'f'])
    expect(res).toEqual(toEdit(0, 0, 3, 0, 'd\ne\nf\n'))
  })
})

describe('Registry', () => {
  it('should add to registry', () => {
    Registry.add('key', {})
    expect(Registry.knows('key')).toBe(true)
    expect(Registry.as('key')).toEqual({})
    expect(Registry.as('not_exists')).toBeNull()
  })

  it('should get jsonRegistry', () => {
    let r = Registry.as<IJSONContributionRegistry>(Extensions.JSONContribution)
    expect(r).toBeDefined()
    r.registerSchema('uri', {} as any)
    let res = r.getSchemaContributions()
    expect(res.schemas.uri).toBeDefined()
  })

  it('should convertProperties', () => {
    expect(convertProperties(undefined)).toEqual({})
    expect(convertProperties({ key: { type: 'number' } }, ConfigurationScope.RESOURCE)).toEqual({
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
    expect(res.foo).toBeDefined()
    expect(res.format.scope).toBe(ConfigurationScope.WINDOW)
    expect(res.bar.scope).toBe(ConfigurationScope.LANGUAGE_OVERRIDABLE)
    expect(res.resource.scope).toBe(ConfigurationScope.RESOURCE)
    expect(res.window.scope).toBe(ConfigurationScope.WINDOW)
    expect(res['coc.source.name'].scope).toBe(ConfigurationScope.APPLICATION)
    expect(res['list.source.name'].scope).toBe(ConfigurationScope.APPLICATION)
  })

  it('should parse extension name', () => {
    let parseSource = extension.parseExtensionName
    expect(parseSource(``)).toBeUndefined()
    expect(parseSource(`a)`, 0)).toBeUndefined()
    expect(parseSource(`a`, 0)).toBeUndefined()
    let registry = Registry.as<extension.IExtensionRegistry>(extension.Extensions.ExtensionContribution)
    let filepath = path.join(os.tmpdir(), 'single')
    registry.registerExtension('single', { name: 'single', directory: os.tmpdir(), filepath })
    expect(parseSource(`\n\n${filepath}:1:1`)).toBe('single')
    // expect(parseSource(`\n\n${filepath.slice(0, -3)}:1:1`)).toBeUndefined()
    expect(parseSource(`\n\n/a/b:1:1`)).toBeUndefined()
    let dir = fs.realpathSync(os.tmpdir())
    expect(parseSource(`\n\n${path.join(dir, 'foo')}:1:1`)).toBe('single')
    registry.unregistExtension('single')
  })

  it('should check rootPattern and commands', () => {
    expect(extension.validRootPattern({} as any)).toBe(false)
    expect(extension.validCommandContribution({} as any)).toBe(false)
  })

  it('should get properties', () => {
    let properties = extension.getProperties({})
    expect(properties).toEqual({})
    properties = extension.getProperties({ properties: { x: 1 } })
    expect(properties).toEqual({ x: 1 })
    properties = extension.getProperties([{ properties: { x: 1 } }, { properties: { y: 2 } }])
    expect(properties).toEqual({ x: 1, y: 2 })
  })

  it('should get onCommands and commands', () => {
    let registry = Registry.as<extension.IExtensionRegistry>(extension.Extensions.ExtensionContribution)
    registry.registerExtension('single', {
      name: 'single',
      directory: os.tmpdir(),
      onCommands: ['a', 'b', 'cmd', undefined],
      commands: [{ command: 'cmd', title: 'title' }]
    })
    expect(registry.commands.length).toBeGreaterThan(0)
    expect(registry.onCommands.length).toBeGreaterThan(0)
    expect(registry.getCommandTitle('cmd')).toBe('title')
    expect(registry.getCommandTitle('not_exists')).toBeUndefined()
    registry.unregistExtension('single')
  })

  it('should get rootPatterns by fieltype', () => {
    let registry = Registry.as<extension.IExtensionRegistry>(extension.Extensions.ExtensionContribution)
    registry.registerExtension('single', {
      name: 'single',
      directory: os.tmpdir(),
      rootPatterns: [{ filetype: 'vim', patterns: ['.foo', '.bar', undefined] }]
    })
    expect(registry.getRootPatternsByFiletype('vim')).toEqual(['.foo', '.bar'])
    expect(registry.getRootPatternsByFiletype('ts')).toEqual([])
    registry.unregistExtension('single')
  })
})

describe('errors', () => {
  it('should return errors', () => {
    expect(errors.directoryNotExists('dir').message).toMatch('dir')
    expect(errors.illegalArgument('name') instanceof Error).toBe(true)
    expect(errors.illegalArgument() instanceof Error).toBe(true)
    expect(errors.shouldNotAsync('method') instanceof Error).toBe(true)
    errors.onUnexpectedError(new errors.CancellationError())
    expect(() => {
      errors.onUnexpectedError(new Error('my error'))
    }).toThrowError()
    expect(() => {
      errors.onUnexpectedError('error')
    }).toThrowError()
    errors.assert(true)
    expect(() => {
      errors.assert(false)
    }).toThrowError()
  })

  it('should check CancellationError', () => {
    let err = new Error('Canceled')
    err.name = 'Canceled'
    expect(errors.isCancellationError(err)).toBe(true)
  })
})

describe('numbers', () => {
  it('should work with numbers', () => {
    expect(numbers.toNumber(undefined, 5)).toBe(5)
    expect(numbers.toNumber(undefined)).toBe(0)
    expect(numbers.toNumber(1, 5)).toBe(1)
    expect(numbers.clamp(1, 1, 3)).toBe(1)
    expect(numbers.clamp(5, 1, 3)).toBe(3)
    expect(numbers.rot(6, 5)).toBe(1)
  })
})

describe('strings', () => {
  it('should get byte indexes', () => {
    let bytes = strings.bytes
    let fn = bytes('abcde')
    expect(fn(0)).toBe(0)
    expect(fn(1)).toBe(1)
    expect(fn(8)).toBe(5)
    fn = bytes('你ab好')
    expect(fn(0)).toBe(0)
    expect(fn(1)).toBe(3)
    expect(fn(2)).toBe(4)
    fn = bytes('abcdefghi', 3)
    expect(fn(5)).toBe(3)
    fn = bytes('😘😘')
    expect(fn(2)).toBe(4)
    expect(fn(4)).toBe(8)
    fn = bytes(String.fromCharCode(0xdc02) + 'ab')
    expect(fn(2)).toBe(4)
  })

  it('should get byte index from utf16 index', () => {
    let testIndex = (text: string, index: number) => {
      let res = Buffer.byteLength(text.slice(0, index))
      expect(strings.byteIndex(text, index)).toBe(res)
    }
    testIndex('abc', 2)
    testIndex('汉字abc', 2)
    testIndex('汉字abc', 4)
    testIndex('😘foo', 3)
    testIndex('', 3)
    testIndex(String.fromCharCode(0xdc02) + 'ab', 2)
  })

  it('should get byte length', () => {
    expect(strings.byteLength('a')).toBe(1)
    expect(strings.byteLength('你')).toBe(3)
    expect(strings.byteLength('a😘b')).toBe(6)
    expect(strings.byteLength('a😘b', 1)).toBe(5)
    expect(strings.byteLength('a😘b', 3)).toBe(1)
  })

  it('should get character index from byte index', () => {
    expect(strings.characterIndex('ab', 0)).toBe(0)
    expect(strings.characterIndex('abc', 1)).toBe(1)
    expect(strings.characterIndex('ab', 99)).toBe(2)
    expect(strings.characterIndex('abc', 1)).toBe(1)
    expect(strings.characterIndex('ôbc', 2)).toBe(1)
    expect(strings.characterIndex('ô你c', 2)).toBe(1)
    expect(strings.characterIndex('你c', 3)).toBe(1)
    expect(strings.characterIndex('😘def', 4)).toBe(2)
    expect(strings.characterIndex('\ude18def', 3)).toBe(1)
    expect(strings.utf8_code2len(65537)).toBe(4)
  })

  it('should slice content by bytes', () => {
    expect(strings.byteSlice('你', 0, 1)).toBe('你')
    expect(strings.byteSlice('你', 0, 3)).toBe('你')
    expect(strings.byteSlice('abc你', 3, 6)).toBe('你')
    expect(strings.byteSlice('foo', 1)).toBe('oo')
  })

  it('should get case', () => {
    expect(strings.getCase('a'.charCodeAt(0))).toBe(1)
    expect(strings.getCase('A'.charCodeAt(0))).toBe(2)
    expect(strings.getCase('#'.charCodeAt(0))).toBe(0)
  })

  it('should get next word code', () => {
    function assertNext(text: string, index: number, res: [number, string] | undefined): void {
      let arr = res === undefined ? undefined : [res[0], res[1].charCodeAt(0)]
      let result = strings.getNextWord(fuzzy.getCharCodes(text), index)
      expect(result).toEqual(arr)
    }
    assertNext('abc', 0, [0, 'a'])
    assertNext('abc', 1, undefined)
    assertNext('abC', 1, [2, 'C'])
  })

  it('should get character indexes', () => {
    expect(strings.getCharIndexes('abaca', 'a')).toEqual([0, 2, 4])
    expect(strings.getCharIndexes('abd', 'f')).toEqual([])
  })

  it('should convert to lines', () => {
    expect(strings.contentToLines('foo', false)).toEqual(['foo'])
    expect(strings.contentToLines('foo\n', true)).toEqual(['foo'])
  })

  it('should get smartcaseIndex', () => {
    expect(strings.smartcaseIndex('a', 'A')).toBe(0)
    expect(strings.smartcaseIndex('a', 'a')).toBe(0)
    expect(strings.smartcaseIndex('ab', 'a')).toBe(-1)
    expect(strings.smartcaseIndex('', 'a')).toBe(0)
    expect(strings.smartcaseIndex('ab', 'xaB')).toBe(1)
    expect(strings.smartcaseIndex('aA', 'aaA')).toBe(1)
    expect(strings.smartcaseIndex('aB', 'aaA')).toBe(-1)
    expect(strings.smartcaseIndex('AA', 'aaA')).toBe(-1)
    expect(strings.smartcaseIndex('aA', 'axdefA')).toBe(-1)
    expect(strings.smartcaseIndex('abC', 'aaBDefabC')).toBe(6)
  })

  it('should convert to integer', () => {
    expect(strings.toErrorText('a')).toBe('a')
    expect(strings.toInteger('a')).toBeUndefined()
    expect(strings.toInteger('1')).toBe(1)
  })

  it('should check highlight character', () => {
    expect(strings.isHighlightGroupCharCode('1'.charCodeAt(0))).toBe(true)
    expect(strings.isHighlightGroupCharCode('9'.charCodeAt(0))).toBe(true)
    expect(strings.isHighlightGroupCharCode('a'.charCodeAt(0))).toBe(true)
    expect(strings.isHighlightGroupCharCode('z'.charCodeAt(0))).toBe(true)
    expect(strings.isHighlightGroupCharCode('A'.charCodeAt(0))).toBe(true)
    expect(strings.isHighlightGroupCharCode('Z'.charCodeAt(0))).toBe(true)
    expect(strings.isHighlightGroupCharCode('.'.charCodeAt(0))).toBe(true)
    expect(strings.isHighlightGroupCharCode('_'.charCodeAt(0))).toBe(true)
    expect(strings.isHighlightGroupCharCode('@'.charCodeAt(0))).toBe(true)
    expect(strings.isHighlightGroupCharCode(' '.charCodeAt(0))).toBe(false)
  })

  it('should convert to text', () => {
    expect(strings.toText(undefined)).toBe('')
    expect(strings.toText(null)).toBe('')
  })

  it('should check isEmojiImprecise', () => {
    expect(strings.isEmojiImprecise(999)).toBe(false)
    expect(strings.isEmojiImprecise(0x1F1E7)).toBe(true)
    expect(strings.isEmojiImprecise(8987)).toBe(true)
    expect(strings.isEmojiImprecise(128764)).toBe(true)
    expect(strings.isEmojiImprecise(129008)).toBe(true)
    expect(strings.isEmojiImprecise(129782)).toBe(true)
    expect(strings.isEmojiImprecise(129535)).toBe(true)
  })

  it('should get parts', () => {
    let res = strings.rangeParts('foo bar', Range.create(0, 0, 0, 4))
    expect(res).toEqual(['', 'bar'])
    res = strings.rangeParts('foo\nbar', Range.create(0, 1, 1, 1))
    expect(res).toEqual(['f', 'ar'])
    res = strings.rangeParts('x\nfoo\nbar\ny', Range.create(0, 1, 2, 3))
    expect(res).toEqual(['x', '\ny'])
    res = strings.rangeParts('foo\nbar\nx', Range.create(1, 0, 1, 1))
    expect(res).toEqual(['foo\n', 'ar\nx'])
    res = strings.rangeParts('x\nfoo\nbar\ny', Range.create(0, 1, 1, 0))
    expect(res).toEqual(['x', 'foo\nbar\ny'])
  })

  it('should equalsIgnoreCase', () => {
    expect(strings.equalsIgnoreCase('', '')).toBe(true)
    expect(!strings.equalsIgnoreCase('', '1')).toBe(true)
    expect(!strings.equalsIgnoreCase('1', '')).toBe(true)
    expect(strings.equalsIgnoreCase('a', 'a')).toBe(true)
    expect(strings.equalsIgnoreCase('abc', 'Abc')).toBe(true)
    expect(strings.equalsIgnoreCase('abc', 'ABC')).toBe(true)
    expect(strings.equalsIgnoreCase('Höhenmeter', 'HÖhenmeter')).toBe(true)
    expect(strings.equalsIgnoreCase('ÖL', 'Öl')).toBe(true)
  })

  it('should doEqualsIgnoreCase', () => {
    expect(strings.doEqualsIgnoreCase('a', undefined)).toBe(false)
    expect(strings.doEqualsIgnoreCase('a', 'b')).toBe(false)
    expect(strings.doEqualsIgnoreCase('你', '的')).toBe(false)
  })

  it('should find index', () => {
    expect(strings.indexOf('a,b,c', ',', 2)).toBe(3)
    expect(strings.indexOf('a,b,c', ',', 1)).toBe(1)
    expect(strings.indexOf('a,b,c', 't')).toBe(-1)
  })

  it('should upperFirst', () => {
    expect(strings.upperFirst('')).toBe('')
    expect(strings.upperFirst('abC')).toBe('AbC')
    expect(strings.upperFirst(undefined)).toBe('')
  })
})

describe('getSymbolKind()', () => {
  it('should get symbol kind', () => {
    for (let i = 1; i <= 27; i++) {
      expect(getSymbolKind(i as SymbolKind)).toBeDefined()
    }
  })
})

describe('Is', () => {
  it('should url', () => {
    expect(Is.isUrl('')).toBe(false)
    expect(Is.isUrl(undefined)).toBe(false)
    expect(Is.isUrl('file:1')).toBe(true)
  })

  it('should check command', () => {
    expect(Is.isCommand(undefined)).toBe(false)
    expect(Is.isCommand({})).toBe(false)
    expect(Is.isCommand({ title: '', command: '' })).toBe(false)
    expect(Is.isCommand({ title: 'title', command: 'cmd' })).toBe(true)
  })

  it('should check array', () => {
    expect(Is.array(false)).toBe(false)
  })

  it('should check empty object', () => {
    expect(Is.emptyObject(false)).toBe(false)
    expect(Is.emptyObject({})).toBe(true)
    expect(Is.emptyObject({ x: 1 })).toBe(false)
  })

  it('should check typed array', () => {
    let arr = new Array(10)
    arr.fill(1)
    expect(Is.typedArray<Uint32Array>(arr, v => {
      return v >= 0
    })).toBe(true)
  })
})

describe('lodash', () => {
  it('should set defaults', () => {
    let res = lodash.defaults({ a: 1 }, { b: 2 }, { a: 3 }, null)
    expect(res).toEqual({ a: 1, b: 2 })
    res = lodash.defaults({}, { constructor: 'fn' })
    expect(res.constructor).toBe('fn')
  })
})

describe('color', () => {
  it('should check dark color', () => {
    expect(color.isDark(Color.create(0.03, 0.01, 0.01, 0))).toBe(true)
  })
})

describe('parseAnsiHighlights', () => {
  function testColorHighlight(highlight: string, hlGroup: string, markdown = true) {
    let text = `${style[highlight].open}text${style[highlight].close}`
    let res = parseAnsiHighlights(text, markdown)
    expect(res.highlights.length).toBeGreaterThan(0)
    let o = res.highlights.find(o => o.hlGroup == hlGroup)
    expect(o).toBeDefined()
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
    expect(res.highlights.length).toBeGreaterThan(0)
    expect(res.highlights[0].hlGroup).toBe('CocListBgRed')
    text = '\u001b[33m\u001b[mnormal'
    res = parseAnsiHighlights(text, false)
    expect(res.highlights.length).toBe(0)
  })

  it('should parse foreground and background', () => {
    let text = `${style.bgRed.open}${style.blue.open}text${style.blue.close}${style.bgRed.close}`
    let res = parseAnsiHighlights(text, true)
    expect(res.highlights.length).toBeGreaterThan(0)
    expect(res.highlights[0].hlGroup).toBe('CocListBlueRed')
  })

  it('should erase char', () => {
    let text = `foo\u0008bar`
    let res = parseAnsiHighlights(text, true)
    expect(res.line).toBe('fobar')
    text = `${style.bgRed.open}foo${style.bgRed.close}\u0008bar`
    res = parseAnsiHighlights(text, true)
    expect(res.line).toBe('fobar')
    text = `${style.bgRed.open}f${style.bgRed.close}\u0008bar`
    res = parseAnsiHighlights(text, true)
    expect(res.line).toBe('bar')
  })

  it('should not throw for bad control character', () => {
    let text = '\x1bafoo'
    let res = parseAnsiHighlights(text)
    expect(res.line).toBeDefined()
    text = '\x1b[33;44mabc\x1b[33,44m'
    res = parseAnsiHighlights(text)
    expect(res.line).toBe('abc')
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
    expect(arrays.findIndex([1, 2, 3, 4], 3, 1)).toBe(2)
    expect(arrays.findIndex([1, 2, 3, 4], 3)).toBe(2)
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
    expect(arrays.addSortedArray('a', ['d', 'e'])).toEqual(['a', 'd', 'e'])
    expect(arrays.addSortedArray('f', ['d', 'e'])).toEqual(['d', 'e', 'f'])
    expect(arrays.addSortedArray('d', ['d', 'e'])).toEqual(['d', 'e'])
    expect(arrays.addSortedArray('e', ['d', 'f'])).toEqual(['d', 'e', 'f'])
  })
})

describe('Position', () => {
  function addPosition(position: Position, line: number, character: number): Position {
    return Position.create(position.line + line, position.character + character)
  }

  test('samePosition', () => {
    let pos = Position.create(0, 0)
    expect(positions.samePosition(pos, Position.create(0, 0))).toBe(true)
  })

  test('equalsRange', () => {
    let r = Range.create(0, 0, 0, 1)
    expect(positions.equalsRange(r, r)).toBe(true)
    expect(positions.equalsRange(r, Range.create(0, 1, 0, 1))).toBe(false)
  })

  test('compareRangesUsingStarts', () => {
    let pos = Position.create(3, 3)
    let range = Range.create(pos, pos)
    const r = (a, b, c, d) => {
      return Range.create(a, b, c, d)
    }
    expect(positions.compareRangesUsingStarts(range, range)).toBe(0)
    expect(positions.compareRangesUsingStarts(r(1, 1, 1, 1), range)).toBeLessThan(0)
    expect(positions.compareRangesUsingStarts(r(3, 3, 3, 4), range)).toBeGreaterThan(0)
    expect(positions.compareRangesUsingStarts(r(4, 0, 4, 1), range)).toBeGreaterThan(0)
    expect(positions.compareRangesUsingStarts(r(3, 3, 4, 1), range)).toBeGreaterThan(0)
  })

  test('adjustRangePosition', () => {
    let pos = Position.create(3, 3)
    expect(positions.adjustRangePosition(Range.create(0, 0, 1, 0), pos)).toEqual(Range.create(3, 3, 4, 0))
  })

  test('rangeInRange', () => {
    let pos = Position.create(0, 0)
    let r = Range.create(pos, pos)
    expect(positions.rangeInRange(r, r)).toBe(true)
    expect(positions.rangeInRange(r, Range.create(addPosition(pos, 1, 0), pos))).toBe(false)
    expect(positions.rangeInRange(Range.create(0, 1, 0, 1), Range.create(0, 0, 0, 1))).toBe(true)
  })

  test('rangeOverlap', () => {
    let r = Range.create(0, 0, 0, 0)
    expect(positions.rangeOverlap(r, Range.create(0, 0, 0, 0))).toBe(false)
    expect(positions.rangeOverlap(Range.create(0, 0, 0, 10), Range.create(0, 1, 0, 2))).toBe(true)
    expect(positions.rangeOverlap(Range.create(0, 0, 0, 1), Range.create(0, 1, 0, 2))).toBe(false)
    expect(positions.rangeOverlap(Range.create(0, 1, 0, 2), Range.create(0, 0, 0, 1))).toBe(false)
    expect(positions.rangeOverlap(Range.create(0, 0, 0, 1), Range.create(0, 2, 0, 3))).toBe(false)
  })

  test('rangeAdjacent', () => {
    let r = Range.create(1, 1, 1, 2)
    expect(positions.rangeAdjacent(r, Range.create(0, 0, 0, 0))).toBe(false)
    expect(positions.rangeAdjacent(r, Range.create(1, 1, 1, 3))).toBe(false)
    expect(positions.rangeAdjacent(r, Range.create(0, 0, 1, 1))).toBe(true)
    expect(positions.rangeAdjacent(r, Range.create(1, 2, 1, 4))).toBe(true)
  })

  test('positionInRange', () => {
    let pos = Position.create(0, 0)
    let r = Range.create(pos, pos)
    expect(positions.positionInRange(pos, r)).toBe(0)
  })

  test('comparePosition', () => {
    let pos = Position.create(0, 0)
    expect(positions.comparePosition(pos, pos)).toBe(0)
  })

  test('should get start end position by content', () => {
    expect(positions.getEnd(Position.create(0, 0), 'foo')).toEqual({ line: 0, character: 3 })
    expect(positions.getEnd(Position.create(0, 1), 'foo\nbar')).toEqual({ line: 1, character: 3 })
  })

  test('isSingleLine', () => {
    let pos = Position.create(0, 0)
    let r = Range.create(pos, pos)
    expect(positions.isSingleLine(r)).toBe(true)
  })

  test('toValidRange', () => {
    expect(positions.toValidRange(Range.create(1, 0, 0, 1))).toEqual(Range.create(0, 1, 1, 0))
    expect(positions.toValidRange({
      start: { line: -1, character: -1 },
      end: { line: -1, character: -1 },
    })).toEqual(Range.create(0, 0, 0, 0))
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
    expect(res).toBe(false)
    let tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    let p = waitWithToken(200, token)
    await wait(1)
    tokenSource.cancel()
    res = await p
    expect(res).toBe(true)
  })

  it('should check executable', () => {
    let res = executable('command_not_exists')
    expect(res).toBe(false)
  })

  it('should check isRunning', () => {
    expect(isRunning(process.pid)).toBe(true)
    let spy = jest.spyOn(process, 'kill').mockImplementation(() => {
      let e = new Error() as any
      e.code = 'EPERM'
      throw e
    })
    expect(isRunning(process.pid)).toBe(true)
    spy.mockRestore()
  })

  it('should run command on windows', async () => {
    await runCommand('echo 1')
    await runCommand('echo 1', { cwd: __dirname }, 1, true)
  })

  it('should run command with timeout', async () => {
    await expect(async () => {
      await runCommand('sleep 2', { cwd: __dirname }, 0.01)
    }).rejects.toThrow(errors.CancellationError)
  })

  it('should run command with Cancellation token', async () => {
    let tokenSource = new CancellationTokenSource()
    let token = tokenSource.token
    setTimeout(() => {
      tokenSource.cancel()
    }, 20)
    await expect(async () => {
      await runCommand('sleep 2', { cwd: __dirname, encoding: 'unknown' }, token)
    }).rejects.toThrow(errors.CancellationError)
  })

  it('should run command with encoding support', async () => {
    let res = await runCommand('echo "\\xc4\\xe3\\x0a"', { cwd: __dirname, encoding: 'cp936' }, 1, true)
    expect(res.length).toBeGreaterThan(0)
  })

  it('should throw on command error', async () => {
    await expect(async () => {
      await runCommand('command_not_exists', { cwd: __dirname })
    }).rejects.toThrow(Error)
  })

  it('should resolve concurrent with empty task', async () => {
    let fn = jest.fn()
    await concurrent([], fn, 3)
    expect(fn).toBeCalledTimes(0)
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
    expect(dt).toBeGreaterThanOrEqual(100)
    expect(res).toEqual([3, 4, 5, 6, 8])
  })

  it('should delay function #1', () => {
    let times = 0
    let fn = () => {
      times++
    }
    let delied = delay(fn, 50)
    delied()
    delied(100)
    expect(times).toBe(0)
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
    await helper.wait(50)
    expect(times).toBe(1)
  })
})

describe('fuzzy match test', () => {
  it('should be fuzzy match', () => {
    let needle = 'aBc'
    let codes = fuzzy.getCharCodes(needle)
    expect(fuzzy.fuzzyMatch(codes, 'abc')).toBeFalsy()
    expect(fuzzy.fuzzyMatch(codes, 'ab')).toBeFalsy()
    expect(fuzzy.fuzzyMatch(codes, 'addbdd')).toBeFalsy()
    expect(fuzzy.fuzzyMatch(codes, 'abbbBc')).toBeTruthy()
    expect(fuzzy.fuzzyMatch(codes, 'daBc')).toBeTruthy()
    expect(fuzzy.fuzzyMatch(codes, 'ABCz')).toBeTruthy()
    expect(fuzzy.fuzzyMatch(codes, 'axy')).toBeFalsy()
  })

  it('should be fuzzy for character', () => {
    expect(fuzzy.fuzzyChar('a', 'a')).toBeTruthy()
    expect(fuzzy.fuzzyChar('a', 'A')).toBeTruthy()
    expect(fuzzy.fuzzyChar('z', 'z')).toBeTruthy()
    expect(fuzzy.fuzzyChar('z', 'Z')).toBeTruthy()
    expect(fuzzy.fuzzyChar('A', 'a')).toBeFalsy()
    expect(fuzzy.fuzzyChar('A', 'A')).toBeTruthy()
    expect(fuzzy.fuzzyChar('Z', 'z')).toBeFalsy()
    expect(fuzzy.fuzzyChar('Z', 'Z')).toBeTruthy()
    expect(fuzzy.fuzzyChar('Z', 'z', true)).toBeTruthy()
    expect(fuzzy.fuzzyChar('i', 'İ')).toBeTruthy()
    expect(fuzzy.fuzzyChar('a', 'İ')).toBeFalsy()
    expect(fuzzy.fuzzyChar('i', 'İ', true)).toBeTruthy()
    expect(fuzzy.fuzzyChar('İ', 'i')).toBeFalsy()
    expect(fuzzy.fuzzyChar('İ', 'i', true)).toBeTruthy()
    expect(fuzzy.fuzzyChar('Ᾰ', 'ᾰ', true)).toBeTruthy()
    expect(fuzzy.fuzzyChar('ᾰ', 'Ᾰ')).toBeTruthy()
  })
})

describe('object test', () => {
  it('mixin should recursive', () => {
    let res = objects.mixin({ a: { b: 1 } }, { a: { c: 2 }, d: 3 })
    expect(res.a.b).toBe(1)
    expect(res.a.c).toBe(2)
    expect(res.d).toBe(3)
    res = objects.mixin({}, true)
    expect(res).toEqual({})
    res = objects.mixin({ x: 1 }, { x: 2 }, false)
    expect(res).toEqual({ x: 1 })
    res = objects.mixin(Date, {})
    expect(res).toEqual({})
    res = objects.mixin({ x: 3, y: new Date() }, { y: 4 }, true)
    expect(res).toEqual({ x: 3, y: 4 })
  })

  it('should deep clone', () => {
    let re = new RegExp('a', 'g')
    expect(objects.deepClone(re)).toBe(re)
  })

  it('should change to readonly', () => {
    let obj = { x: 1 }
    let res = objects.toReadonly(obj)
    let fn = () => {
      res.x = 3
    }
    expect(fn).toThrow()
  })

  it('should not deep freeze', () => {
    objects.deepFreeze(false)
    objects.deepFreeze(true)
  })

  it('should check equals', () => {
    expect(objects.equals(false, 1)).toBe(false)
    expect(objects.equals([1], {})).toBe(false)
    expect(objects.equals([1, 2], [1, 3])).toBe(false)
  })

  it('should check empty object', () => {
    expect(objects.isEmpty({})).toBe(true)
    expect(objects.isEmpty([])).toBe(true)
    expect(objects.isEmpty(null)).toBe(true)
    expect(objects.isEmpty({ x: 1 })).toBe(false)
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
    expect(vals).toEqual(['#1', '#2', '#3'])
  })
})

describe('ansiparse', () => {
  it('ansiparse #1', () => {
    let str = '\u001b[33mText\u001b[mnormal'
    let res = ansiparse(str)
    expect(res).toEqual([{
      foreground: 'yellow', text: 'Text'
    }, {
      text: 'normal'
    }])
  })

  it('ansiparse #2', () => {
    let str = '\u001b[33m\u001b[mText'
    let res = ansiparse(str)
    expect(res).toEqual([
      { foreground: 'yellow', text: '' },
      { text: 'Text' }])
  })

  it('ansiparse #3', () => {
    let str = 'this.\u001b[0m\u001b[31m\u001b[1mhistory\u001b[0m.add()'
    let res = ansiparse(str)
    expect(res[1]).toEqual({
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
        expect(dt).toBeGreaterThanOrEqual(2)
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
    await helper.wait(1)
    await mutex.use(fn)
    expect(count).toBe(2)
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
    expect(err).toBeDefined()
    expect(mutex.busy).toBe(false)
  })
})

describe('Sequence', () => {
  it('should run sequence', async () => {
    let s = new Sequence()
    let res: number[] = []
    s.run(async () => {
      await helper.wait(3)
      res.push(0)
    })
    s.run(async () => {
      await helper.wait(2)
      res.push(1)
    })
    s.run(async () => {
      await helper.wait(1)
      res.push(2)
    })
    await s.waitFinish()
    expect(res).toEqual([0, 1, 2])
  })

  it('should cancel sequence', async () => {
    let s = new Sequence()
    let res: number[] = []
    s.run(async () => {
      await helper.wait(10)
      res.push(0)
    })
    s.run(async () => {
      await helper.wait(20)
      res.push(1)
    })
    s.cancel()
    await s.waitFinish()
    expect(res).toEqual([])
  })
})

describe('terminate', () => {
  it('should terminate process', async () => {
    let cwd = process.cwd()
    let child = spawn('sleep', ['3'], { cwd, detached: true })
    let res = terminate(child, cwd)
    expect(res).toBe(true)
    await helper.waitValue(() => {
      return child.connected
    }, false)
    terminate(child, cwd)
    terminate({ killed: true } as any, cwd)
  })

  it('should terminate on other platform', () => {
    let child = spawn('ls', [], { detached: true })
    let res = terminate(child, process.cwd(), platform.Platform.Windows)
    expect(res).toBe(false)
    res = terminate(child, undefined, platform.Platform.Windows)
    expect(res).toBe(false)
    res = terminate(child, process.cwd(), platform.Platform.Unknown)
    expect(res).toBe(true)
    let spy: any = jest.spyOn(cp, 'execFileSync').mockImplementation(() => {
      return undefined
    })
    child = spawn('ls', [], { detached: true })
    res = terminate(child, process.cwd(), platform.Platform.Windows)
    expect(res).toBe(true)
    spy.mockRestore()
    spy = jest.spyOn(cp, 'spawnSync').mockImplementation(() => {
      throw new Error('bad')
    })
    child = spawn('ls', [], { detached: true })
    res = terminate(child, process.cwd(), platform.Platform.Linux)
    expect(res).toBe(false)
    spy.mockRestore()
    spy = jest.spyOn(cp, 'spawnSync').mockImplementation(() => {
      return { error: new Error('bad') } as any
    })
    child = spawn('ls', [], { detached: true })
    res = terminate(child, process.cwd(), platform.Platform.Linux)
    expect(res).toBe(false)
    spy.mockRestore()
  })
})

describe('diff', () => {
  describe('diff lines', () => {
    function diffLines(oldStr: string, newStr: string): diff.ChangedLines {
      let oldLines = oldStr.split('\n')
      return diff.diffLines(oldLines, newStr.split('\n'), oldLines.length - 2)
    }

    it('should get textedit without cursor', () => {
      let res = diff.getTextEdit(['a', 'b'], ['a', 'b'])
      expect(res).toBeUndefined()
      res = diff.getTextEdit(['a', 'b'], ['a', 'b'], Position.create(0, 0))
      expect(res).toBeUndefined()
      res = diff.getTextEdit(['a', 'b'], ['a', 'b', 'c'])
      expect(res).toEqual(toEdit(2, 0, 2, 0, 'c\n'))
      res = diff.getTextEdit(['a', 'b', 'c'], ['a'])
      expect(res).toEqual(toEdit(1, 0, 3, 0, ''))
      res = diff.getTextEdit(['a', 'b'], ['a', 'd'])
      expect(res).toEqual(toEdit(1, 0, 2, 0, 'd\n'))
      res = diff.getTextEdit(['a', 'b'], ['a', 'd', 'e'])
      expect(res).toEqual(toEdit(1, 0, 2, 0, 'd\ne\n'))
      res = diff.getTextEdit(['a', 'b', 'e'], ['a', 'd', 'e'])
      expect(res).toEqual(toEdit(1, 0, 2, 0, 'd\n'))
      res = diff.getTextEdit(['a', 'b', 'e'], ['e'])
      expect(res).toEqual(toEdit(0, 0, 2, 0, ''))
      res = diff.getTextEdit(['a', 'b', 'e'], ['d', 'c', 'a', 'b', 'e'])
      expect(res).toEqual(toEdit(0, 0, 0, 0, 'd\nc\n'))
      res = diff.getTextEdit(['a', 'b'], ['a', 'b', ''])
      expect(res).toEqual(toEdit(2, 0, 2, 0, '\n'))
      res = diff.getTextEdit(['a', 'b'], ['a', 'b', '', ''])
      expect(res).toEqual(toEdit(2, 0, 2, 0, '\n\n'))
    })

    it('should get textedit for single line change', () => {
      let res = diff.getTextEdit(['foo', 'c'], ['', 'c'], Position.create(0, 0), false)
      expect(res).toEqual(toEdit(0, 0, 0, 3, ''))
      res = diff.getTextEdit([''], ['foo'], Position.create(0, 0), false)
      expect(res).toEqual(toEdit(0, 0, 0, 0, 'foo'))
      res = diff.getTextEdit(['foo bar'], ['foo r'], Position.create(0, 4), false)
      expect(res).toEqual(toEdit(0, 4, 0, 6, ''))
      res = diff.getTextEdit(['f'], ['foo f'], Position.create(0, 0), false)
      expect(res).toEqual(toEdit(0, 0, 0, 0, 'foo '))
      res = diff.getTextEdit([' foo '], [' bar '], Position.create(0, 0), false)
      expect(res).toEqual(toEdit(0, 1, 0, 4, 'bar'))
      res = diff.getTextEdit(['foo'], ['bar'], Position.create(0, 0), true)
      expect(res).toEqual(toEdit(0, 0, 0, 3, 'bar'))
      res = diff.getTextEdit(['aa'], ['aaaa'], Position.create(0, 1), true)
      expect(res).toEqual(toEdit(0, 0, 0, 0, 'aa'))
    })

    it('should diff changed lines', () => {
      let res = diffLines('a\n', 'b\n')
      expect(res).toEqual({ start: 0, end: 1, replacement: ['b'] })
      res = diff.diffLines(['a', 'b'], ['c', 'd', 'a', 'b'], -1)
      expect(res).toEqual({ start: 0, end: 0, replacement: ['c', 'd'] })
    })

    it('should diff added lines', () => {
      let res = diffLines('a\n', 'a\nb\n')
      expect(res).toEqual({
        start: 1,
        end: 1,
        replacement: ['b']
      })
    })

    it('should diff remove lines', () => {
      let res = diffLines('a\n\n', 'a\n')
      expect(res).toEqual({
        start: 1,
        end: 2,
        replacement: []
      })
    })

    it('should diff remove multiple lines', () => {
      let res = diffLines('a\n\n\n', 'a\n')
      expect(res).toEqual({
        start: 1,
        end: 3,
        replacement: []
      })
    })

    it('should diff removed line', () => {
      let res = diffLines('a\n\n\nb', 'a\n\nb')
      expect(res).toEqual({
        start: 2,
        end: 3,
        replacement: []
      })
    })

    it('should reduce changed lines', () => {
      let res = diff.diffLines(['a', 'b', 'c'], ['a', 'b', 'c', 'd'], 0)
      expect(res).toEqual({
        start: 3,
        end: 3,
        replacement: ['d']
      })
    })
  })

  describe('patch line', () => {
    it('should patch line', () => {
      let res = diff.patchLine('foo', 'bar foo bar')
      expect(res.length).toBe(7)
      expect(res).toBe('    foo')
      res = diff.patchLine('foo', 'foo')
      expect(res).toBe('foo')
      res = diff.patchLine('foo', 'oo')
      expect(res).toBe('oo')
    })
  })

  function blockMilliseconds(ms: number): void {
    let ts = Date.now()
    let i = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (Date.now() - ts > ms) {
        break
      }
      i++
    }
  }

  describe('async', () => {
    it('should do filter', async () => {
      await filter([], () => true, () => {})
      await filter([{ label: 'a' }, { label: 'b' }, { label: 'c' }], v => {
        return { code: v.label.charCodeAt(0) }
      }, (items, done) => {
        expect(items.length).toBe(3)
        expect(done).toBe(true)
      })
      let n = 0
      let res: string[] = []
      let finished: boolean
      await filter<string>(['a', 'b', 'c'], () => {
        blockMilliseconds(30)
        return true
      }, (items, done) => {
        n++
        res.push(...items)
        finished = done
      })
      expect(n).toBe(3)
      expect(res).toEqual(['a', 'b', 'c'])
      expect(finished).toEqual(true)
    })

    it('should cancel filter when possible', async () => {
      let tokenSource = new CancellationTokenSource()
      let token = tokenSource.token
      process.nextTick(() => {
        tokenSource.cancel()
      })
      await filter([1, 2, 3, 4, 5, 6, 7, 8], i => {
        if (i > 1) {
          let ts = Date.now()
          // eslint-disable-next-line no-constant-condition
          while (true) {
            if (Date.now() - ts > 40) break
          }
        }
        return true
      }, (_, done) => {
        expect(done).toBeFalsy()
      }, token)
    })
  })

  describe('timing', () => {
    it('should trace', async () => {
      let t = createTiming('name', 1)
      t.start()
      t.start('label')
      await helper.wait(10)
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
