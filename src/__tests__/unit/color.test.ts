import { Color } from 'vscode-languageserver-types'
import { isDark, toHexString } from '../../util/color'

describe('color utilities', () => {
  it('should convert colors to hex strings', () => {
    assert.strictEqual(toHexString(Color.create(0, 0, 0, 1)), '000000')
    assert.strictEqual(toHexString(Color.create(1, 1, 1, 1)), 'ffffff')
    assert.strictEqual(toHexString(Color.create(1, 0, 0, 1)), 'ff0000')
    assert.strictEqual(toHexString(Color.create(0, 1, 0, 1)), '00ff00')
    assert.strictEqual(toHexString(Color.create(0, 0, 1, 1)), '0000ff')
  })

  it('should round half steps in hex conversion', () => {
    assert.strictEqual(toHexString(Color.create(0.5, 0.5, 0.5, 1)), '808080')
  })

  it('should detect dark colors', () => {
    assert.strictEqual(isDark(Color.create(0, 0, 0, 1)), true)
    assert.strictEqual(isDark(Color.create(0.02, 0.02, 0.02, 1)), true)
    assert.strictEqual(isDark(Color.create(1, 0, 0, 1)), true)
    assert.strictEqual(isDark(Color.create(0, 0, 1, 1)), true)
  })

  it('should detect light colors', () => {
    assert.strictEqual(isDark(Color.create(1, 1, 1, 1)), false)
    assert.strictEqual(isDark(Color.create(0, 1, 0, 1)), false)
  })
})
