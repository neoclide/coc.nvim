'use strict'
import { FileLogger, textToLogLevel, ILogger } from './log'
import { fs, path, os } from '../util/node'
import { getConditionValue } from '../util'

export { getTimestamp } from './log'

export function resolveLogFilepath(): string {
  let file = process.env.NVIM_COC_LOG_FILE
  if (file) return file
  let dir = process.env.XDG_RUNTIME_DIR
  if (dir) {
    try {
      fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK)
      return path.join(dir, `coc-nvim-${process.pid}.log`)
    } catch (err) {
      // noop
    }
  }
  let tmpdir = os.tmpdir()
  dir = path.join(tmpdir, `coc.nvim-${process.pid}`)
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, `coc-nvim.log`)
}

export function emptyFile(filepath: string): void {
  if (fs.existsSync(filepath)) {
    // cleanup if exists
    try {
      fs.writeFileSync(filepath, '', { encoding: 'utf8', mode: 0o666 })
    } catch (e) {
      // noop
    }
  }
}

const logfile = resolveLogFilepath()
emptyFile(logfile)

const level = getConditionValue(process.env.NVIM_COC_LOG_LEVEL || 'info', 'off')

export const logger = new FileLogger(logfile, textToLogLevel(level), {
  color: !global.REVISION && process.platform !== 'win32',
  userFormatters: true
})

export function getLoggerFile(): string {
  return logfile
}

export function createLogger(category = 'coc.nvim'): ILogger {
  return logger.createLogger(category)
}
