import * as decorator from '../../util/decorator'

class CallTest {
  public count = 0

  @decorator.combineConcurrent
  public async combinedConcurrent() : Promise<number> { return ++this.count }
}

describe('combineConcurrent', () => {
  test('overlapping', async () => {
    const c = new CallTest()

    const first = c.combinedConcurrent()
    const second = c.combinedConcurrent()
    expect(await first).toBe(1)
    expect(await second).toBe(1)
  })
  test('nonoverlapping', async () => {
    const c = new CallTest()

    const first = c.combinedConcurrent()
    expect(await first).toBe(1)
    const second = c.combinedConcurrent()
    expect(await second).toBe(2)
  })
})
