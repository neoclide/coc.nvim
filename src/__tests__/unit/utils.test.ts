import assert from 'assert'
import { spawn } from 'child_process'
import { NotificationType, NotificationType1, RequestType, RequestType1 } from 'vscode-languageserver-protocol'
import { checkProcessDied, handleChildProcessStartError } from '../../language-client/index'
import { data2String, fixNotificationType, fixRequestType, getLocale, getParameterStructures, getTracePrefix, isValidNotificationType, isValidRequestType, parseTraceData } from '../../language-client/utils'
import { Delayer } from '../../language-client/utils/async'
import { CloseAction, DefaultErrorHandler, ErrorAction, toCloseHandlerResult } from '../../language-client/utils/errorHandler'
import { ConsoleLogger, NullLogger } from '../../language-client/utils/logger'
import { wait } from '../../util/index'
import { test } from 'node:test'

const nullChannel = {
  content: '',
  show: () => {},
  dispose: () => {},
  name: 'null',
  append: () => {},
  appendLine: () => {},
  clear: () => {},
  hide: () => {}
}

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
  await assert.rejects(async () => {
    await handleChildProcessStartError(null, 'msg')
  })
})

test('getLocale', () => {
  process.env.LANG = ''
  assert.strictEqual(getLocale(), 'en')
  process.env.LANG = 'en_US.UTF-8'
  assert.strictEqual(getLocale(), 'en_US')
})

test('getTraceMessage', () => {
  assert.match(getTracePrefix({}), /Trace/)
  assert.match(getTracePrefix({ isLSPMessage: true, type: 'request' }), /LSP/)
})

test('getParameterStructures', () => {
  assert.strictEqual(getParameterStructures('auto').toString(), 'auto')
  // test all the cased of getParameterStructures
  assert.strictEqual(getParameterStructures('byPosition').toString(), 'byPosition')
  assert.strictEqual(getParameterStructures('byName').toString(), 'byName')
  assert.strictEqual(getParameterStructures('unknown').toString(), 'auto')
})

test('isValidRequestType', () => {
  assert.strictEqual(isValidRequestType('test'), true)
  assert.strictEqual(isValidRequestType({ method: 'test' }), false)
  assert.strictEqual(isValidRequestType(new RequestType('test')), true)
})

test('isValidNotificationType', () => {
  assert.strictEqual(isValidNotificationType('test'), true)
  assert.strictEqual(isValidNotificationType({ method: 'test' }), false)
  assert.strictEqual(isValidNotificationType(new NotificationType('test')), true)
})

test('fixRequestType', () => {
  assert.strictEqual(fixRequestType('test', []), 'test')
  for (let i = 0; i <= 10; i++) {
    let type = { method: 'test', numberOfParams: i }
    assert.notStrictEqual(fixRequestType(type, []), undefined)
  }
  let type = { method: 'test', numberOfParams: 1, parameterStructures: 'auto' }
  let res = fixRequestType(type, []) as RequestType1<unknown, undefined, undefined>
  assert.strictEqual(res.numberOfParams, 1)
  assert.notStrictEqual(res.parameterStructures, undefined)
})

test('fixNotificationType', () => {
  assert.strictEqual(fixNotificationType('test', []), 'test')
  for (let i = 0; i <= 10; i++) {
    let type = { method: 'test', numberOfParams: i }
    assert.notStrictEqual(fixNotificationType(type, []), undefined)
  }
  let type = { method: 'test', numberOfParams: 1, parameterStructures: 'auto' }
  let res = fixNotificationType(type, []) as NotificationType1<unknown>
  assert.strictEqual(res.numberOfParams, 1)
  assert.notStrictEqual(res.parameterStructures, undefined)
})

test('data2String', () => {
  let err = new Error('my error')
  err.stack = undefined
  let text = data2String(err)
  assert.match(text, /error/)
})

test('parseTraceData', () => {
  assert.strictEqual(parseTraceData({}), '{}')
  assert.match(parseTraceData('msg'), /msg/)
  assert.match(parseTraceData('Params: data'), /data/)
  assert.match(parseTraceData('Result: {"foo": "bar"}'), /bar/)
})

test('DefaultErrorHandler', async t => {
  t.mock.method(console, 'error', () => {
    // ignore
  })
  let handler = new DefaultErrorHandler('test', 2)
  assert.strictEqual(handler.error(new Error('test'), { jsonrpc: '' }, 1).action, ErrorAction.Continue)
  assert.strictEqual(handler.error(new Error('test'), { jsonrpc: '' }, 5).action, ErrorAction.Shutdown)
  handler.closed()
  handler.milliseconds = 1
  await wait(20)
  let res = handler.closed()
  assert.strictEqual(res.action, CloseAction.Restart)
  handler.milliseconds = 10 * 1000
  res = handler.closed()
  assert.strictEqual(res.action, CloseAction.DoNotRestart)
  assert.notStrictEqual(toCloseHandlerResult(CloseAction.DoNotRestart), undefined)
  handler = new DefaultErrorHandler('test', 1, nullChannel as any)
  handler.closed()
})

test('DefaultErrorHandler restart budget', () => {
  let handler = new DefaultErrorHandler('test', 2)
  handler.milliseconds = 60 * 1000
  // Crashes within the restart budget keep restarting.
  assert.strictEqual(handler.closed().action, CloseAction.Restart)
  assert.strictEqual(handler.closed().action, CloseAction.Restart)
  // The crash after the budget reports the actual number of crashes.
  let res = handler.closed()
  assert.strictEqual(res.action, CloseAction.DoNotRestart)
  assert.ok(res.message.includes('crashed 3 times'))
})

test('Delayer', () => {
  let count = 0
  let factory = () => {
    return Promise.resolve(++count)
  }

  let delayer = new Delayer(0)
  let promises: Thenable<any>[] = []

  assert(!delayer.isTriggered())
  void delayer.trigger(factory, -1)

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
  void delayer.trigger(factory).then((result) => { assert.equal(result, 1); assert(!delayer.isTriggered()) })
  await wait(20)
  delayer.forceDelivery()
  assert.strictEqual(count, 1)
  void delayer.trigger(factory)
  void delayer.trigger(factory, -1)
  await wait(20)
  delayer.cancel()
  assert.strictEqual(count, 1)
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
