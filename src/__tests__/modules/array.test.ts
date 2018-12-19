import * as assert from 'assert'
import * as arrays from '../../util/array'

describe('Arrays', () => {

  test('distinct', () => {
    function compare(a: string): string {
      return a
    }

    assert.deepStrictEqual(arrays.distinct(['32', '4', '5'], compare), ['32', '4', '5'])
    assert.deepStrictEqual(arrays.distinct(['32', '4', '5', '4'], compare), ['32', '4', '5'])
    assert.deepStrictEqual(arrays.distinct(['32', 'constructor', '5', '1'], compare), ['32', 'constructor', '5', '1'])
    assert.deepStrictEqual(arrays.distinct(['32', 'constructor', 'proto', 'proto', 'constructor'], compare), ['32', 'constructor', 'proto'])
    assert.deepStrictEqual(arrays.distinct(['32', '4', '5', '32', '4', '5', '32', '4', '5', '5'], compare), ['32', '4', '5'])
  })

  test('tail', () => {
    assert.strictEqual(arrays.tail([1, 2, 3]), 3)
  })

  test('lastIndex', () => {
    let res = arrays.lastIndex([1, 2, 3], x => x < 3)
    assert.strictEqual(res, 1)
  })

  test('flatMap', () => {
    let objs: { [key: string]: number[] }[] = [{ x: [1, 2] }, { y: [3, 4] }, { z: [5, 6] }]
    function values(item: { [key: string]: number[] }): number[] {
      return Object.keys(item).reduce((p, c) => p.concat(item[c]), [])
    }
    let res = arrays.flatMap(objs, values)
    assert.deepStrictEqual(res, [1, 2, 3, 4, 5, 6])
  })
})
