import { initStrWidthWasm, StrWidth, StrWidthWasi } from '../../model/strwidth'

let api: StrWidthWasi
beforeAll(async () => {
  api = await initStrWidthWasm()
})

describe('strWidth', () => {
  it('should get display width', async () => {
    let sw = new StrWidth(api)
    sw.setAmbw(true)
    expect(sw.getWidth('')).toBe(0)
    expect(sw.getWidth('foo')).toBe(3)
    expect(sw.getWidth('嘻嘻')).toBe(4)
  })

  it('should slice when content too long', async () => {
    let sw = new StrWidth(api)
    expect(sw.getWidth('p'.repeat(8192))).toBe(4095)
  })

  it('should use cache', async () => {
    let sw = new StrWidth(api)
    expect(sw.getWidth(' ', true)).toBe(1)
    expect(sw.getWidth(' ', true)).toBe(1)
    expect(sw.getWidth(' ', true)).toBe(1)
  })
})
