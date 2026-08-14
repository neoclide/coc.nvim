import { getExtensionId, prefixExtensionError, setExtensionId, wrapCallbackWithExtension } from '../../util/extensionId'

describe('extensionId', () => {
  it('should set and get extension id on functions and objects', () => {
    let fn = () => {}
    setExtensionId(fn, 'fn-ext')
    assert.strictEqual(getExtensionId(fn), 'fn-ext')
    let obj = {}
    setExtensionId(obj, 'obj-ext')
    assert.strictEqual(getExtensionId(obj), 'obj-ext')
  })

  it('should return undefined for primitives', () => {
    assert.strictEqual(getExtensionId('text'), undefined)
    assert.strictEqual(getExtensionId(42), undefined)
    assert.strictEqual(getExtensionId(null), undefined)
    assert.strictEqual(getExtensionId(undefined), undefined)
  })

  it('should not throw when tagging frozen objects', () => {
    let frozen = Object.freeze({})
    setExtensionId(frozen, 'frozen-ext')
    assert.strictEqual(getExtensionId(frozen), undefined)
  })

  it('should wrap sync callbacks that throw', () => {
    let wrapped = wrapCallbackWithExtension(() => {
      throw new Error('sync boom')
    }, 'ext')
    assert.throws(() => wrapped(), /\[extension: ext\] sync boom/)
  })

  it('should wrap sync callbacks that return a value', () => {
    let wrapped = wrapCallbackWithExtension(() => 'ok', 'ext')
    assert.strictEqual(wrapped(), 'ok')
    assert.strictEqual(getExtensionId(wrapped), 'ext')
  })

  it('should prefix errors from rejected promises', async () => {
    let wrapped = wrapCallbackWithExtension(async () => {
      throw new Error('async boom')
    }, 'ext')
    await assert.rejects(() => Promise.resolve(wrapped()), /\[extension: ext\] async boom/)
  })

  it('should pass through resolved promise values', async () => {
    let wrapped = wrapCallbackWithExtension(async () => 'resolved', 'ext')
    assert.strictEqual(await Promise.resolve(wrapped()), 'resolved')
  })

  it('should pass through non-Error values', () => {
    let value = { code: 42 }
    assert.strictEqual(prefixExtensionError(value, 'ext'), value)
  })

  it('should preserve already-prefixed messages', () => {
    let err = new Error('[extension: other] already prefixed')
    assert.strictEqual(prefixExtensionError(err, 'ext'), err)
  })

  it('should pass through errors with non-string messages', () => {
    let err: any = new Error('x')
    Object.defineProperty(err, 'message', { value: 42 })
    assert.strictEqual(prefixExtensionError(err, 'ext'), err)
  })

  it('should preserve errors with a throwing message getter', () => {
    let err = new Error('x')
    Object.defineProperty(err, 'message', {
      get() {
        throw new Error('getter boom')
      }
    })
    assert.strictEqual(prefixExtensionError(err, 'ext'), err)
  })

  it('should create a new Error when the original message is frozen', () => {
    let err = new Error('frozen')
    Object.freeze(err)
    let res = prefixExtensionError(err, 'ext') as Error
    assert.match(res.message, /\[extension: ext\] frozen/)
    assert.strictEqual((res as { cause?: unknown }).cause, err)
  })
})
