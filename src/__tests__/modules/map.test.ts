import * as assert from 'assert'
import { LinkedMap, LRUCache, Touch } from '../../util/map'

describe('Map', () => {

  test('LinkedMap - Simple', () => {
    const map = new LinkedMap<string, string>()
    map.trimOld(99)
    assert.strictEqual(map.first, undefined)
    assert.strictEqual(map.last, undefined)
    assert.strictEqual(map.shift(), undefined)
    map.set('ak', 'av')
    map.set('bk', 'bv')
    assert.deepStrictEqual([...map.keys()], ['ak', 'bk'])
    assert.deepStrictEqual([...map.values()], ['av', 'bv'])
    assert.strictEqual(map.first, 'av')
    assert.strictEqual(map.last, 'bv')
    map.set('ak', 'av', Touch.AsNew)
    map.set('x', 'av', Touch.AsNew)
    map.set('y', 'av', Touch.AsOld)
    map.set('z', 'av', null)
    map.remove('x')
    map.get('y', null)
    map.shift()
  })

  test('LinkedMap - Touch Old one', () => {
    const map = new LinkedMap<string, string>()
    assert.deepStrictEqual(map.isEmpty(), true)
    map.set('ak', 'av', Touch.AsOld)
    map.set('ak', 'av')
    map.set('ak', 'av', Touch.AsOld)
    assert.deepStrictEqual([...map.keys()], ['ak'])
    assert.deepStrictEqual([...map.values()], ['av'])
    assert.deepStrictEqual(map.isEmpty(), false)
  })

  test('LinkedMap - Touch New one', () => {
    const map = new LinkedMap<string, string>()
    map.set('ak', 'av')
    map.set('ak', 'av', Touch.AsNew)
    assert.deepStrictEqual([...map.keys()], ['ak'])
    assert.deepStrictEqual([...map.values()], ['av'])
  })

  test('LinkedMap - Touch Old two', () => {
    const map = new LinkedMap<string, string>()
    map.set('ak', 'av')
    map.set('bk', 'bv')
    map.set('bk', 'bv', Touch.AsOld)
    assert.deepStrictEqual([...map.keys()], ['bk', 'ak'])
    assert.deepStrictEqual([...map.values()], ['bv', 'av'])
  })

  test('LinkedMap - Touch New two', () => {
    const map = new LinkedMap<string, string>()
    map.set('ak', 'av')
    map.set('bk', 'bv')
    map.set('ak', 'av', Touch.AsNew)
    assert.deepStrictEqual([...map.keys()], ['bk', 'ak'])
    assert.deepStrictEqual([...map.values()], ['bv', 'av'])
  })

  test('LinkedMap - Touch Old from middle', () => {
    const map = new LinkedMap<string, string>()
    map.set('ak', 'av')
    map.set('bk', 'bv')
    map.set('ck', 'cv')
    map.set('bk', 'bv', Touch.AsOld)
    assert.deepStrictEqual([...map.keys()], ['bk', 'ak', 'ck'])
    assert.deepStrictEqual([...map.values()], ['bv', 'av', 'cv'])
  })

  test('LinkedMap - Touch New from middle', () => {
    const map = new LinkedMap<string, string>()
    map.set('ak', 'av')
    map.set('bk', 'bv')
    map.set('ck', 'cv')
    map.set('bk', 'bv', Touch.AsNew)
    assert.deepStrictEqual([...map.keys()], ['ak', 'ck', 'bk'])
    assert.deepStrictEqual([...map.values()], ['av', 'cv', 'bv'])
  })

  test('LinkedMap - basics', function() {
    const map = new LinkedMap<string, any>()

    assert.strictEqual(map.size, 0)

    map.set('1', 1)
    map.set('2', '2')
    map.set('3', true)

    const obj = Object.create(null)
    map.set('4', obj)

    const date = Date.now()
    map.set('5', date)

    assert.strictEqual(map.size, 5)
    assert.strictEqual(map.get('1'), 1)
    assert.strictEqual(map.get('2'), '2')
    assert.strictEqual(map.get('3'), true)
    assert.strictEqual(map.get('4'), obj)
    assert.strictEqual(map.get('5'), date)
    assert.ok(!map.get('6'))

    map.delete('6')
    assert.strictEqual(map.size, 5)
    assert.strictEqual(map.delete('1'), true)
    assert.strictEqual(map.delete('2'), true)
    assert.strictEqual(map.delete('3'), true)
    assert.strictEqual(map.delete('4'), true)
    assert.strictEqual(map.delete('5'), true)

    assert.strictEqual(map.size, 0)
    assert.ok(!map.get('5'))
    assert.ok(!map.get('4'))
    assert.ok(!map.get('3'))
    assert.ok(!map.get('2'))
    assert.ok(!map.get('1'))

    map.set('1', 1)
    map.set('2', '2')
    map.set('3', true)

    assert.ok(map.has('1'))
    assert.strictEqual(map.get('1'), 1)
    assert.strictEqual(map.get('2'), '2')
    assert.strictEqual(map.get('3'), true)

    map.clear()

    assert.strictEqual(map.size, 0)
    assert.ok(!map.get('1'))
    assert.ok(!map.get('2'))
    assert.ok(!map.get('3'))
    assert.ok(!map.has('1'))
  })

  test('LinkedMap - Iterators', () => {
    const map = new LinkedMap<number, any>()
    map.set(1, 1)
    map.set(2, 2)
    map.set(3, 3)

    for (const elem of map.keys()) {
      assert.ok(elem)
    }

    for (const elem of map.values()) {
      assert.ok(elem)
    }

    for (const elem of map.entries()) {
      assert.ok(elem)
    }

    {
      const keys = map.keys()
      const values = map.values()
      const entries = map.entries()
      map.get(1)
      keys.next()
      values.next()
      entries.next()
    }

    {
      const keys = map.keys()
      const values = map.values()
      const entries = map.entries()
      map.get(1, Touch.AsNew)

      let exceptions = 0
      try {
        keys.next()
      } catch (err) {
        exceptions++
      }
      try {
        values.next()
      } catch (err) {
        exceptions++
      }
      try {
        entries.next()
      } catch (err) {
        exceptions++
      }

      assert.strictEqual(exceptions, 3)
    }
  })

  test('LinkedMap - LRU Cache simple', () => {
    const cache = new LRUCache<number, number>(5)
    assert.strictEqual(cache.limit, 5)
      ;[1, 2, 3, 4, 5].forEach(value => cache.set(value, value))
    assert.strictEqual(cache.ratio, 1)
    assert.strictEqual(cache.size, 5)
    cache.set(6, 6)
    assert.strictEqual(cache.size, 5)
    assert.deepStrictEqual([...cache.keys()], [2, 3, 4, 5, 6])
    cache.set(7, 7)
    assert.strictEqual(cache.size, 5)
    assert.deepStrictEqual([...cache.keys()], [3, 4, 5, 6, 7])
    const values: number[] = [];
    [3, 4, 5, 6, 7].forEach(key => values.push(cache.get(key)!))
    assert.deepStrictEqual(values, [3, 4, 5, 6, 7])
    cache.ratio = 0.2
    cache.ratio = 0.8
    cache.limit = 0
    assert.strictEqual(cache.size, 0)
  })

  test('LinkedMap - LRU Cache get', () => {
    const cache = new LRUCache<number, number>(5);

    [1, 2, 3, 4, 5].forEach(value => cache.set(value, value))
    assert.strictEqual(cache.size, 5)
    assert.deepStrictEqual([...cache.keys()], [1, 2, 3, 4, 5])
    cache.get(3)
    assert.deepStrictEqual([...cache.keys()], [1, 2, 4, 5, 3])
    cache.peek(4)
    assert.deepStrictEqual([...cache.keys()], [1, 2, 4, 5, 3])
    const values: number[] = [];
    [1, 2, 3, 4, 5].forEach(key => values.push(cache.get(key)!))
    assert.deepStrictEqual(values, [1, 2, 3, 4, 5])
  })

  test('LinkedMap - LRU Cache limit', () => {
    const cache = new LRUCache<number, number>(10)

    for (let i = 1; i <= 10; i++) {
      cache.set(i, i)
    }
    assert.strictEqual(cache.size, 10)
    cache.limit = 5
    assert.strictEqual(cache.size, 5)
    assert.deepStrictEqual([...cache.keys()], [6, 7, 8, 9, 10])
    cache.limit = 20
    assert.strictEqual(cache.size, 5)
    for (let i = 11; i <= 20; i++) {
      cache.set(i, i)
    }
    assert.deepStrictEqual(cache.size, 15)
    const values: number[] = []
    for (let i = 6; i <= 20; i++) {
      values.push(cache.get(i)!)
      assert.strictEqual(cache.get(i), i)
    }
    assert.deepStrictEqual([...cache.values()], values)
  })

  test('LinkedMap - LRU Cache limit with ratio', () => {
    const cache = new LRUCache<number, number>(10, 0.5)

    for (let i = 1; i <= 10; i++) {
      cache.set(i, i)
    }
    assert.strictEqual(cache.size, 10)
    cache.set(11, 11)
    assert.strictEqual(cache.size, 5)
    assert.deepStrictEqual([...cache.keys()], [7, 8, 9, 10, 11])
    const values: number[] = [];
    [...cache.keys()].forEach(key => values.push(cache.get(key)!))
    assert.deepStrictEqual(values, [7, 8, 9, 10, 11])
    assert.deepStrictEqual([...cache.values()], values)
  })

  test('LinkedMap - toJSON / fromJSON', () => {
    let map = new LinkedMap<string, string>()
    map.set('ak', 'av')
    map.set('bk', 'bv')
    map.set('ck', 'cv')

    const json = map.toJSON()
    map = new LinkedMap<string, string>()
    map.fromJSON(json)

    let i = 0
    map.forEach((value, key) => {
      if (i === 0) {
        assert.strictEqual(key, 'ak')
        assert.strictEqual(value, 'av')
      } else if (i === 1) {
        assert.strictEqual(key, 'bk')
        assert.strictEqual(value, 'bv')
      } else if (i === 2) {
        assert.strictEqual(key, 'ck')
        assert.strictEqual(value, 'cv')
      }
      i++
    })
    i = 0
    assert.throws(() => {
      map.forEach(function(this: object) {
        assert.deepStrictEqual(this, {})
        if (i == 2) {
          map.set('1', '')
        }
        i++
      }, {})
    })
    i = 0
    for (let _item of map) {
      i++
    }
    assert.strictEqual(i, 4)
  })

  test('LinkedMap - delete Head and Tail', function() {
    const map = new LinkedMap<string, number>()

    assert.strictEqual(map.size, 0)

    map.set('1', 1)
    assert.strictEqual(map.size, 1)
    map.delete('1')
    assert.strictEqual(map.get('1'), undefined)
    assert.strictEqual(map.size, 0)
    assert.strictEqual([...map.keys()].length, 0)
  })

  test('LinkedMap - delete Head', function() {
    const map = new LinkedMap<string, number>()

    assert.strictEqual(map.size, 0)

    map.set('1', 1)
    map.set('2', 2)
    assert.strictEqual(map.size, 2)
    map.delete('1')
    assert.strictEqual(map.get('2'), 2)
    assert.strictEqual(map.size, 1)
    assert.strictEqual([...map.keys()].length, 1)
    assert.strictEqual([...map.keys()][0], '2')
  })

  test('LinkedMap - delete Tail', function() {
    const map = new LinkedMap<string, number>()

    assert.strictEqual(map.size, 0)

    map.set('1', 1)
    map.set('2', 2)
    assert.strictEqual(map.size, 2)
    map.delete('2')
    assert.strictEqual(map.get('1'), 1)
    assert.strictEqual(map.size, 1)
    assert.strictEqual([...map.keys()].length, 1)
    assert.strictEqual([...map.keys()][0], '1')
  })
})
