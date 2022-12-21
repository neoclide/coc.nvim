import { FileLogger, toTwoDigits, toThreeDigits, textToLogLevel, format, DEFAULT_LOG_LEVEL, LogLevel, stringifyLogLevel } from '../../logger/log'
import { createLogger, logger, getTimestamp, resolveLogFilepath, emptyFile } from '../../logger/index'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { v4 as uuid } from 'uuid'

let filepath: string
afterEach(() => {
  if (fs.existsSync(filepath)) fs.unlinkSync(filepath)
})

describe('FileLogger', () => {
  it('should have DEFAULT_LOG_LEVEL', () => {
    expect(DEFAULT_LOG_LEVEL).toBeDefined()
    expect(logger).toBeDefined()
  })

  it('should get LogLevel', () => {
    expect(stringifyLogLevel('' as any)).toBe('')
  })

  it('should getTimestamp', () => {
    let res = getTimestamp(new Date())
    expect(res).toBeDefined()
  })

  it('should convert digits', () => {
    expect(toTwoDigits(1)).toBe('01')
    expect(toTwoDigits(11)).toBe('11')
    expect(toThreeDigits(1)).toBe('001')
    expect(toThreeDigits(10)).toBe('010')
    expect(toThreeDigits(100)).toBe('100')
  })

  it('should get level from text', () => {
    expect(textToLogLevel('trace')).toBe(LogLevel.Trace)
    expect(textToLogLevel('debug')).toBe(LogLevel.Debug)
    expect(textToLogLevel('info')).toBe(LogLevel.Info)
    expect(textToLogLevel('error')).toBe(LogLevel.Error)
    expect(textToLogLevel('warning')).toBe(LogLevel.Warning)
    expect(textToLogLevel('warn')).toBe(LogLevel.Warning)
    expect(textToLogLevel('off')).toBe(LogLevel.Off)
    expect(textToLogLevel('')).toBe(LogLevel.Info)
  })

  it('should format', () => {
    let obj = {
      x: 1,
      y: '2',
      z: {}
    } as any
    obj.z.parent = obj
    let res = format([obj], 2, true, false)
    expect(res).toBeDefined()
    res = format([obj])
    expect(res).toBeDefined()
  })

  it('should create logger', async () => {
    filepath = path.join(os.tmpdir(), uuid())
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
    expect(lines.length).toBe(8)
    expect(logger.category).toBeDefined()
    expect(logger.getLevel()).toBeDefined()
  })

  it('should switch to console', () => {
    filepath = path.join(os.tmpdir(), uuid())
    let fileLogger = new FileLogger(filepath, LogLevel.Trace, {})
    let logger = fileLogger.createLogger('scope')
    fileLogger.switchConsole()
    let fn = jest.fn()
    let spy = jest.spyOn(console, 'error').mockImplementation(() => {
      fn()
    })
    logger.error('error')
    spy.mockRestore()
    expect(fn).toBeCalled()
    fn = jest.fn()
    spy = jest.spyOn(console, 'log').mockImplementation(() => {
      fn()
    })
    logger.info('info')
    spy.mockRestore()
    expect(fn).toBeCalled()
  })

  it('should enable color', async () => {
    filepath = path.join(os.tmpdir(), uuid())
    let fileLogger = new FileLogger(filepath, LogLevel.Trace, {
      color: true
    })
    let logger = fileLogger.createLogger('scope')
    logger.info('msg', 1, true, { foo: 'bar' })
    await logger.flush()
    let content = fs.readFileSync(filepath, 'utf8')
    expect(content.indexOf('\x33')).toBeGreaterThan(-1)
  })

  it('should change level', () => {
    filepath = path.join(os.tmpdir(), uuid())
    let fileLogger = new FileLogger(filepath, LogLevel.Off, {})
    fileLogger.setLevel(LogLevel.Debug)
    fileLogger.setLevel(LogLevel.Debug)
  })

  it('should work with off level', async () => {
    filepath = path.join(os.tmpdir(), uuid())
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
    expect(fs.existsSync(filepath)).toBe(false)
  })

  it('should work without formatter', async () => {
    filepath = path.join(os.tmpdir(), uuid())
    let fileLogger = new FileLogger(filepath, LogLevel.Trace, {
      userFormatters: false
    })
    let logger = fileLogger.createLogger('scope')
    logger.log('msg\n')
    await logger.flush()
    let content = fs.readFileSync(filepath, 'utf8')
    let lines = content.split(/\n/)
    expect(lines.length).toBe(2)
  })

  it('should use backup file', async () => {
    filepath = path.join(os.tmpdir(), uuid())
    let fileLogger = new FileLogger(filepath, LogLevel.Trace, {
      userFormatters: true
    })
    let logger = fileLogger.createLogger('scope')
    let spy = jest.spyOn(fileLogger, 'shouldBackup').mockImplementation(() => {
      return true
    })
    for (let i = 0; i < 6; i++) {
      logger.log(1)
    }
    await logger.flush()
    spy.mockRestore()
    let newFile = filepath + `_1`
    expect(fs.existsSync(newFile)).toBe(true)
  })

  it('should not throw on error', async () => {
    filepath = path.join(os.tmpdir(), uuid())
    let fileLogger = new FileLogger(filepath, LogLevel.Trace, {
      userFormatters: false
    })
    let logger = fileLogger.createLogger('scope')
    let fn = jest.fn()
    let s = jest.spyOn(console, 'error').mockImplementation(() => {
      fn()
    })
    let spy = jest.spyOn(fileLogger, 'shouldBackup').mockImplementation(() => {
      throw new Error('my error')
    })
    logger.log('msg\n')
    await logger.flush()
    expect(fn).toBeCalled()
    s.mockRestore()
    spy.mockRestore()
  })

  it('should create default logger', () => {
    expect(createLogger()).toBeDefined()
  })

  it('should resolveLogFilepath from env', () => {
    let filepath = '/tmp/log'
    process.env.NVIM_COC_LOG_FILE = filepath
    expect(resolveLogFilepath()).toBe(filepath)
    process.env.NVIM_COC_LOG_FILE = ''
    process.env.XDG_RUNTIME_DIR = os.tmpdir()
    expect(resolveLogFilepath()).toBeDefined()
    process.env.XDG_RUNTIME_DIR = '/dir_not_exists'
    expect(resolveLogFilepath()).toBeDefined()
    process.env.XDG_RUNTIME_DIR = ''
    expect(resolveLogFilepath()).toBeDefined()
  })

  it('should empty file', async () => {
    emptyFile('/file_not_exists')
    filepath = path.join(os.tmpdir(), uuid())
    fs.writeFileSync(filepath, 'data', 'utf8')
    emptyFile(filepath)
    let content = fs.readFileSync(filepath, 'utf8')
    expect(content.trim().length).toBe(0)
  })
})
