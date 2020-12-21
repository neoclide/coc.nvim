import semver from 'semver'
const promiseFinally = require('promise.prototype.finally')

const version = process.version.replace('v', '')
if (!semver.gte(version, '8.10.0')) {
  console.error('node version ' + version + ' < 8.10.0, please upgrade nodejs, or use `let g:coc_node_path = "/path/to/node"` in your vimrc')
  process.exit()
}
if (!semver.gte(version, '10.12.0')) {
  if (process.env.COC_NO_WARNINGS != '1') {
    console.error('node version ' + version + ' < 10.12.0, upgrade nodejs or use `let g:coc_disable_startup_warning = 1` to disable this warning.')
  }
}
Object.defineProperty(console, 'log', {
  value() {
    logger.info(...arguments)
  }
})
promiseFinally.shim()
const logger = require('./util/logger')('server')
const attach = require('./attach').default

attach({ reader: process.stdin, writer: process.stdout })

process.on('uncaughtException', function(err) {
  let msg = 'Uncaught exception: ' + err.message
  console.error(msg)
  logger.error('uncaughtException', err.stack)
})

process.on('unhandledRejection', function(reason, p) {
  if (reason instanceof Error) {
    console.error('UnhandledRejection: ' + reason.message + '\n' + reason.stack)
  } else {
    console.error('UnhandledRejection: ' + reason)
  }
  logger.error('unhandledRejection ', p, reason)
})
