/* eslint-disable */
import assert from 'assert'
import { spawn } from 'child_process'
import { NotificationType, NotificationType1, RequestType, RequestType1 } from 'vscode-languageserver-protocol'
import { checkProcessDied, handleChildProcessStartError } from '../../language-client/index'
import { data2String, fixNotificationType, fixRequestType, getLocale, getParameterStructures, getTracePrefix, isValidNotificationType, isValidRequestType, parseTraceData } from '../../language-client/utils'
import { Delayer } from '../../language-client/utils/async'
import { CloseAction, DefaultErrorHandler, ErrorAction, toCloseHandlerResult } from '../../language-client/utils/errorHandler'
import { ConsoleLogger, NullLogger } from '../../language-client/utils/logger'
import { wait } from '../../util/index'
import helper from '../helper'

test('Logger', () => {
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

test('checkProcessDied', async () => {
  checkProcessDied(undefined)
  let child = spawn('sleep', ['3'], { cwd: process.cwd(), detached: true })
  checkProcessDied(child)
  await wait(20)
  assert.rejects(async () => {
    await handleChildProcessStartError(null, 'msg')
  })
})

test('getLocale', () => {
  process.env.LANG = ''
  expect(getLocale()).toBe('en')
  process.env.LANG = 'en_US.UTF-8'
  expect(getLocale()).toBe('en_US')
})

test('getTraceMessage', () => {
  expect(getTracePrefix({})).toMatch('Trace')
  expect(getTracePrefix({ isLSPMessage: true, type: 'request' })).toMatch('LSP')
})

test('getParameterStructures', () => {
  expect(getParameterStructures('auto').toString()).toBe('auto')
  // test all the cased of getParameterStructures
  expect(getParameterStructures('byPosition').toString()).toBe('byPosition')
  expect(getParameterStructures('byName').toString()).toBe('byName')
  expect(getParameterStructures('unknown').toString()).toBe('auto')
})

test('isValidRequestType', () => {
  expect(isValidRequestType('test')).toBe(true)
  expect(isValidRequestType({ method: 'test' })).toBe(false)
  expect(isValidRequestType(new RequestType('test'))).toBe(true)
})

test('isValidNotificationType', () => {
  expect(isValidNotificationType('test')).toBe(true)
  expect(isValidNotificationType({ method: 'test' })).toBe(false)
  expect(isValidNotificationType(new NotificationType('test'))).toBe(true)
})

test('fixRequestType', () => {
  expect(fixRequestType('test', [])).toBe('test')
  for (let i = 0; i <= 10; i++) {
    let type = { method: 'test', numberOfParams: i }
    expect(fixRequestType(type, [])).toBeDefined()
  }
  let type = { method: 'test', numberOfParams: 1, parameterStructures: 'auto' }
  let res = fixRequestType(type, []) as RequestType1<unknown, undefined, undefined>
  expect(res.numberOfParams).toBe(1)
  expect(res.parameterStructures).toBeDefined()
})

test('fixNotificationType', () => {
  expect(fixNotificationType('test', [])).toBe('test')
  for (let i = 0; i <= 10; i++) {
    let type = { method: 'test', numberOfParams: i }
    expect(fixNotificationType(type, [])).toBeDefined()
  }
  let type = { method: 'test', numberOfParams: 1, parameterStructures: 'auto' }
  let res = fixNotificationType(type, []) as NotificationType1<unknown>
  expect(res.numberOfParams).toBe(1)
  expect(res.parameterStructures).toBeDefined()
})

test('data2String', () => {
  let err = new Error('my error')
  err.stack = undefined
  let text = data2String(err)
  expect(text).toMatch('error')
})

test('parseTraceData', () => {
  expect(parseTraceData({})).toBe('{}')
  expect(parseTraceData('msg')).toMatch('msg')
  expect(parseTraceData('Params: data')).toMatch('data')
  expect(parseTraceData('Result: {"foo": "bar"}')).toMatch('bar')
})

test('DefaultErrorHandler', async () => {
  let spy = jest.spyOn(console, 'error').mockImplementation(() => {
    // ignore
  })
  let handler = new DefaultErrorHandler('test', 2)
  expect(handler.error(new Error('test'), { jsonrpc: '' }, 1).action).toBe(ErrorAction.Continue)
  expect(handler.error(new Error('test'), { jsonrpc: '' }, 5).action).toBe(ErrorAction.Shutdown)
  handler.closed()
  handler.milliseconds = 1
  await wait(10)
  let res = handler.closed()
  expect(res.action).toBe(CloseAction.Restart)
  handler.milliseconds = 10 * 1000
  res = handler.closed()
  expect(res.action).toBe(CloseAction.DoNotRestart)
  spy.mockRestore()
  expect(toCloseHandlerResult(CloseAction.DoNotRestart)).toBeDefined()
  handler = new DefaultErrorHandler('test', 1, helper.createNullChannel())
  handler.closed()
})

test('Delayer', () => {
  let count = 0
  let factory = () => {
    return Promise.resolve(++count)
  }

  let delayer = new Delayer(0)
  let promises: Thenable<any>[] = []

  assert(!delayer.isTriggered())
  delayer.trigger(factory, -1)

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
