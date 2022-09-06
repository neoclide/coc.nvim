import * as assert from 'assert'
import { ParseError } from 'jsonc-parser'
import { getConfigurationValue, overrideIdentifiersFromKey, scopeToOverrides, mergeConfigProperties, convertTarget, removeFromValueTree, mergeChanges, toJSONObject, addToValueTree } from '../../configuration/util'
import { ConfigurationTarget, ConfigurationUpdateTarget } from '../../types'

describe('Configuration utils', () => {
  it('should convertTarget', async () => {
    expect(convertTarget(ConfigurationUpdateTarget.Global)).toBe(ConfigurationTarget.User)
    expect(convertTarget(ConfigurationUpdateTarget.Workspace)).toBe(ConfigurationTarget.Workspace)
    expect(convertTarget(ConfigurationUpdateTarget.WorkspaceFolder)).toBe(ConfigurationTarget.WorkspaceFolder)
  })

  it('should scopeToOverrides', async () => {
    expect(scopeToOverrides(null)).toBeUndefined()
  })

  it('should get overrideIdentifiersFromKey', async () => {
    let res = overrideIdentifiersFromKey('[ ]')
    expect(res).toEqual([])
  })

  it('should merge preperties', async () => {
    let res = mergeConfigProperties({
      foo: 'bar',
      "x.y.a": "x",
      "x.y.b": "y",
      "x.t": "z"
    })
    expect(res).toEqual({
      foo: 'bar', x: { y: { a: 'x', b: 'y' }, t: 'z' }
    })
  })

  it('should addToValueTree conflict #1', async () => {
    let fn = jest.fn()
    let obj = { x: 66 }
    addToValueTree(obj, 'x.y', '3', () => {
      fn()
    })
    expect(fn).toBeCalled()
  })

  it('should addToValueTree conflict #2', async () => {
    let fn = jest.fn()
    addToValueTree(undefined, 'x', '3', () => {
      fn()
    })
    expect(fn).toBeCalled()
  })

  it('should addToValueTree conflict #3', async () => {
    let obj = { x: true }
    let fn = jest.fn()
    addToValueTree(obj, 'x.y', ['foo'], () => {
      fn()
    })
    expect(fn).toBeCalled()
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
    expect(res).toBe(2)
    res = getConfigurationValue(root, 'foo.from', 1)
    expect(res).toEqual({ to: 2 })
  })

  it('should get json object', async () => {
    let obj = [{ x: 1 }, { y: 2 }]
    expect(toJSONObject(obj)).toEqual(obj)
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
