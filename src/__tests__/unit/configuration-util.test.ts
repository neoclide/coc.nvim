import * as assert from 'assert'
import os from 'os'
import { ParseError } from 'jsonc-parser'
import { addToValueTree, toValuesTree, convertErrors, convertTarget, expand, expandObject, getConfigurationValue, getDefaultValue, mergeChanges, mergeConfigProperties, overrideIdentifiersFromKey, removeFromValueTree, scopeToOverrides, toJSONObject } from '../../configuration/util'
import { ConfigurationTarget, ConfigurationUpdateTarget } from '../../configuration/types'
import { describe, it, test } from 'node:test'

describe('Configuration utils', () => {
  it('convert parse errors', () => {
    let content = 'foo'
    let errors: ParseError[] = []
    errors.push({ error: 2, length: 10, offset: 1 })
    let arr = convertErrors(content, errors)
    assert.strictEqual(arr.length, 1)
  })

  it('get default value', () => {
    assert.strictEqual(getDefaultValue(undefined), null)
    assert.strictEqual(getDefaultValue('string'), '')
    assert.strictEqual(getDefaultValue(['string']), '')
    assert.strictEqual(getDefaultValue('boolean'), false)
    assert.strictEqual(getDefaultValue('integer'), 0)
    assert.strictEqual(getDefaultValue('number'), 0)
    assert.deepStrictEqual(getDefaultValue('array'), [])
    assert.deepStrictEqual(getDefaultValue('object'), {})
  })

  it('should expand', () => {
    assert.strictEqual(expand('${userHome}'), os.homedir())
    assert.strictEqual(expand('${cwd}'), process.cwd())
    assert.strictEqual(expand('${env:NODE_ENV}'), 'test')
    assert.strictEqual(expand('${env:NOT_EXISTS}'), '${env:NOT_EXISTS}')
    assert.strictEqual(expandObject('${env:NODE_ENV}'), 'test')
    assert.strictEqual(expandObject(undefined), undefined)
    let obj = {
      list: ['${env:NODE_ENV}', '', 1],
      val: '${env:NODE_ENV}'
    }
    let res = expandObject(obj)
    assert.deepStrictEqual(res, { list: ['test', '', 1], val: 'test' })
  })

  it('should convertTarget', () => {
    assert.strictEqual(convertTarget(ConfigurationUpdateTarget.Global), ConfigurationTarget.User)
    assert.strictEqual(convertTarget(ConfigurationUpdateTarget.Workspace), ConfigurationTarget.Workspace)
    assert.strictEqual(convertTarget(ConfigurationUpdateTarget.WorkspaceFolder), ConfigurationTarget.WorkspaceFolder)
  })

  it('should scopeToOverrides', () => {
    assert.strictEqual(scopeToOverrides(null), undefined)
  })

  it('should get overrideIdentifiersFromKey', () => {
    let res = overrideIdentifiersFromKey('[ ]')
    assert.deepStrictEqual(res, [])
  })

  it('should merge properties', () => {
    let res = mergeConfigProperties({
      foo: 'bar',
      "x.y.a": "x",
      "x.y.b": "y",
      "x.t": "z"
    })
    assert.deepStrictEqual(res, {
      foo: 'bar', x: { y: { a: 'x', b: 'y' }, t: 'z' }
    })
  })

  it('should toValuesTree', () => {
    let res = toValuesTree({
      'x.y.z': '${env:NODE_ENV}',
      env: '${env:NODE_ENV}'
    }, () => {}, true)
    // toValuesTree builds null-prototype objects; deepEqual (like Vitest
    // toEqual) ignores prototypes while deepStrictEqual does not.
    assert.deepEqual(res, {
      x: {
        y: {
          z: 'test'
        }
      },
      env: 'test'
    })
  })

  it('should addToValueTree conflict #1', t => {
    let fn = t.mock.fn()
    let obj = { x: 66 }
    addToValueTree(obj, 'x.y', '3', () => {
      fn()
    }, true)
    addToValueTree(obj, 'x.y', '3', () => {})
    assert.ok(fn.mock.callCount() > 0)
  })

  it('should addToValueTree conflict #2', t => {
    let fn = t.mock.fn()
    addToValueTree(undefined, 'x', '3', () => {
      fn()
    })
    addToValueTree(undefined, 'x', '3', () => {})
    assert.ok(fn.mock.callCount() > 0)
  })

  it('should addToValueTree conflict #3', t => {
    let obj = { x: true }
    let fn = t.mock.fn()
    addToValueTree(obj, 'x.y', ['foo'], () => {
      fn()
    })
    assert.ok(fn.mock.callCount() > 0)
  })

  it('removeFromValueTree: remove a non existing key', () => {
    let target = { a: { b: 2 } }
    removeFromValueTree(target, 'c')
    assert.deepStrictEqual(target, { a: { b: 2 } })
    removeFromValueTree(target, 'c.d.e')
    assert.deepStrictEqual(target, { a: { b: 2 } })
  })

  it('removeFromValueTree: remove a multi segmented key from an object that has only sub sections of the key', () => {
    let target = { a: { b: 2 } }

    removeFromValueTree(target, 'a.b.c')

    assert.deepStrictEqual(target, { a: { b: 2 } })
  })

  it('removeFromValueTree: remove a single segmented key', () => {
    let target = { a: 1 }

    removeFromValueTree(target, 'a')

    assert.deepStrictEqual(target, {})
  })

  it('removeFromValueTree: remove a single segmented key when its value is undefined', () => {
    let target = { a: undefined }

    removeFromValueTree(target, 'a')

    assert.deepStrictEqual(target, {})
  })

  it('removeFromValueTree: remove a multi segmented key when its value is undefined', () => {
    let target = { a: { b: 1 } }

    removeFromValueTree(target, 'a.b')

    assert.deepStrictEqual(target, {})
  })

  it('removeFromValueTree: remove a multi segmented key when its value is array', () => {
    let target = { a: { b: [1] } }

    removeFromValueTree(target, 'a.b')

    assert.deepStrictEqual(target, {})
  })

  it('removeFromValueTree: remove a multi segmented key first segment value is array', () => {
    let target = { a: [1] }

    removeFromValueTree(target, 'a.0')

    assert.deepStrictEqual(target, { a: [1] })
  })

  it('removeFromValueTree: remove when key is the first segment', () => {
    let target = { a: { b: 1 } }

    removeFromValueTree(target, 'a')

    assert.deepStrictEqual(target, {})
  })

  it('removeFromValueTree: remove a multi segmented key when the first node has more values', () => {
    let target = { a: { b: { c: 1 }, d: 1 } }

    removeFromValueTree(target, 'a.b.c')

    assert.deepStrictEqual(target, { a: { d: 1 } })
  })

  it('removeFromValueTree: remove a multi segmented key when in between node has more values', () => {
    let target = { a: { b: { c: { d: 1 }, d: 1 } } }

    removeFromValueTree(target, 'a.b.c.d')

    assert.deepStrictEqual(target, { a: { b: { d: 1 } } })
  })

  it('removeFromValueTree: remove a multi segmented key when the last but one node has more values', () => {
    let target = { a: { b: { c: 1, d: 1 } } }

    removeFromValueTree(target, 'a.b.c')

    assert.deepStrictEqual(target, { a: { b: { d: 1 } } })
  })

  it('should convert errors', () => {
    let errors: ParseError[] = []
    for (let i = 0; i < 17; i++) {
      errors.push({
        error: i,
        offset: 0,
        length: 10
      })
    }
    // let res = convertErrors('file:///1', 'abc', errors)
    // expect(res.length).toBe(17)
  })

  it('should get configuration value', () => {
    let root = {
      foo: {
        bar: 1,
        from: {
          to: 2
        }
      },
      bar: [1, 2]
    }
    let res = getConfigurationValue(root, 'foo.from.to', 1)
    assert.strictEqual(res, 2)
    res = getConfigurationValue(root, 'foo.from', 1)
    assert.deepStrictEqual(res, { to: 2 })
  })

  it('should get json object', () => {
    let obj = [{ x: 1 }, { y: 2 }]
    assert.deepEqual(toJSONObject(obj), obj)
  })
})

describe('mergeChanges', () => {
  test('merge only keys', () => {
    const actual = mergeChanges({ keys: ['a', 'b'], overrides: [] }, { keys: ['c', 'd'], overrides: [] })
    assert.deepStrictEqual(actual, { keys: ['a', 'b', 'c', 'd'], overrides: [] })
  })

  test('merge only keys with duplicates', () => {
    const actual = mergeChanges({ keys: ['a', 'b'], overrides: [] }, { keys: ['c', 'd'], overrides: [] }, { keys: ['a', 'd', 'e'], overrides: [] })
    assert.deepStrictEqual(actual, { keys: ['a', 'b', 'c', 'd', 'e'], overrides: [] })
  })

  test('merge only overrides', () => {
    const actual = mergeChanges({ keys: [], overrides: [['a', ['1', '2']]] }, { keys: [], overrides: [['b', ['3', '4']]] })
    assert.deepStrictEqual(actual, { keys: [], overrides: [['a', ['1', '2']], ['b', ['3', '4']]] })
  })

  test('merge only overrides with duplicates', () => {
    const actual = mergeChanges({ keys: [], overrides: [['a', ['1', '2']], ['b', ['5', '4']]] }, { keys: [], overrides: [['b', ['3', '4']]] }, { keys: [], overrides: [['c', ['1', '4']], ['a', ['2', '3']]] })
    assert.deepStrictEqual(actual, { keys: [], overrides: [['a', ['1', '2', '3']], ['b', ['5', '4', '3']], ['c', ['1', '4']]] })
  })

  test('merge', () => {
    const actual = mergeChanges({ keys: ['b', 'b'], overrides: [['a', ['1', '2']], ['b', ['5', '4']]] }, { keys: ['b'], overrides: [['b', ['3', '4']]] }, { keys: ['c', 'a'], overrides: [['c', ['1', '4']], ['a', ['2', '3']]] })
    assert.deepStrictEqual(actual, { keys: ['b', 'c', 'a'], overrides: [['a', ['1', '2', '3']], ['b', ['5', '4', '3']], ['c', ['1', '4']]] })
  })

  test('merge single change', () => {
    const actual = mergeChanges({ keys: ['b', 'b'], overrides: [['a', ['1', '2']], ['b', ['5', '4']]] })
    assert.deepStrictEqual(actual, { keys: ['b', 'b'], overrides: [['a', ['1', '2']], ['b', ['5', '4']]] })
  })

  test('merge no changes', () => {
    const actual = mergeChanges()
    assert.deepStrictEqual(actual, { keys: [], overrides: [] })
  })
})
