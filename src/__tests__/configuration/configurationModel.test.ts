import * as assert from 'assert'
import { join } from 'path'
import { URI } from 'vscode-uri'
import { Configuration } from '../../configuration/configuration'
import { AllKeysConfigurationChangeEvent, ConfigurationChangeEvent } from '../../configuration/event'
import { ConfigurationModel } from '../../configuration/model'
import { ConfigurationModelParser } from '../../configuration/parser'
import { mergeChanges } from '../../configuration/util'
import { Registry } from '../../util/registry'
import { IConfigurationRegistry, validateProperty, configurationDefaultsSchemaId, resourceLanguageSettingsSchemaId, allSettings, resourceSettings, Extensions, IConfigurationNode } from '../../configuration/registry'
import { ConfigurationScope, ConfigurationTarget } from '../../configuration/types'
import { Disposable } from 'vscode-languageserver-protocol'
import { disposeAll } from '../../util'
import { IJSONContributionRegistry, Extensions as JSONExtensions } from '../../util/jsonRegistry'

describe('ConfigurationRegistry', () => {
  let disposables: Disposable[] = []

  afterAll(() => {
    disposeAll(disposables)
  })

  let configuration = Registry.as<IConfigurationRegistry>(Extensions.Configuration)
  function createNode(id: string): IConfigurationNode {
    return { id, properties: {} }
  }

  function length(obj: object): number {
    return Object.keys(obj).length
  }

  test('register and unregister configuration', () => {
    let node = createNode('test')
    node.properties['test.foo'] = {
      type: 'string',
      default: '',
      markdownDeprecationMessage: 'deprecated'
    }
    node.properties['test.bar'] = {
      type: 'string',
      scope: ConfigurationScope.APPLICATION,
      included: false
    }
    node.properties['test.resource'] = {
      type: 'boolean',
      scope: ConfigurationScope.RESOURCE,
      markdownDescription: '# Description',
      default: true
    }
    node.properties['test.language'] = {
      type: 'array',
      scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
      default: []
    }
    expect(typeof configurationDefaultsSchemaId).toBe('string')
    let called = 0
    configuration.onDidSchemaChange(() => {
      called++
    }, null, disposables)
    configuration.onDidUpdateConfiguration(() => {
      called++
    }, null, disposables)
    configuration.registerConfigurations([node], false)
    expect(called).toBe(2)
    let other = createNode('other')
    other.scope = ConfigurationScope.RESOURCE
    other.properties['test.foo'] = { type: 'string' }
    configuration.registerConfiguration(other)
    configuration.registerConfigurations([other])
    let keys = Object.keys(allSettings.properties)
    expect(keys.length).toBe(3)
    keys = Object.keys(resourceSettings.properties)
    expect(keys.length).toBe(2)
    expect(length(configuration.getConfigurationProperties())).toBe(3)
    expect(length(configuration.getExcludedConfigurationProperties())).toBe(1)
    let jsonRegistry = Registry.as<IJSONContributionRegistry>(JSONExtensions.JSONContribution)
    let schemas = jsonRegistry.getSchemaContributions().schemas
    expect(schemas[resourceLanguageSettingsSchemaId]).toBeDefined()
    configuration.deregisterConfigurations([node])
    keys = Object.keys(allSettings.properties)
    expect(keys.length).toBe(0)
    keys = Object.keys(resourceSettings.properties)
    expect(keys.length).toBe(0)
    let schema = schemas[resourceLanguageSettingsSchemaId]
    expect(schema.properties).toEqual({})
  })

  test('register with extension info', () => {
    let node = createNode('test')
    node.extensionInfo = { id: 'coc-test' }
    node.properties['test.foo'] = {
      type: 'string',
      default: '',
      description: 'foo'
    }
    node.properties['test.bar'] = {
      type: 'string',
      default: '',
    }
    configuration.registerConfiguration(node)
    expect(allSettings.properties['test.foo'].description).toBeDefined()
    expect(allSettings.properties['test.bar'].description).toBeDefined()
    configuration.deregisterConfigurations([node])
  })

  test('update configurations', () => {
    let called = 0
    configuration.onDidSchemaChange(() => {
      called++
    }, null, disposables)
    configuration.updateConfigurations({ add: [], remove: [] })
    expect(called).toBe(1)
  })

  test('validateProperty', () => {
    expect(validateProperty('', {} as any) != null).toBe(true)
    expect(validateProperty('[docker]') != null).toBe(true)
    expect(validateProperty('key')).toBeNull()
  })
})

function toConfigurationModel(content: any): ConfigurationModel {
  const parser = new ConfigurationModelParser('test')
  parser.parse(JSON.stringify(content))
  return parser.configurationModel
}
describe('ConfigurationModelParser', () => {
  test('parser no error with empty text', async () => {
    const parser = new ConfigurationModelParser('test')
    parser.parse(' ')
    expect(parser.errors.length).toBe(0)
  })

  test('parse invalid value', async () => {
    let parser = new ConfigurationModelParser('test')
    parser.parse(33 as any)
    expect(parser.errors.length).toBe(1)
  })

  test('parse conflict properties', async () => {
    let parser = new ConfigurationModelParser('test')
    let called = false
    let s = jest.spyOn(console, 'error').mockImplementation(() => {
      called = true
    })
    parser.parse(JSON.stringify({ x: 1, 'x.y': {} }, null, 2))
    s.mockRestore()
    expect(called).toBe(true)
  })

  test('parse configuration model with single override identifier', () => {
    const testObject = new ConfigurationModelParser('')
    testObject.parse(JSON.stringify({ '[x]': { a: 1 } }))
    expect(JSON.stringify(testObject.configurationModel.overrides)).toEqual(JSON.stringify([{ identifiers: ['x'], keys: ['a'], contents: { a: 1 } }]))
  })

  test('parse configuration model with multiple override identifiers', () => {
    const testObject = new ConfigurationModelParser('')

    testObject.parse(JSON.stringify({ '[x][y]': { a: 1 } }))

    assert.deepStrictEqual(JSON.stringify(testObject.configurationModel.overrides), JSON.stringify([{ identifiers: ['x', 'y'], keys: ['a'], contents: { a: 1 } }]))
  })

  test('parse configuration model with multiple duplicate override identifiers', () => {
    const testObject = new ConfigurationModelParser('')

    testObject.parse(JSON.stringify({ '[x][y][x][z]': { a: 1 } }))

    assert.deepStrictEqual(JSON.stringify(testObject.configurationModel.overrides), JSON.stringify([{ identifiers: ['x', 'y', 'z'], keys: ['a'], contents: { a: 1 } }]))
  })

  test('parse with conflict properties', async () => {
    const testObject = new ConfigurationModelParser('')

    testObject.parse('{"x": 3, "x": 4}')
  })
})

describe('ConfigurationModel', () => {
  test('setValue for a key that has no sections and not defined', () => {
    const testObject = new ConfigurationModel({ a: { b: 1 } }, ['a.b'])

    testObject.setValue('f', 1)

    assert.deepStrictEqual(testObject.contents, { a: { b: 1 }, f: 1 })
    assert.deepStrictEqual(testObject.keys, ['a.b', 'f'])
    let called = false
    let s = jest.spyOn(console, 'error').mockImplementation(() => {
      called = true
    })
    testObject.setValue('a.b.c.d', { x: 3 })
    s.mockRestore()
  })

  test('setValue for a key that has no sections and defined', () => {
    const testObject = new ConfigurationModel({ a: { b: 1 }, f: 1 }, ['a.b', 'f'])

    testObject.setValue('f', 3)

    assert.deepStrictEqual(testObject.contents, { a: { b: 1 }, f: 3 })
    assert.deepStrictEqual(testObject.keys, ['a.b', 'f'])
  })

  test('setValue for a key that has sections and not defined', () => {
    const testObject = new ConfigurationModel({ a: { b: 1 }, f: 1 }, ['a.b', 'f'])

    testObject.setValue('b.c', 1)

    const expected: any = {}
    expected['a'] = { b: 1 }
    expected['f'] = 1
    expected['b'] = Object.create(null)
    expected['b']['c'] = 1
    expect(testObject.contents).toEqual(expected)
    // assert.deepStrictEqual(testObject.contents, expected)
    assert.deepStrictEqual(testObject.keys, ['a.b', 'f', 'b.c'])
  })

  test('setValue for a key that has sections and defined', () => {
    const testObject = new ConfigurationModel({ a: { b: 1 }, b: { c: 1 }, f: 1 }, ['a.b', 'b.c', 'f'])

    testObject.setValue('b.c', 3)

    assert.deepStrictEqual(testObject.contents, { a: { b: 1 }, b: { c: 3 }, f: 1 })
    assert.deepStrictEqual(testObject.keys, ['a.b', 'b.c', 'f'])
  })

  test('setValue for a key that has sections and sub section not defined', () => {
    const testObject = new ConfigurationModel({ a: { b: 1 }, f: 1 }, ['a.b', 'f'])

    testObject.setValue('a.c', 1)

    assert.deepStrictEqual(testObject.contents, { a: { b: 1, c: 1 }, f: 1 })
    assert.deepStrictEqual(testObject.keys, ['a.b', 'f', 'a.c'])
  })

  test('setValue for a key that has sections and sub section defined', () => {
    const testObject = new ConfigurationModel({ a: { b: 1, c: 1 }, f: 1 }, ['a.b', 'a.c', 'f'])

    testObject.setValue('a.c', 3)

    assert.deepStrictEqual(testObject.contents, { a: { b: 1, c: 3 }, f: 1 })
    assert.deepStrictEqual(testObject.keys, ['a.b', 'a.c', 'f'])
  })

  test('setValue for a key that has sections and last section is added', () => {
    const testObject = new ConfigurationModel({ a: { b: {} }, f: 1 }, ['a.b', 'f'])

    testObject.setValue('a.b.c', 1)

    assert.deepStrictEqual(testObject.contents, { a: { b: { c: 1 } }, f: 1 })
    assert.deepStrictEqual(testObject.keys, ['a.b.c', 'f'])
  })

  test('removeValue: remove a non existing key', () => {
    const testObject = new ConfigurationModel({ a: { b: 2 } }, ['a.b'])

    testObject.removeValue('a.b.c')

    assert.deepStrictEqual(testObject.contents, { a: { b: 2 } })
    assert.deepStrictEqual(testObject.keys, ['a.b'])
  })

  test('removeValue: remove a single segmented key', () => {
    const testObject = new ConfigurationModel({ a: 1 }, ['a'])

    testObject.removeValue('a')

    assert.deepStrictEqual(testObject.contents, {})
    assert.deepStrictEqual(testObject.keys, [])
  })

  test('removeValue: remove a multi segmented key', () => {
    const testObject = new ConfigurationModel({ a: { b: 1 } }, ['a.b'])

    testObject.removeValue('a.b')

    assert.deepStrictEqual(testObject.contents, {})
    assert.deepStrictEqual(testObject.keys, [])
  })

  test('get overriding configuration model for an existing identifier', () => {
    const testObject = new ConfigurationModel(
      { a: { b: 1 }, f: 1 }, [],
      [{ identifiers: ['c'], contents: { a: { d: 1 } }, keys: ['a'] }])

    assert.deepStrictEqual(testObject.override('c').contents, { a: { b: 1, d: 1 }, f: 1 })
  })

  test('get overriding configuration model for an identifier that does not exist', () => {
    const testObject = new ConfigurationModel(
      { a: { b: 1 }, f: 1 }, [],
      [{ identifiers: ['c'], contents: { a: { d: 1 } }, keys: ['a'] }])

    assert.deepStrictEqual(testObject.override('xyz').contents, { a: { b: 1 }, f: 1 })
  })

  test('get overriding configuration when one of the keys does not exist in base', () => {
    const testObject = new ConfigurationModel(
      { a: { b: 1 }, f: 1 }, [],
      [{ identifiers: ['c'], contents: { a: { d: 1 }, g: 1 }, keys: ['a', 'g'] }])

    assert.deepStrictEqual(testObject.override('c').contents, { a: { b: 1, d: 1 }, f: 1, g: 1 })
  })

  test('get overriding configuration when one of the key in base is not of object type', () => {
    const testObject = new ConfigurationModel(
      { a: { b: 1 }, f: 1 }, [],
      [{ identifiers: ['c'], contents: { a: { d: 1 }, f: { g: 1 } }, keys: ['a', 'f'] }])

    assert.deepStrictEqual(testObject.override('c').contents, { a: { b: 1, d: 1 }, f: { g: 1 } })
  })

  test('get overriding configuration when one of the key in overriding contents is not of object type', () => {
    const testObject = new ConfigurationModel(
      { a: { b: 1 }, f: { g: 1 } }, [],
      [{ identifiers: ['c'], contents: { a: { d: 1 }, f: 1 }, keys: ['a', 'f'] }])

    assert.deepStrictEqual(testObject.override('c').contents, { a: { b: 1, d: 1 }, f: 1 })
  })

  test('get overriding configuration if the value of overriding identifier is not object', () => {
    const testObject = new ConfigurationModel(
      { a: { b: 1 }, f: { g: 1 } }, [],
      [{ identifiers: ['c'], contents: 'abc', keys: [] }])

    assert.deepStrictEqual(testObject.override('c').contents, { a: { b: 1 }, f: { g: 1 } })
  })

  test('get overriding configuration if the value of overriding identifier is an empty object', () => {
    const testObject = new ConfigurationModel(
      { a: { b: 1 }, f: { g: 1 } }, [],
      [{ identifiers: ['c'], contents: {}, keys: [] }])

    assert.deepStrictEqual(testObject.override('c').contents, { a: { b: 1 }, f: { g: 1 } })
  })

  test('simple merge', () => {
    const base = new ConfigurationModel({ a: 1, b: 2 }, ['a', 'b'])
    const add = new ConfigurationModel({ a: 3, c: 4 }, ['a', 'c'])
    const result = base.merge(add)

    assert.deepStrictEqual(result.contents, { a: 3, b: 2, c: 4 })
    assert.deepStrictEqual(result.keys, ['a', 'b', 'c'])
  })

  test('recursive merge', () => {
    const base = new ConfigurationModel({ a: { b: 1 } }, ['a.b'])
    const add = new ConfigurationModel({ a: { b: 2 } }, ['a.b'])
    const result = base.merge(add)

    assert.deepStrictEqual(result.contents, { a: { b: 2 } })
    assert.deepStrictEqual(result.getValue('a'), { b: 2 })
    assert.deepStrictEqual(result.keys, ['a.b'])
  })

  test('simple merge overrides', () => {
    const base = new ConfigurationModel({ a: { b: 1 } }, ['a.b'], [{ identifiers: ['c'], contents: { a: 2 }, keys: ['a'] }])
    const add = new ConfigurationModel({ a: { b: 2 } }, ['a.b'], [{ identifiers: ['c'], contents: { b: 2 }, keys: ['b'] }])
    const result = base.merge(add)

    assert.deepStrictEqual(result.contents, { a: { b: 2 } })
    assert.deepStrictEqual(result.overrides, [{ identifiers: ['c'], contents: { a: 2, b: 2 }, keys: ['a', 'b'] }])
    assert.deepStrictEqual(result.override('c').contents, { a: 2, b: 2 })
    assert.deepStrictEqual(result.keys, ['a.b'])
  })

  test('recursive merge overrides', () => {
    const base = new ConfigurationModel({ a: { b: 1 }, f: 1 }, ['a.b', 'f'], [{ identifiers: ['c'], contents: { a: { d: 1 } }, keys: ['a'] }])
    const add = new ConfigurationModel({ a: { b: 2 } }, ['a.b'], [{ identifiers: ['c'], contents: { a: { e: 2 } }, keys: ['a'] }])
    const result = base.merge(add)

    assert.deepStrictEqual(result.contents, { a: { b: 2 }, f: 1 })
    assert.deepStrictEqual(result.overrides, [{ identifiers: ['c'], contents: { a: { d: 1, e: 2 } }, keys: ['a'] }])
    assert.deepStrictEqual(result.override('c').contents, { a: { b: 2, d: 1, e: 2 }, f: 1 })
    assert.deepStrictEqual(result.keys, ['a.b', 'f'])
  })

  test('merge overrides when frozen', () => {
    const model1 = new ConfigurationModel({ a: { b: 1 }, f: 1 }, ['a.b', 'f'], [{ identifiers: ['c'], contents: { a: { d: 1 } }, keys: ['a'] }]).freeze()
    const model2 = new ConfigurationModel({ a: { b: 2 } }, ['a.b'], [{ identifiers: ['c'], contents: { a: { e: 2 } }, keys: ['a'] }]).freeze()
    const result = new ConfigurationModel().merge(model1, model2)

    assert.deepStrictEqual(result.contents, { a: { b: 2 }, f: 1 })
    assert.deepStrictEqual(result.overrides, [{ identifiers: ['c'], contents: { a: { d: 1, e: 2 } }, keys: ['a'] }])
    assert.deepStrictEqual(result.override('c').contents, { a: { b: 2, d: 1, e: 2 }, f: 1 })
    assert.deepStrictEqual(result.keys, ['a.b', 'f'])
  })

  test('Test contents while getting an existing property', () => {
    let testObject = new ConfigurationModel({ a: 1 })
    assert.deepStrictEqual(testObject.getValue('a'), 1)

    testObject = new ConfigurationModel({ a: { b: 1 } })
    assert.deepStrictEqual(testObject.getValue('a'), { b: 1 })
  })

  test('Test contents are undefined for non existing properties', () => {
    const testObject = new ConfigurationModel({ awesome: true })

    assert.deepStrictEqual(testObject.getValue('unknownproperty'), undefined)
  })

  test('Test override gives all content merged with overrides', () => {
    const testObject = new ConfigurationModel({ a: 1, c: 1 }, [], [{ identifiers: ['b'], contents: { a: 2 }, keys: ['a'] }])

    assert.deepStrictEqual(testObject.override('b').contents, { a: 2, c: 1 })
  })

  test('Test override when an override has multiple identifiers', () => {
    const testObject = new ConfigurationModel({ a: 1, c: 1 }, ['a', 'c'], [{ identifiers: ['x', 'y'], contents: { a: 2 }, keys: ['a'] }])

    let actual = testObject.override('x')
    assert.deepStrictEqual(actual.contents, { a: 2, c: 1 })
    assert.deepStrictEqual(actual.keys, ['a', 'c'])
    assert.deepStrictEqual(testObject.getKeysForOverrideIdentifier('x'), ['a'])

    actual = testObject.override('y')
    assert.deepStrictEqual(actual.contents, { a: 2, c: 1 })
    assert.deepStrictEqual(actual.keys, ['a', 'c'])
    assert.deepStrictEqual(testObject.getKeysForOverrideIdentifier('y'), ['a'])
  })

  test('Test override when an identifier is defined in multiple overrides', () => {
    const testObject = new ConfigurationModel({ a: 1, c: 1 }, ['a', 'c'], [{ identifiers: ['x'], contents: { a: 3, b: 1 }, keys: ['a', 'b'] }, { identifiers: ['x', 'y'], contents: { a: 2 }, keys: ['a'] }])

    const actual = testObject.override('x')
    assert.deepStrictEqual(actual.contents, { a: 3, c: 1, b: 1 })
    assert.deepStrictEqual(actual.keys, ['a', 'c'])

    assert.deepStrictEqual(testObject.getKeysForOverrideIdentifier('x'), ['a', 'b'])
  })

  test('Test merge when configuration models have multiple identifiers', () => {
    const testObject = new ConfigurationModel({ a: 1, c: 1 }, ['a', 'c'], [{ identifiers: ['y'], contents: { c: 1 }, keys: ['c'] }, { identifiers: ['x', 'y'], contents: { a: 2 }, keys: ['a'] }])
    const target = new ConfigurationModel({ a: 2, b: 1 }, ['a', 'b'], [{ identifiers: ['x'], contents: { a: 3, b: 2 }, keys: ['a', 'b'] }, { identifiers: ['x', 'y'], contents: { b: 3 }, keys: ['b'] }])

    const actual = testObject.merge(target)

    assert.deepStrictEqual(actual.contents, { a: 2, c: 1, b: 1 })
    assert.deepStrictEqual(actual.keys, ['a', 'c', 'b'])
    assert.deepStrictEqual(actual.overrides, [
      { identifiers: ['y'], contents: { c: 1 }, keys: ['c'] },
      { identifiers: ['x', 'y'], contents: { a: 2, b: 3 }, keys: ['a', 'b'] },
      { identifiers: ['x'], contents: { a: 3, b: 2 }, keys: ['a', 'b'] },
    ])
  })
})

describe('CustomConfigurationModel', () => {

  test('simple merge using models', () => {
    const base = new ConfigurationModelParser('base')
    base.parse(JSON.stringify({ a: 1, b: 2 }))

    const add = new ConfigurationModelParser('add')
    add.parse(JSON.stringify({ a: 3, c: 4 }))

    const result = base.configurationModel.merge(add.configurationModel)
    assert.deepStrictEqual(result.contents, { a: 3, b: 2, c: 4 })
  })

  test('simple merge with an undefined contents', () => {
    let base = new ConfigurationModelParser('base')
    base.parse(JSON.stringify({ a: 1, b: 2 }))
    let add = new ConfigurationModelParser('add')
    let result = base.configurationModel.merge(add.configurationModel)
    assert.deepStrictEqual(result.contents, { a: 1, b: 2 })

    base = new ConfigurationModelParser('base')
    add = new ConfigurationModelParser('add')
    add.parse(JSON.stringify({ a: 1, b: 2 }))
    result = base.configurationModel.merge(add.configurationModel)
    assert.deepStrictEqual(result.contents, { a: 1, b: 2 })

    base = new ConfigurationModelParser('base')
    add = new ConfigurationModelParser('add')
    result = base.configurationModel.merge(add.configurationModel)
    assert.deepStrictEqual(result.contents, {})
  })

  test('Recursive merge using config models', () => {
    const base = new ConfigurationModelParser('base')
    base.parse(JSON.stringify({ a: { b: 1 } }))
    const add = new ConfigurationModelParser('add')
    add.parse(JSON.stringify({ a: { b: 2 } }))
    const result = base.configurationModel.merge(add.configurationModel)
    assert.deepStrictEqual(result.contents, { a: { b: 2 } })
  })

  test('Test contents while getting an existing property', () => {
    const testObject = new ConfigurationModelParser('test')
    testObject.parse(JSON.stringify({ a: 1 }))
    assert.deepStrictEqual(testObject.configurationModel.getValue('a'), 1)

    testObject.parse(JSON.stringify({ a: { b: 1 } }))
    assert.deepStrictEqual(testObject.configurationModel.getValue('a'), { b: 1 })
  })

  test('Test contents are undefined for non existing properties', () => {
    const testObject = new ConfigurationModelParser('test')
    testObject.parse(JSON.stringify({
      awesome: true
    }))

    assert.deepStrictEqual(testObject.configurationModel.getValue('unknownproperty'), undefined)
  })

  test('Test contents are undefined for undefined config', () => {
    const testObject = new ConfigurationModelParser('test')

    assert.deepStrictEqual(testObject.configurationModel.getValue('unknownproperty'), undefined)
  })

  test('Test configWithOverrides gives all content merged with overrides', () => {
    const testObject = new ConfigurationModelParser('test')
    testObject.parse(JSON.stringify({ a: 1, c: 1, '[b]': { a: 2 } }))

    assert.deepStrictEqual(testObject.configurationModel.override('b').contents, { a: 2, c: 1, '[b]': { a: 2 } })
  })

  test('Test configWithOverrides gives empty contents', () => {
    const testObject = new ConfigurationModelParser('test')

    assert.deepStrictEqual(testObject.configurationModel.override('b').contents, {})
  })

  test('Test update with empty data', () => {
    const testObject = new ConfigurationModelParser('test')
    testObject.parse('')

    assert.deepStrictEqual(testObject.configurationModel.contents, Object.create(null))
    assert.deepStrictEqual(testObject.configurationModel.keys, [])

    testObject.parse(null!)

    assert.deepStrictEqual(testObject.configurationModel.contents, Object.create(null))
    assert.deepStrictEqual(testObject.configurationModel.keys, [])

    testObject.parse(undefined!)

    assert.deepStrictEqual(testObject.configurationModel.contents, Object.create(null))
    assert.deepStrictEqual(testObject.configurationModel.keys, [])
  })

  test('Test empty property is not ignored', () => {
    const testObject = new ConfigurationModelParser('test')
    testObject.parse(JSON.stringify({ '': 1 }))

    // deepStrictEqual seems to ignore empty properties, fall back
    // to comparing the output of JSON.stringify
    assert.strictEqual(JSON.stringify(testObject.configurationModel.contents), JSON.stringify({ '': 1 }))
    assert.deepStrictEqual(testObject.configurationModel.keys, [''])
  })
})

describe('Configuration', () => {
  test('Test getConfigurationModel', () => {
    const parser = new ConfigurationModelParser('test')
    parser.parse(JSON.stringify({ a: 1 }))
    const con: Configuration = new Configuration(parser.configurationModel, new ConfigurationModel(), new ConfigurationModel())
    expect(con.getConfigurationModel(ConfigurationTarget.Default)).toBeDefined()
    expect(con.getConfigurationModel(ConfigurationTarget.User)).toBeDefined()
    expect(con.getConfigurationModel(ConfigurationTarget.Workspace)).toBeDefined()
    expect(con.getConfigurationModel(ConfigurationTarget.WorkspaceFolder, 'folder')).toBeDefined()
    expect(con.getConfigurationModel(ConfigurationTarget.Memory)).toBeDefined()
  })

  test('Test resolveFolder', async () => {
    const con: Configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel())
    con.addFolderConfiguration('/a/b/c', new ConfigurationModel())
    con.addFolderConfiguration('/a', new ConfigurationModel())
    let res = con.resolveFolder('/a/b/c/d/e')
    expect(res).toBe('/a/b/c')
  })

  test('Test inspect for overrideIdentifiers', () => {
    const defaultConfigurationModel = toConfigurationModel({ '[l1]': { a: 1 }, '[l2]': { b: 1 } })
    const userConfigurationModel = toConfigurationModel({ '[l3]': { a: 2 } })
    const workspaceConfigurationModel = toConfigurationModel({ '[l1]': { a: 3 }, '[l4]': { a: 3 } })
    const workspaceFolderConfigurationModel = toConfigurationModel({ '[l3]': { a: 3 } })
    const testObject: Configuration = new Configuration(defaultConfigurationModel, userConfigurationModel, workspaceConfigurationModel)
    testObject.updateFolderConfiguration('/foo', workspaceFolderConfigurationModel)
    const { overrideIdentifiers } = testObject.inspect('a', {})
    assert.deepStrictEqual(overrideIdentifiers, ['l1', 'l3', 'l4'])
    let res = testObject.inspect('a', { overrideIdentifier: 'l1' })
    expect(res.value).toBe(3)
    expect(res.default.override).toBe(1)
    expect(res.user).toBeUndefined()
    res = testObject.inspect('a', { overrideIdentifier: 'l3' })
    expect(res.user).toEqual({ value: undefined, override: 2 })
    res = testObject.inspect('a', { overrideIdentifier: 'l3', resource: '/foo/bar' })
    expect(res.workspaceFolder).toEqual({ value: undefined, override: 3 })
    testObject.updateValue('b', 3)
    res = testObject.inspect('b', {})
    expect(res.memoryValue).toBe(3)
    res = testObject.inspect('b', { overrideIdentifier: 'l3' })
    expect(res.memoryValue).toBe(3)
    const newModel = toConfigurationModel({ a: 4 })
    testObject.compareAndUpdateFolderConfiguration('/foo', newModel)
    res = testObject.inspect('a', { resource: '/foo/bar' })
    expect(res.workspaceFolderValue).toBe(4)
    testObject.compareAndUpdateFolderConfiguration('/foo', newModel)
    res = testObject.inspect('a', { resource: '/foo/bar' })
    expect(res.workspaceFolderValue).toBe(4)
  })

  test('Test update value', () => {
    const parser = new ConfigurationModelParser('test')
    parser.parse(JSON.stringify({ a: 1 }))
    const testObject: Configuration = new Configuration(parser.configurationModel, new ConfigurationModel(), new ConfigurationModel())
    testObject.updateValue('a', 2)
    assert.strictEqual(testObject.getValue('a', {}), 2)
  })

  test('Test update by resource', async () => {
    const parser = new ConfigurationModelParser('test')
    parser.parse(JSON.stringify({ a: 1 }))
    const testObject: Configuration = new Configuration(parser.configurationModel, new ConfigurationModel(), new ConfigurationModel())
    testObject.updateValue('a', 2, { resource: 'file' })
    testObject.updateValue('a', 3, { resource: 'file' })
    assert.strictEqual(testObject.getValue('a', { resource: 'file' }), 3)
    testObject.updateValue('a', undefined, { resource: 'file' })
    assert.strictEqual(testObject.getValue('a', { resource: 'file' }), 1)
  })

  test('Test update value after inspect', () => {
    const parser = new ConfigurationModelParser('test')
    parser.parse(JSON.stringify({ a: 1 }))
    const testObject: Configuration = new Configuration(parser.configurationModel, new ConfigurationModel(), new ConfigurationModel())
    testObject.inspect('a', {})
    testObject.updateValue('a', 2)
    assert.strictEqual(testObject.getValue('a', {}), 2)
  })

  test('Test compare and update default configuration', () => {
    const testObject = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel())
    testObject.updateDefaultConfiguration(toConfigurationModel({
      'editor.lineNumbers': 'on',
    }))

    const actual = testObject.compareAndUpdateDefaultConfiguration(toConfigurationModel({
      'editor.lineNumbers': 'off',
      '[markdown]': {
        'editor.wordWrap': 'off'
      }
    }), ['editor.lineNumbers', '[markdown]'])

    assert.deepStrictEqual(actual, { keys: ['editor.lineNumbers', '[markdown]'], overrides: [['markdown', ['editor.wordWrap']]] })
    let res = testObject.compareAndUpdateDefaultConfiguration(toConfigurationModel({
      '[markdown]': {
        'editor.lineNumbers': 'off',
        'editor.wordWrap': 'on',
        'editor.showbreak': 'off'
      }
    }), ['[markdown]'])
    expect(res.overrides).toEqual([
      ['markdown', ['editor.lineNumbers', 'editor.showbreak', 'editor.wordWrap']]
    ])

    res = testObject.compareAndUpdateDefaultConfiguration(toConfigurationModel({}))
    expect(res.overrides).toEqual([
      [
        'markdown',
        [
          'editor.lineNumbers',
          'editor.wordWrap',
          'editor.showbreak',
          'editor.lineNumbers',
          'editor.wordWrap',
          'editor.showbreak'
        ]
      ]
    ])
  })

  test('Test compare and update same configurationModel', async () => {
    const testObject = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel())
    let res = testObject.compareAndUpdateUserConfiguration(testObject.user)
    expect(res.keys).toEqual([])
    res = testObject.compareAndUpdateWorkspaceConfiguration(testObject.workspace)
    expect(res.keys).toEqual([])
    res = testObject.compareAndUpdateDefaultConfiguration(testObject.defaults)
    expect(res.keys).toEqual([])
    testObject.compareAndDeleteFolderConfiguration('/a/b')
  })

  test('Test compare and update user configuration', () => {
    const testObject = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel())
    testObject.updateUserConfiguration(toConfigurationModel({
      'editor.lineNumbers': 'off',
      'editor.fontSize': 12,
      '[typescript]': {
        'editor.wordWrap': 'off'
      }
    }))

    const actual = testObject.compareAndUpdateUserConfiguration(toConfigurationModel({
      'editor.lineNumbers': 'on',
      'window.zoomLevel': 1,
      '[typescript]': {
        'editor.wordWrap': 'on',
        'editor.insertSpaces': false
      }
    }))

    assert.deepStrictEqual(actual, { keys: ['window.zoomLevel', 'editor.lineNumbers', '[typescript]', 'editor.fontSize'], overrides: [['typescript', ['editor.insertSpaces', 'editor.wordWrap']]] })
  })

  test('Test compare and update workspace configuration', () => {
    const testObject = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel())
    testObject.updateWorkspaceConfiguration(toConfigurationModel({
      'editor.lineNumbers': 'off',
      'editor.fontSize': 12,
      '[typescript]': {
        'editor.wordWrap': 'off'
      }
    }))

    const actual = testObject.compareAndUpdateWorkspaceConfiguration(toConfigurationModel({
      'editor.lineNumbers': 'on',
      'window.zoomLevel': 1,
      '[typescript]': {
        'editor.wordWrap': 'on',
        'editor.insertSpaces': false
      }
    }))

    assert.deepStrictEqual(actual, { keys: ['window.zoomLevel', 'editor.lineNumbers', '[typescript]', 'editor.fontSize'], overrides: [['typescript', ['editor.insertSpaces', 'editor.wordWrap']]] })

  })

  test('Test compare and update workspace folder configuration', () => {
    const testObject = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel())
    testObject.updateFolderConfiguration(URI.file('file1').fsPath, toConfigurationModel({
      'editor.lineNumbers': 'off',
      'editor.fontSize': 12,
      '[typescript]': {
        'editor.wordWrap': 'off'
      }
    }))
    const actual = testObject.compareAndUpdateFolderConfiguration(URI.file('file1').fsPath, toConfigurationModel({
      'editor.lineNumbers': 'on',
      'window.zoomLevel': 1,
      '[typescript]': {
        'editor.wordWrap': 'on',
        'editor.insertSpaces': false
      }
    }))
    assert.deepStrictEqual(actual, { keys: ['window.zoomLevel', 'editor.lineNumbers', '[typescript]', 'editor.fontSize'], overrides: [['typescript', ['editor.insertSpaces', 'editor.wordWrap']]] })
    testObject.compareAndUpdateFolderConfiguration('/a/b', new ConfigurationModel())
    expect(testObject.hasFolder('/a/b')).toBe(true)
  })
})

describe('ConfigurationChangeEvent', () => {

  test('changeEvent affecting keys with new configuration', () => {
    const configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel())
    const change = configuration.compareAndUpdateUserConfiguration(toConfigurationModel({
      'window.zoomLevel': 1,
      'workbench.editor.enablePreview': false,
      'files.autoSave': 'off',
    }))
    const testObject = new ConfigurationChangeEvent(change, undefined, configuration)

    assert.deepStrictEqual(testObject.affectedKeys, ['window.zoomLevel', 'workbench.editor.enablePreview', 'files.autoSave'])

    assert.ok(testObject.affectsConfiguration('window.zoomLevel'))
    assert.ok(testObject.affectsConfiguration('window'))

    assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview'))
    assert.ok(testObject.affectsConfiguration('workbench.editor'))
    assert.ok(testObject.affectsConfiguration('workbench'))

    assert.ok(testObject.affectsConfiguration('files'))
    assert.ok(testObject.affectsConfiguration('files.autoSave'))
    assert.ok(!testObject.affectsConfiguration('files.exclude'))

    assert.ok(!testObject.affectsConfiguration('[markdown]'))
    assert.ok(!testObject.affectsConfiguration('editor'))
  })

  test('changeEvent affecting keys when configuration changed', () => {
    const configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel())
    configuration.updateUserConfiguration(toConfigurationModel({
      'window.zoomLevel': 2,
      'workbench.editor.enablePreview': true,
      'files.autoSave': 'off',
    }))
    const data = configuration.toData()
    const change = configuration.compareAndUpdateUserConfiguration(toConfigurationModel({
      'window.zoomLevel': 1,
      'workbench.editor.enablePreview': false,
      'files.autoSave': 'off',
    }))
    const testObject = new ConfigurationChangeEvent(change, data, configuration)

    assert.deepStrictEqual(testObject.affectedKeys, ['window.zoomLevel', 'workbench.editor.enablePreview'])

    assert.ok(testObject.affectsConfiguration('window.zoomLevel'))
    assert.ok(testObject.affectsConfiguration('window'))

    assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview'))
    assert.ok(testObject.affectsConfiguration('workbench.editor'))
    assert.ok(testObject.affectsConfiguration('workbench'))

    assert.ok(!testObject.affectsConfiguration('files'))
    assert.ok(!testObject.affectsConfiguration('[markdown]'))
    assert.ok(!testObject.affectsConfiguration('editor'))
  })

  test('changeEvent affecting overrides with new configuration', () => {
    const configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel())
    const change = configuration.compareAndUpdateUserConfiguration(toConfigurationModel({
      'files.autoSave': 'off',
      '[markdown]': {
        'editor.wordWrap': 'off'
      },
      '[typescript][jsonc]': {
        'editor.lineNumbers': 'off'
      }
    }))
    const testObject = new ConfigurationChangeEvent(change, undefined, configuration)

    assert.deepStrictEqual(testObject.affectedKeys, ['files.autoSave', '[markdown]', '[typescript][jsonc]', 'editor.wordWrap', 'editor.lineNumbers'])

    assert.ok(testObject.affectsConfiguration('files'))
    assert.ok(testObject.affectsConfiguration('files.autoSave'))
    assert.ok(!testObject.affectsConfiguration('files.exclude'))

    assert.ok(testObject.affectsConfiguration('[markdown]'))
    assert.ok(!testObject.affectsConfiguration('[markdown].editor'))
    assert.ok(!testObject.affectsConfiguration('[markdown].workbench'))

    assert.ok(testObject.affectsConfiguration('editor'))
    assert.ok(testObject.affectsConfiguration('editor.wordWrap'))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers'))
    assert.ok(testObject.affectsConfiguration('editor', { languageId: 'markdown' }))
    assert.ok(testObject.affectsConfiguration('editor', { languageId: 'jsonc' }))
    assert.ok(testObject.affectsConfiguration('editor', { languageId: 'typescript' }))
    assert.ok(testObject.affectsConfiguration('editor.wordWrap', { languageId: 'markdown' }))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { languageId: 'jsonc' }))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { languageId: 'typescript' }))
    assert.ok(!testObject.affectsConfiguration('editor.lineNumbers', { languageId: 'markdown' }))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { languageId: 'typescript' }))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { languageId: 'jsonc' }))
    assert.ok(!testObject.affectsConfiguration('editor', { languageId: 'json' }))
    assert.ok(!testObject.affectsConfiguration('editor.fontSize', { languageId: 'markdown' }))

    assert.ok(!testObject.affectsConfiguration('editor.fontSize'))
    assert.ok(!testObject.affectsConfiguration('window'))
  })

  test('changeEvent affecting overrides when configuration changed', () => {
    const configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel())
    configuration.updateUserConfiguration(toConfigurationModel({
      'workbench.editor.enablePreview': true,
      '[markdown]': {
        'editor.fontSize': 12,
        'editor.wordWrap': 'off'
      },
      '[css][scss]': {
        'editor.lineNumbers': 'off',
        'css.lint.emptyRules': 'error'
      },
      'files.autoSave': 'off',
    }))
    const data = configuration.toData()
    const change = configuration.compareAndUpdateUserConfiguration(toConfigurationModel({
      'files.autoSave': 'off',
      '[markdown]': {
        'editor.fontSize': 13,
        'editor.wordWrap': 'off'
      },
      '[css][scss]': {
        'editor.lineNumbers': 'relative',
        'css.lint.emptyRules': 'error'
      },
      'window.zoomLevel': 1,
    }))
    const testObject = new ConfigurationChangeEvent(change, data, configuration)

    assert.deepStrictEqual(testObject.affectedKeys, ['window.zoomLevel', '[markdown]', '[css][scss]', 'workbench.editor.enablePreview', 'editor.fontSize', 'editor.lineNumbers'])

    assert.ok(!testObject.affectsConfiguration('files'))

    assert.ok(testObject.affectsConfiguration('[markdown]'))
    assert.ok(!testObject.affectsConfiguration('[markdown].editor'))
    assert.ok(!testObject.affectsConfiguration('[markdown].editor.fontSize'))
    assert.ok(!testObject.affectsConfiguration('[markdown].editor.wordWrap'))
    assert.ok(!testObject.affectsConfiguration('[markdown].workbench'))
    assert.ok(testObject.affectsConfiguration('[css][scss]'))

    assert.ok(testObject.affectsConfiguration('editor'))
    assert.ok(testObject.affectsConfiguration('editor', { languageId: 'markdown' }))
    assert.ok(testObject.affectsConfiguration('editor', { languageId: 'css' }))
    assert.ok(testObject.affectsConfiguration('editor', { languageId: 'scss' }))
    assert.ok(testObject.affectsConfiguration('editor.fontSize', { languageId: 'markdown' }))
    assert.ok(!testObject.affectsConfiguration('editor.fontSize', { languageId: 'css' }))
    assert.ok(!testObject.affectsConfiguration('editor.fontSize', { languageId: 'scss' }))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { languageId: 'scss' }))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { languageId: 'css' }))
    assert.ok(!testObject.affectsConfiguration('editor.lineNumbers', { languageId: 'markdown' }))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap'))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { languageId: 'markdown' }))
    assert.ok(!testObject.affectsConfiguration('editor', { languageId: 'json' }))
    assert.ok(!testObject.affectsConfiguration('editor.fontSize', { languageId: 'json' }))

    assert.ok(testObject.affectsConfiguration('window'))
    assert.ok(testObject.affectsConfiguration('window.zoomLevel'))
    assert.ok(testObject.affectsConfiguration('window', { languageId: 'markdown' }))
    assert.ok(testObject.affectsConfiguration('window.zoomLevel', { languageId: 'markdown' }))

    assert.ok(testObject.affectsConfiguration('workbench'))
    assert.ok(testObject.affectsConfiguration('workbench.editor'))
    assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview'))
    assert.ok(testObject.affectsConfiguration('workbench', { languageId: 'markdown' }))
    assert.ok(testObject.affectsConfiguration('workbench.editor', { languageId: 'markdown' }))
  })

  test('changeEvent affecting workspace folders', () => {
    const configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel())
    configuration.updateWorkspaceConfiguration(toConfigurationModel({ 'window.title': 'custom' }))
    configuration.updateFolderConfiguration(URI.file('folder1').fsPath, toConfigurationModel({ 'window.zoomLevel': 2, 'window.restoreFullscreen': true }))
    configuration.updateFolderConfiguration(URI.file('folder2').fsPath, toConfigurationModel({ 'workbench.editor.enablePreview': true, 'window.restoreWindows': true }))
    const data = configuration.toData()
    // const workspace = new Workspace('a',
    // [new WorkspaceFolder({ index: 0, name: 'a', uri: URI.file('folder1') }),
    // new WorkspaceFolder({ index: 1, name: 'b', uri: URI.file('folder2') }),
    // new WorkspaceFolder({ index: 2, name: 'c', uri: URI.file('folder3') })])

    const change = mergeChanges(
      configuration.compareAndUpdateWorkspaceConfiguration(toConfigurationModel({ 'window.title': 'native' })),
      configuration.compareAndUpdateFolderConfiguration(URI.file('folder1').fsPath, toConfigurationModel({ 'window.zoomLevel': 1, 'window.restoreFullscreen': false })),
      configuration.compareAndUpdateFolderConfiguration(URI.file('folder2').fsPath, toConfigurationModel({ 'workbench.editor.enablePreview': false, 'window.restoreWindows': false }))
    )
    const testObject = new ConfigurationChangeEvent(change, data, configuration)

    assert.deepStrictEqual(testObject.affectedKeys, ['window.title', 'window.zoomLevel', 'window.restoreFullscreen', 'workbench.editor.enablePreview', 'window.restoreWindows'])

    assert.ok(testObject.affectsConfiguration('window.zoomLevel'))
    assert.ok(testObject.affectsConfiguration('window.zoomLevel', URI.file('folder1')))
    assert.ok(testObject.affectsConfiguration('window.zoomLevel', URI.file(join('folder1', 'file1'))))
    assert.ok(!testObject.affectsConfiguration('window.zoomLevel', URI.file('file1')))
    assert.ok(!testObject.affectsConfiguration('window.zoomLevel', URI.file('file2')))
    assert.ok(!testObject.affectsConfiguration('window.zoomLevel', URI.file(join('folder2', 'file2'))))
    assert.ok(!testObject.affectsConfiguration('window.zoomLevel', URI.file(join('folder3', 'file3'))))

    assert.ok(testObject.affectsConfiguration('window.restoreFullscreen'))
    assert.ok(testObject.affectsConfiguration('window.restoreFullscreen', URI.file(join('folder1', 'file1'))))
    assert.ok(testObject.affectsConfiguration('window.restoreFullscreen', URI.file('folder1')))
    assert.ok(!testObject.affectsConfiguration('window.restoreFullscreen', URI.file('file1')))
    assert.ok(!testObject.affectsConfiguration('window.restoreFullscreen', URI.file('file2')))
    assert.ok(!testObject.affectsConfiguration('window.restoreFullscreen', URI.file(join('folder2', 'file2'))))
    assert.ok(!testObject.affectsConfiguration('window.restoreFullscreen', URI.file(join('folder3', 'file3'))))

    assert.ok(testObject.affectsConfiguration('window.restoreWindows'))
    assert.ok(testObject.affectsConfiguration('window.restoreWindows', URI.file('folder2')))
    assert.ok(testObject.affectsConfiguration('window.restoreWindows', URI.file(join('folder2', 'file2'))))
    assert.ok(!testObject.affectsConfiguration('window.restoreWindows', URI.file('file2')))
    assert.ok(!testObject.affectsConfiguration('window.restoreWindows', URI.file(join('folder1', 'file1'))))
    assert.ok(!testObject.affectsConfiguration('window.restoreWindows', URI.file(join('folder3', 'file3'))))

    assert.ok(testObject.affectsConfiguration('window.title'))
    assert.ok(testObject.affectsConfiguration('window.title', URI.file('folder1')))
    assert.ok(testObject.affectsConfiguration('window.title', URI.file(join('folder1', 'file1'))))
    assert.ok(testObject.affectsConfiguration('window.title', URI.file('folder2')))
    assert.ok(testObject.affectsConfiguration('window.title', URI.file(join('folder2', 'file2'))))
    assert.ok(testObject.affectsConfiguration('window.title', URI.file('folder3')))
    assert.ok(testObject.affectsConfiguration('window.title', URI.file(join('folder3', 'file3'))))
    assert.ok(testObject.affectsConfiguration('window.title', URI.file('file1')))
    assert.ok(testObject.affectsConfiguration('window.title', URI.file('file2')))
    assert.ok(testObject.affectsConfiguration('window.title', URI.file('file3')))

    assert.ok(testObject.affectsConfiguration('window'))
    assert.ok(testObject.affectsConfiguration('window', URI.file('folder1')))
    assert.ok(testObject.affectsConfiguration('window', URI.file(join('folder1', 'file1'))))
    assert.ok(testObject.affectsConfiguration('window', URI.file('folder2')))
    assert.ok(testObject.affectsConfiguration('window', URI.file(join('folder2', 'file2'))))
    assert.ok(testObject.affectsConfiguration('window', URI.file('folder3')))
    assert.ok(testObject.affectsConfiguration('window', URI.file(join('folder3', 'file3'))))
    assert.ok(testObject.affectsConfiguration('window', URI.file('file1')))
    assert.ok(testObject.affectsConfiguration('window', URI.file('file2')))
    assert.ok(testObject.affectsConfiguration('window', URI.file('file3')))

    assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview'))
    assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview', URI.file('folder2')))
    assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview', URI.file(join('folder2', 'file2'))))
    assert.ok(!testObject.affectsConfiguration('workbench.editor.enablePreview', URI.file('folder1')))
    assert.ok(!testObject.affectsConfiguration('workbench.editor.enablePreview', URI.file(join('folder1', 'file1'))))
    assert.ok(!testObject.affectsConfiguration('workbench.editor.enablePreview', URI.file('folder3')))

    assert.ok(testObject.affectsConfiguration('workbench.editor'))
    assert.ok(testObject.affectsConfiguration('workbench.editor', URI.file('folder2')))
    assert.ok(testObject.affectsConfiguration('workbench.editor', URI.file(join('folder2', 'file2'))))
    assert.ok(!testObject.affectsConfiguration('workbench.editor', URI.file('folder1')))
    assert.ok(!testObject.affectsConfiguration('workbench.editor', URI.file(join('folder1', 'file1'))))
    assert.ok(!testObject.affectsConfiguration('workbench.editor', URI.file('folder3')))

    assert.ok(testObject.affectsConfiguration('workbench'))
    assert.ok(testObject.affectsConfiguration('workbench', URI.file('folder2')))
    assert.ok(testObject.affectsConfiguration('workbench', URI.file(join('folder2', 'file2'))))
    assert.ok(!testObject.affectsConfiguration('workbench', URI.file('folder1')))
    assert.ok(!testObject.affectsConfiguration('workbench', URI.file('folder3')))

    assert.ok(!testObject.affectsConfiguration('files'))
    assert.ok(!testObject.affectsConfiguration('files', URI.file('folder1')))
    assert.ok(!testObject.affectsConfiguration('files', URI.file(join('folder1', 'file1'))))
    assert.ok(!testObject.affectsConfiguration('files', URI.file('folder2')))
    assert.ok(!testObject.affectsConfiguration('files', URI.file(join('folder2', 'file2'))))
    assert.ok(!testObject.affectsConfiguration('files', URI.file('folder3')))
    assert.ok(!testObject.affectsConfiguration('files', URI.file(join('folder3', 'file3'))))
  })

  test('changeEvent - all', () => {
    const configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel())
    configuration.updateFolderConfiguration(URI.file('file1').fsPath, toConfigurationModel({ 'window.zoomLevel': 2, 'window.restoreFullscreen': true }))
    const data = configuration.toData()
    const change = mergeChanges(
      configuration.compareAndUpdateDefaultConfiguration(toConfigurationModel({
        'editor.lineNumbers': 'off',
        '[markdown]': {
          'editor.wordWrap': 'off'
        }
      }), ['editor.lineNumbers', '[markdown]']),
      configuration.compareAndUpdateUserConfiguration(toConfigurationModel({
        '[json]': {
          'editor.lineNumbers': 'relative'
        }
      })),
      configuration.compareAndUpdateWorkspaceConfiguration(toConfigurationModel({ 'window.title': 'custom' })),
      configuration.compareAndDeleteFolderConfiguration(URI.file('file1').fsPath),
      configuration.compareAndUpdateFolderConfiguration(URI.file('file2').fsPath, toConfigurationModel({ 'workbench.editor.enablePreview': true, 'window.restoreWindows': true })))
    const testObject = new ConfigurationChangeEvent(change, data, configuration)
    assert.deepStrictEqual(testObject.affectedKeys, ['editor.lineNumbers', '[markdown]', '[json]', 'window.title', 'window.zoomLevel', 'window.restoreFullscreen', 'workbench.editor.enablePreview', 'window.restoreWindows', 'editor.wordWrap'])

    assert.ok(testObject.affectsConfiguration('window.title'))
    assert.ok(testObject.affectsConfiguration('window.title', URI.file('file1')))
    assert.ok(testObject.affectsConfiguration('window.title', URI.file('file2')))

    assert.ok(testObject.affectsConfiguration('window'))
    assert.ok(testObject.affectsConfiguration('window', URI.file('file1')))
    assert.ok(testObject.affectsConfiguration('window', URI.file('file2')))

    assert.ok(testObject.affectsConfiguration('window.zoomLevel'))
    assert.ok(testObject.affectsConfiguration('window.zoomLevel', URI.file('file1')))
    assert.ok(!testObject.affectsConfiguration('window.zoomLevel', URI.file('file2')))

    assert.ok(testObject.affectsConfiguration('window.restoreFullscreen'))
    assert.ok(testObject.affectsConfiguration('window.restoreFullscreen', URI.file('file1')))
    assert.ok(!testObject.affectsConfiguration('window.restoreFullscreen', URI.file('file2')))

    assert.ok(testObject.affectsConfiguration('window.restoreWindows'))
    assert.ok(testObject.affectsConfiguration('window.restoreWindows', URI.file('file2')))
    assert.ok(!testObject.affectsConfiguration('window.restoreWindows', URI.file('file1')))

    assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview'))
    assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview', URI.file('file2')))
    assert.ok(!testObject.affectsConfiguration('workbench.editor.enablePreview', URI.file('file1')))

    assert.ok(testObject.affectsConfiguration('workbench.editor'))
    assert.ok(testObject.affectsConfiguration('workbench.editor', URI.file('file2')))
    assert.ok(!testObject.affectsConfiguration('workbench.editor', URI.file('file1')))

    assert.ok(testObject.affectsConfiguration('workbench'))
    assert.ok(testObject.affectsConfiguration('workbench', URI.file('file2')))
    assert.ok(!testObject.affectsConfiguration('workbench', URI.file('file1')))

    assert.ok(!testObject.affectsConfiguration('files'))
    assert.ok(!testObject.affectsConfiguration('files', URI.file('file1')))
    assert.ok(!testObject.affectsConfiguration('files', URI.file('file2')))

    assert.ok(testObject.affectsConfiguration('editor'))
    assert.ok(testObject.affectsConfiguration('editor', URI.file('file1')))
    assert.ok(testObject.affectsConfiguration('editor', URI.file('file2')))
    assert.ok(testObject.affectsConfiguration('editor', { uri: URI.file('file1').toString(), languageId: 'json' }))
    assert.ok(testObject.affectsConfiguration('editor', { uri: URI.file('file1').toString(), languageId: 'markdown' }))
    assert.ok(testObject.affectsConfiguration('editor', { uri: URI.file('file1').toString(), languageId: 'typescript' }))
    assert.ok(testObject.affectsConfiguration('editor', { uri: URI.file('file2').toString(), languageId: 'json' }))
    assert.ok(testObject.affectsConfiguration('editor', { uri: URI.file('file2').toString(), languageId: 'markdown' }))
    assert.ok(testObject.affectsConfiguration('editor', { uri: URI.file('file2').toString(), languageId: 'typescript' }))

    assert.ok(testObject.affectsConfiguration('editor.lineNumbers'))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', URI.file('file1')))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', URI.file('file2')))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { uri: URI.file('file1').toString(), languageId: 'json' }))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { uri: URI.file('file1').toString(), languageId: 'markdown' }))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { uri: URI.file('file1').toString(), languageId: 'typescript' }))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { uri: URI.file('file2').toString(), languageId: 'json' }))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { uri: URI.file('file2').toString(), languageId: 'markdown' }))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { uri: URI.file('file2').toString(), languageId: 'typescript' }))

    assert.ok(testObject.affectsConfiguration('editor.wordWrap'))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', URI.file('file1')))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', URI.file('file2')))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { uri: URI.file('file1').toString(), languageId: 'json' }))
    assert.ok(testObject.affectsConfiguration('editor.wordWrap', { uri: URI.file('file1').toString(), languageId: 'markdown' }))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { uri: URI.file('file1').toString(), languageId: 'typescript' }))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { uri: URI.file('file2').toString(), languageId: 'json' }))
    assert.ok(testObject.affectsConfiguration('editor.wordWrap', { uri: URI.file('file2').toString(), languageId: 'markdown' }))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { uri: URI.file('file2').toString(), languageId: 'typescript' }))

    assert.ok(!testObject.affectsConfiguration('editor.fontSize'))
    assert.ok(!testObject.affectsConfiguration('editor.fontSize', URI.file('file1')))
    assert.ok(!testObject.affectsConfiguration('editor.fontSize', URI.file('file2')))
  })

  test('changeEvent affecting tasks and launches', () => {
    const configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel())
    const change = configuration.compareAndUpdateUserConfiguration(toConfigurationModel({
      launch: {
        configuration: {}
      },
      'launch.version': 1,
      tasks: {
        version: 2
      }
    }))
    const testObject = new ConfigurationChangeEvent(change, undefined, configuration)

    assert.deepStrictEqual(testObject.affectedKeys, ['launch', 'launch.version', 'tasks'])
    assert.ok(testObject.affectsConfiguration('launch'))
    assert.ok(testObject.affectsConfiguration('launch.version'))
    assert.ok(testObject.affectsConfiguration('tasks'))
  })
})

describe('AllKeysConfigurationChangeEvent', () => {

  test('changeEvent', () => {
    const configuration = new Configuration(new ConfigurationModel(), new ConfigurationModel(), new ConfigurationModel())
    configuration.updateDefaultConfiguration(toConfigurationModel({
      'editor.lineNumbers': 'off',
      '[markdown]': {
        'editor.wordWrap': 'off'
      }
    }))
    configuration.updateUserConfiguration(toConfigurationModel({
      '[json]': {
        'editor.lineNumbers': 'relative'
      }
    }))
    configuration.updateWorkspaceConfiguration(toConfigurationModel({ 'window.title': 'custom' }))
    configuration.updateFolderConfiguration(URI.file('file1').fsPath, toConfigurationModel({ 'window.zoomLevel': 2, 'window.restoreFullscreen': true }))
    configuration.updateFolderConfiguration(URI.file('file2').fsPath, toConfigurationModel({ 'workbench.editor.enablePreview': true, 'window.restoreWindows': true }))
    const testObject = new AllKeysConfigurationChangeEvent(configuration, ConfigurationTarget.User)

    assert.deepStrictEqual(testObject.affectedKeys, ['editor.lineNumbers', '[markdown]', '[json]', 'window.title', 'window.zoomLevel', 'window.restoreFullscreen', 'workbench.editor.enablePreview', 'window.restoreWindows'])

    assert.ok(testObject.affectsConfiguration('window.title'))
    assert.ok(testObject.affectsConfiguration('window.title', URI.file('file1')))
    assert.ok(testObject.affectsConfiguration('window.title', URI.file('file2')))

    assert.ok(testObject.affectsConfiguration('window'))
    assert.ok(testObject.affectsConfiguration('window', URI.file('file1')))
    assert.ok(testObject.affectsConfiguration('window', URI.file('file2')))

    assert.ok(testObject.affectsConfiguration('window.zoomLevel'))
    assert.ok(testObject.affectsConfiguration('window.zoomLevel', URI.file('file1')))
    assert.ok(!testObject.affectsConfiguration('window.zoomLevel', URI.file('file2')))

    assert.ok(testObject.affectsConfiguration('window.restoreFullscreen'))
    assert.ok(testObject.affectsConfiguration('window.restoreFullscreen', URI.file('file1')))
    assert.ok(!testObject.affectsConfiguration('window.restoreFullscreen', URI.file('file2')))

    assert.ok(testObject.affectsConfiguration('window.restoreWindows'))
    assert.ok(testObject.affectsConfiguration('window.restoreWindows', URI.file('file2')))
    assert.ok(!testObject.affectsConfiguration('window.restoreWindows', URI.file('file1')))

    assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview'))
    assert.ok(testObject.affectsConfiguration('workbench.editor.enablePreview', URI.file('file2')))
    assert.ok(!testObject.affectsConfiguration('workbench.editor.enablePreview', URI.file('file1')))

    assert.ok(testObject.affectsConfiguration('workbench.editor'))
    assert.ok(testObject.affectsConfiguration('workbench.editor', URI.file('file2')))
    assert.ok(!testObject.affectsConfiguration('workbench.editor', URI.file('file1')))

    assert.ok(testObject.affectsConfiguration('workbench'))
    assert.ok(testObject.affectsConfiguration('workbench', URI.file('file2')))
    assert.ok(!testObject.affectsConfiguration('workbench', URI.file('file1')))

    assert.ok(!testObject.affectsConfiguration('files'))
    assert.ok(!testObject.affectsConfiguration('files', URI.file('file1')))
    assert.ok(!testObject.affectsConfiguration('files', URI.file('file2')))

    assert.ok(testObject.affectsConfiguration('editor'))
    assert.ok(testObject.affectsConfiguration('editor', URI.file('file1')))
    assert.ok(testObject.affectsConfiguration('editor', URI.file('file2')))
    assert.ok(testObject.affectsConfiguration('editor', { uri: URI.file('file1').toString(), languageId: 'json' }))
    assert.ok(testObject.affectsConfiguration('editor', { uri: URI.file('file1').toString(), languageId: 'markdown' }))
    assert.ok(testObject.affectsConfiguration('editor', { uri: URI.file('file1').toString(), languageId: 'typescript' }))
    assert.ok(testObject.affectsConfiguration('editor', { uri: URI.file('file2').toString(), languageId: 'json' }))
    assert.ok(testObject.affectsConfiguration('editor', { uri: URI.file('file2').toString(), languageId: 'markdown' }))
    assert.ok(testObject.affectsConfiguration('editor', { uri: URI.file('file2').toString(), languageId: 'typescript' }))

    assert.ok(testObject.affectsConfiguration('editor.lineNumbers'))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', URI.file('file1')))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', URI.file('file2')))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { uri: URI.file('file1').toString(), languageId: 'json' }))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { uri: URI.file('file1').toString(), languageId: 'markdown' }))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { uri: URI.file('file1').toString(), languageId: 'typescript' }))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { uri: URI.file('file2').toString(), languageId: 'json' }))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { uri: URI.file('file2').toString(), languageId: 'markdown' }))
    assert.ok(testObject.affectsConfiguration('editor.lineNumbers', { uri: URI.file('file2').toString(), languageId: 'typescript' }))

    assert.ok(!testObject.affectsConfiguration('editor.wordWrap'))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', URI.file('file1')))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', URI.file('file2')))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { uri: URI.file('file1').toString(), languageId: 'json' }))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { uri: URI.file('file1').toString(), languageId: 'markdown' }))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { uri: URI.file('file1').toString(), languageId: 'typescript' }))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { uri: URI.file('file2').toString(), languageId: 'json' }))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { uri: URI.file('file2').toString(), languageId: 'markdown' }))
    assert.ok(!testObject.affectsConfiguration('editor.wordWrap', { uri: URI.file('file2').toString(), languageId: 'typescript' }))

    assert.ok(!testObject.affectsConfiguration('editor.fontSize'))
    assert.ok(!testObject.affectsConfiguration('editor.fontSize', URI.file('file1')))
    assert.ok(!testObject.affectsConfiguration('editor.fontSize', URI.file('file2')))
  })
})
