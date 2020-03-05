const semver = require('semver')
const version = process.version.replace('v', '')
if (!semver.gte(version, '8.10.0')) {
  console.error('node version ' + version + ' < 8.10.0, please upgrade nodejs, or use `let g:coc_node_path = "/path/to/node"` in your vimrc')
  process.exit()
}
Object.defineProperty(console, 'log', {
  value: function () {
    logger.info(...arguments)
  }
})
const logger = require('../lib/util/logger')('server')
const attach = require('../lib/attach').default
const os = require('os')
const path = require('path')
const fs = require('fs')
const rimraf = require('rimraf')

attach({reader: process.stdin, writer: process.stdout})

process.on('exit', () => {
  let folder = path.join(os.tmpdir(), 'coc.nvim-' + process.pid)
  if (fs.existsSync(folder)) {
    rimraf.sync(folder)
  }
})

process.on('uncaughtException', function (err) {
  let msg = 'Uncaught exception: ' + err.stack
  console.error(msg)
  logger.error('uncaughtException', err.stack)
})

process.on('unhandledRejection', function (reason, p) {
  if (reason instanceof Error) {
    console.error('UnhandledRejection: ' + reason.message + '\n' + reason.stack)
  } else {
    console.error('UnhandledRejection: ' + reason)
  }
  logger.error('unhandledRejection ', p, reason)
})
