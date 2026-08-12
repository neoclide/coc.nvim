import fs from 'fs'
import os from 'os'
import path from 'path'
import { createLogger, emptyFile, getTimestamp, logger, resolveLogFilepath } from '../../logger/index'
import { DEFAULT_LOG_LEVEL, FileLogger, format, LogLevel, stringifyLogLevel, textToLogLevel, toThreeDigits, toTwoDigits } from '../../logger/log'

let filepath: string
afterEach(() => {
  if (filepath && fs.existsSync(filepath)) fs.unlinkSync(filepath)
})

describe('FileLogger', () => {
  it('should have DEFAULT_LOG_LEVEL', () => {
    assert.notStrictEqual(DEFAULT_LOG_LEVEL, undefined)
    assert.notStrictEqual(logger, undefined)
  })

  it('should get LogLevel', () => {
    assert.strictEqual(stringifyLogLevel('' as any), '')
  })

  it('should getTimestamp', () => {
    let res = getTimestamp(new Date())
    assert.notStrictEqual(res, undefined)
  })

  it('should convert digits', () => {
    assert.strictEqual(toTwoDigits(1), '01')
    assert.strictEqual(toTwoDigits(11), '11')
    assert.strictEqual(toThreeDigits(1), '001')
    assert.strictEqual(toThreeDigits(10), '010')
    assert.strictEqual(toThreeDigits(100), '100')
  })

  it('should get level from text', () => {
    assert.strictEqual(textToLogLevel('trace'), LogLevel.Trace)
    assert.strictEqual(textToLogLevel('debug'), LogLevel.Debug)
    assert.strictEqual(textToLogLevel('info'), LogLevel.Info)
    assert.strictEqual(textToLogLevel('error'), LogLevel.Error)
    assert.strictEqual(textToLogLevel('warning'), LogLevel.Warning)
    assert.strictEqual(textToLogLevel('warn'), LogLevel.Warning)
    assert.strictEqual(textToLogLevel('off'), LogLevel.Off)
    assert.strictEqual(textToLogLevel(''), LogLevel.Info)
  })

  it('should format', () => {
    let obj = {
      x: 1,
      y: '2',
      z: {}
    } as any
    obj.z.parent = obj
    let res = format([obj], 2, true, false)
    assert.notStrictEqual(res, undefined)
    res = format([obj])
    assert.notStrictEqual(res, undefined)
  })

  it('should create logger', async () => {
    filepath = path.join(os.tmpdir(), crypto.randomUUID())
    let fileLogger = new FileLogger(filepath, LogLevel.Trace, {
      color: false,
      depth: 2,
      showHidden: false,
      userFormatters: true
    })
    let logger = fileLogger.createLogger('scope')
    logger.log('msg')
    logger.trace('trace', 'data', {}, 1, true)
    logger.debug('debug')
    logger.info('info')
    logger.warn('warn')
    logger.error('error')
    logger.fatal('fatal')
    logger.mark('mark')
    await logger.flush()
    let content = fs.readFileSync(filepath, 'utf8')
    let lines = content.split(/\n/)
    assert.strictEqual(lines.length, 8)
    assert.notStrictEqual(logger.category, undefined)
    assert.notStrictEqual(logger.getLevel(), undefined)
  })

  it('should switch to console', (t) => {
    filepath = path.join(os.tmpdir(), crypto.randomUUID())
    let fileLogger = new FileLogger(filepath, LogLevel.Trace, {})
    let logger = fileLogger.createLogger('scope')
    fileLogger.switchConsole()
    let fn = t.mock.fn()
    let spy = t.mock.method(console, 'error', () => {
      fn()
    })
    logger.error('error')
    spy.mock.restore()
    assert.ok((fn).mock.callCount() > 0)
    fn = t.mock.fn()
    spy = t.mock.method(console, 'log', () => {
      fn()
    })
    logger.info('info')
    spy.mock.restore()
    assert.ok((fn).mock.callCount() > 0)
  })

  it('should enable color', async () => {
    filepath = path.join(os.tmpdir(), crypto.randomUUID())
    let fileLogger = new FileLogger(filepath, LogLevel.Trace, {
      color: true
    })
    let logger = fileLogger.createLogger('scope')
    logger.info('msg', 1, true, { foo: 'bar' })
    await logger.flush()
    let content = fs.readFileSync(filepath, 'utf8')
    assert.ok((content.indexOf('\x33')) > (-1))
  })

  it('should change level', () => {
    filepath = path.join(os.tmpdir(), crypto.randomUUID())
    let fileLogger = new FileLogger(filepath, LogLevel.Off, {})
    fileLogger.setLevel(LogLevel.Debug)
    fileLogger.setLevel(LogLevel.Debug)
  })

  it('should work with off level', async () => {
    filepath = path.join(os.tmpdir(), crypto.randomUUID())
    let fileLogger = new FileLogger(filepath, LogLevel.Off, {
      color: false,
      depth: 2,
      showHidden: false,
      userFormatters: true
    })
    let logger = fileLogger.createLogger('scope')
    logger.log('msg')
    logger.trace('trace')
    logger.debug('debug')
    logger.info('info')
    logger.warn('warn')
    logger.error('error')
    logger.fatal('fatal')
    logger.mark('mark')
    await logger.flush()
    assert.strictEqual(fs.existsSync(filepath), false)
  })

  it('should work without formatter', async () => {
    filepath = path.join(os.tmpdir(), crypto.randomUUID())
    let fileLogger = new FileLogger(filepath, LogLevel.Trace, {
      userFormatters: false
    })
    let logger = fileLogger.createLogger('scope')
    logger.log('msg\n')
    await logger.flush()
    let content = fs.readFileSync(filepath, 'utf8')
    let lines = content.split(/\n/)
    assert.strictEqual(lines.length, 2)
  })

  it('should use backup file', async (t) => {
    filepath = path.join(os.tmpdir(), crypto.randomUUID())
    let fileLogger = new FileLogger(filepath, LogLevel.Trace, {
      userFormatters: true
    })
    let logger = fileLogger.createLogger('scope')
    let spy = t.mock.method(fileLogger, 'shouldBackup', () => {
      return true
    })
    for (let i = 0; i < 6; i++) {
      logger.log(1)
    }
    await logger.flush()
    spy.mock.restore()
    let newFile = filepath + `_1`
    assert.strictEqual(fs.existsSync(newFile), true)
  })

  it('should not throw on error', async (t) => {
    filepath = path.join(os.tmpdir(), crypto.randomUUID())
    let fileLogger = new FileLogger(filepath, LogLevel.Trace, {
      userFormatters: false
    })
    let logger = fileLogger.createLogger('scope')
    let fn = t.mock.fn()
    let s = t.mock.method(console, 'error', () => {
      fn()
    })
    let spy = t.mock.method(fileLogger, 'shouldBackup', () => {
      throw new Error('my error')
    })
    logger.log('msg\n')
    await logger.flush()
    assert.ok((fn).mock.callCount() > 0)
    s.mock.restore()
    spy.mock.restore()
  })

  it('should create default logger', () => {
    assert.notStrictEqual(createLogger(), undefined)
  })

  it('should resolveLogFilepath from env', () => {
    let filepath = '/tmp/log'
    process.env.NVIM_COC_LOG_FILE = filepath
    assert.strictEqual(resolveLogFilepath(), filepath)
    process.env.NVIM_COC_LOG_FILE = ''
    process.env.XDG_RUNTIME_DIR = os.tmpdir()
    assert.notStrictEqual(resolveLogFilepath(), undefined)
    process.env.XDG_RUNTIME_DIR = '/dir_not_exists'
    assert.notStrictEqual(resolveLogFilepath(), undefined)
    process.env.XDG_RUNTIME_DIR = ''
    assert.notStrictEqual(resolveLogFilepath(), undefined)
  })

  it('should empty file', async () => {
    emptyFile('/file_not_exists')
    filepath = path.join(os.tmpdir(), crypto.randomUUID())
    fs.writeFileSync(filepath, 'data', 'utf8')
    emptyFile(filepath)
    let content = fs.readFileSync(filepath, 'utf8')
    assert.strictEqual(content.trim().length, 0)
  })
})
