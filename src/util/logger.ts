import fs from 'fs'
import log4js from 'log4js'
import os from 'os'
import path from 'path'

const MAX_LOG_SIZE = 1024 * 1024
const MAX_LOG_BACKUPS = 10
const filename = `coc-nvim-${process.pid}.log`
const logfile = process.env.NVIM_COC_LOG_FILE || path.join(os.tmpdir(), filename)

const level = process.env.NVIM_COC_LOG_LEVEL || 'info'

if (!fs.existsSync(logfile)) {
  try {
    fs.writeFileSync(logfile, '', { encoding: 'utf8', mode: 0o666 })
    if (level == 'debug' || level == 'trace') {
      let linkfile = path.join(os.tmpdir(), 'coc-nvim.log')
      if (fs.existsSync(linkfile)) fs.unlinkSync(linkfile)
      fs.symlinkSync(logfile, linkfile)
    }
  } catch (e) {
    // noop
  }
}

const isRoot = process.getuid && process.getuid() == 0

if (!isRoot) {
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
}

module.exports = (name = 'coc-nvim'): log4js.Logger => {
  return log4js.getLogger(name)
}
