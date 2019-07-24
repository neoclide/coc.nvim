import fs from 'fs'
import log4js from 'log4js'
import path from 'path'
import os from 'os'

function getLogFile(): string {
  let file = process.env.NVIM_COC_LOG_FILE
  if (file) return file
  let dir = process.env.XDG_RUNTIME_DIR
  if (dir) return path.join(dir, `coc-nvim-${process.pid}.log`)
  return path.join(os.tmpdir(), `coc-nvim-${process.pid}.log`)
}

const MAX_LOG_SIZE = 1024 * 1024
const MAX_LOG_BACKUPS = 10
let logfile = getLogFile()
const level = process.env.NVIM_COC_LOG_LEVEL || 'info'

if (!fs.existsSync(logfile)) {
  try {
    fs.writeFileSync(logfile, '', { encoding: 'utf8', mode: 0o666 })
  } catch (e) {
    logfile = path.join(os.tmpdir(), `coc-nvim-${process.pid}.log`)
    fs.writeFileSync(logfile, '', { encoding: 'utf8', mode: 0o666 })
    // noop
  }
}

log4js.configure({
  disableClustering: true,
  appenders: {
    out: {
      type: 'file',
      mode: 0o666,
      filename: logfile,
      maxLogSize: MAX_LOG_SIZE,
      backups: MAX_LOG_BACKUPS,
      layout: {
        type: 'pattern',
        // Format log in following pattern:
        // yyyy-MM-dd HH:mm:ss.mil $Level (pid:$pid) $categroy - $message.
        pattern: `%d{ISO8601} %p (pid:${process.pid}) [%c] - %m`,
      },
    }
  },
  categories: {
    default: { appenders: ['out'], level }
  }
})

module.exports = (name = 'coc-nvim'): log4js.Logger => {
  let logger = log4js.getLogger(name)
    ; (logger as any).getLogFile = () => {
      return logfile
    }
  return logger
}
