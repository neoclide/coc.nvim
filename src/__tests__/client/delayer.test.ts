/* eslint-disable */
import assert from 'assert'
import { Delayer } from '../../language-client/utils/async'

test('Delayer', () => {
  let count = 0
  let factory = () => {
    return Promise.resolve(++count)
  }

  let delayer = new Delayer(0)
  let promises: Thenable<any>[] = []

  assert(!delayer.isTriggered())

  promises.push(delayer.trigger(factory).then((result) => { assert.equal(result, 1); assert(!delayer.isTriggered()) }))
  assert(delayer.isTriggered())

  promises.push(delayer.trigger(factory).then((result) => { assert.equal(result, 1); assert(!delayer.isTriggered()) }))
  assert(delayer.isTriggered())

  promises.push(delayer.trigger(factory).then((result) => { assert.equal(result, 1); assert(!delayer.isTriggered()) }))
  assert(delayer.isTriggered())

  return Promise.all(promises).then(() => {
    assert(!delayer.isTriggered())
  }).finally(() => {
    delayer.dispose()
  })
})

/*
test('Delayer - simple cancel', async () => {
  let count = 0
  let factory = () => {
    return Promise.resolve(++count)
  }

  let delayer = new Delayer(10)

  assert(!delayer.isTriggered())

  const p = delayer.trigger(factory).then(() => {
    assert(false)
  }, () => {
    assert(true, 'yes, it was cancelled')
  })
  assert(delayer.isTriggered())
  delayer.cancel()
  assert(!delayer.isTriggered())
  await p
})

test('Delayer - cancel should cancel all calls to trigger', function() {
  let count = 0
  let factory = () => {
    return Promise.resolve(++count)
  }

  let delayer = new Delayer(0)
  let promises: Thenable<any>[] = []

  assert(!delayer.isTriggered())

  promises.push(delayer.trigger(factory).then(null, () => { assert(true, 'yes, it was cancelled') }))
  assert(delayer.isTriggered())

  promises.push(delayer.trigger(factory).then(null, () => { assert(true, 'yes, it was cancelled') }))
  assert(delayer.isTriggered())

  promises.push(delayer.trigger(factory).then(null, () => { assert(true, 'yes, it was cancelled') }))
  assert(delayer.isTriggered())

  delayer.cancel()

  return Promise.all(promises).then(() => {
    assert(!delayer.isTriggered())
  })
})

test('Delayer - trigger, cancel, then trigger again', function() {
  let count = 0
  let factory = () => {
    return Promise.resolve(++count)
  }

  let delayer = new Delayer(0)
  let promises: Thenable<any>[] = []

  assert(!delayer.isTriggered())

  const p = delayer.trigger(factory).then((result) => {
    assert.equal(result, 1)
    assert(!delayer.isTriggered())

    promises.push(delayer.trigger(factory).then(null, () => { assert(true, 'yes, it was cancelled') }))
    assert(delayer.isTriggered())

    promises.push(delayer.trigger(factory).then(null, () => { assert(true, 'yes, it was cancelled') }))
    assert(delayer.isTriggered())

    delayer.cancel()

    const p = Promise.all(promises).then(() => {
      promises = []

      assert(!delayer.isTriggered())

      promises.push(delayer.trigger(factory).then(() => { assert.equal(result, 1); assert(!delayer.isTriggered()) }))
      assert(delayer.isTriggered())

      promises.push(delayer.trigger(factory).then(() => { assert.equal(result, 1); assert(!delayer.isTriggered()) }))
      assert(delayer.isTriggered())

      const p = Promise.all(promises).then(() => {
        assert(!delayer.isTriggered())
      })

      assert(delayer.isTriggered())

      return p
    })

    return p
  })

  assert(delayer.isTriggered())

  return p
})
*/

test('Delayer - last task should be the one getting called', function() {
  let factoryFactory = (n: number) => () => {
    return Promise.resolve(n)
  }

  let delayer = new Delayer(0)
  let promises: Thenable<any>[] = []

  assert(!delayer.isTriggered())

  promises.push(delayer.trigger(factoryFactory(1)).then((n) => { assert.equal(n, 3) }))
  promises.push(delayer.trigger(factoryFactory(2)).then((n) => { assert.equal(n, 3) }))
  promises.push(delayer.trigger(factoryFactory(3)).then((n) => { assert.equal(n, 3) }))

  const p = Promise.all(promises).then(() => {
    assert(!delayer.isTriggered())
  })

  assert(delayer.isTriggered())

  return p
})
