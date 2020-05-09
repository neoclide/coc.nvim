import * as decorator from '../../util/decorator'

class CallTest {
  public count = 0

  @decorator.memorize
  public async memorized(): Promise<number> { return ++this.count }
}

describe('memorize', () => {
  test('overlapping', async () => {
    const c = new CallTest()

    const first = c.memorized()
    const second = c.memorized()
    expect(await first).toBe(1)
    expect(await second).toBe(2)
  })
  test('nonoverlapping', async () => {
    const c = new CallTest()

    const first = c.memorized()
    expect(await first).toBe(1)
    const second = c.memorized()
    expect(await second).toBe(1)
  })
})
