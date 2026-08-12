import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { initStrWidthWasm, StrWidth, StrWidthWasi } from '../../model/strwidth'

let api: StrWidthWasi
before(async () => {
  api = await initStrWidthWasm()
})

describe('strWidth', () => {
  it('should get display width', async () => {
    let sw = new StrWidth(api)
    sw.setAmbw(true)
    assert.strictEqual(sw.getWidth(''), 0)
    assert.strictEqual(sw.getWidth('foo'), 3)
    assert.strictEqual(sw.getWidth('嘻嘻'), 4)
  })

  it('should slice when content too long', async () => {
    let sw = new StrWidth(api)
    assert.strictEqual(sw.getWidth('p'.repeat(8192)), 4095)
  })

  it('should use cache', async () => {
    let sw = new StrWidth(api)
    assert.strictEqual(sw.getWidth(' ', true), 1)
    assert.strictEqual(sw.getWidth(' ', true), 1)
    assert.strictEqual(sw.getWidth(' ', true), 1)
  })
})
