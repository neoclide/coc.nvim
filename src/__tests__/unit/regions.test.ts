import Regions from '../../model/regions'

describe('Regions', () => {
  it('should add #1', async () => {
    let r = new Regions()
    r.add(1, 2)
    r.add(2, 1)
    assert.deepStrictEqual(r.current, [1, 2])
  })

  it('should add #2', async () => {
    let r = new Regions()
    r.add(3, 4)
    r.add(1, 5)
    assert.deepStrictEqual(r.current, [1, 5])
  })

  it('should add #3', async () => {
    let r = new Regions()
    r.add(2, 3)
    r.add(1, 2)
    assert.deepStrictEqual(r.current, [1, 3])
  })

  it('should add #4', async () => {
    let r = new Regions()
    r.add(2, 5)
    r.add(3, 4)
    assert.deepStrictEqual(r.current, [2, 5])
  })

  it('should add #5', async () => {
    let r = new Regions()
    r.add(3, 4)
    r.add(1, 5)
    assert.deepStrictEqual(r.current, [1, 5])
  })

  it('should add #6', async () => {
    let r = new Regions()
    r.add(1, 2)
    r.add(3, 5)
    assert.deepStrictEqual(r.current, [1, 5])
    r.add(1, 8)
    assert.deepStrictEqual(r.current, [1, 8])
  })

  it('should add #7', async () => {
    let r = new Regions()
    r.add(1, 2)
    r.add(1, 5)
    assert.deepStrictEqual(r.current, [1, 5])
    r.add(9, 10)
    r.add(5, 6)
    assert.deepStrictEqual(r.current, [1, 6, 9, 10])
  })

  it('should check range', async () => {
    let r = new Regions()
    r.add(1, 2)
    r.add(1, 5)
    assert.strictEqual(r.has(3, 5), true)
    assert.strictEqual(r.has(3, 6), false)
    r.add(6, 8)
    assert.strictEqual(r.has(1, 8), true)
  })

  it('should get range', async () => {
    let r = new Regions()
    r.add(1, 2)
    r.add(1, 5)
    assert.strictEqual(r.isEmpty, false)
    assert.strictEqual(r.getRange(8), undefined)
    assert.strictEqual(r.getRange(9), undefined)
    assert.deepStrictEqual(r.getRange(1), [1, 5])
    assert.deepStrictEqual(r.getRange(5), [1, 5])
  })

  it('should get uncovered range', async () => {
    let r = new Regions()
    assert.deepStrictEqual(r.toUncoveredSpan([1, 2], 3, 10), [0, 5])
    r.add(0, 5)
    assert.strictEqual(r.toUncoveredSpan([1, 2], 3, 10), undefined)
    r.add(8, 10)
    assert.deepStrictEqual(r.toUncoveredSpan([4, 6], 3, 20), [5, 8])
  })

  it('should merge spans', async () => {
    assert.deepStrictEqual(Regions.mergeSpans([[0, 1], [1, 2]]), [[0, 2]])
    assert.deepStrictEqual(Regions.mergeSpans([[0, 1], [2, 3]]), [[0, 1], [2, 3]])
    assert.deepStrictEqual(Regions.mergeSpans([[2, 3], [0, 1]]), [[2, 3], [0, 1]])
    assert.deepStrictEqual(Regions.mergeSpans([[1, 4], [0, 5]]), [[0, 5]])
    assert.deepStrictEqual(Regions.mergeSpans([[1, 4], [2, 3]]), [[1, 4]])
    assert.deepStrictEqual(Regions.mergeSpans([[1, 2], [2, 3], [3, 4]]), [[1, 4]])
  })
})
