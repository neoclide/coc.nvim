/* eslint-disable */
import assert from 'assert'
import { Delayer } from '../../language-client/utils/async'
import { ConsoleLogger, NullLogger } from '../../language-client/utils/logger'
import { wait } from '../../util/index'
import { CloseAction, DefaultErrorHandler, ErrorAction } from '../../language-client/utils/errorHandler'
import helper from '../helper'

test('Logger', async () => {
  const logger = new ConsoleLogger()
  logger.error('error')
  logger.warn('warn')
  logger.info('info')
  logger.log('log')
  const nullLogger = new NullLogger()
  nullLogger.error('error')
  nullLogger.warn('warn')
  nullLogger.info('info')
  nullLogger.log('log')
})

test('DefaultErrorHandler', async () => {
  const handler = new DefaultErrorHandler('test', 2)
  expect(handler.error(new Error('test'), { jsonrpc: '' }, 1)).toBe(ErrorAction.Continue)
  expect(handler.error(new Error('test'), { jsonrpc: '' }, 5)).toBe(ErrorAction.Shutdown)
  handler.closed()
  handler.milliseconds = 1
  await helper.wait(10)
  let res = handler.closed()
  expect(res).toBe(CloseAction.Restart)
  handler.milliseconds = 10 * 1000
  res = handler.closed()
  expect(res).toBe(CloseAction.DoNotRestart)
})

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

test('Delayer - forceDelivery', async () => {
  let count = 0
  let factory = () => {
    return Promise.resolve(++count)
  }

  let delayer = new Delayer(150)
  delayer.forceDelivery()
  delayer.trigger(factory).then((result) => { assert.equal(result, 1); assert(!delayer.isTriggered()) })
  await wait(10)
  delayer.forceDelivery()
  expect(count).toBe(1)
  void delayer.trigger(factory)
  delayer.trigger(factory, -1)
  await wait(10)
  delayer.cancel()
  expect(count).toBe(1)
})

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
