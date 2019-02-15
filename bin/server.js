const semver = require('semver')
const version = process.version.replace('v', '')
if (!semver.gt(version, '8.0.0')) {
  console.error('node 8.0 required, please upgrade nodejs.')
  process.exit(1)
}
Object.defineProperty(console, 'log', {
  value: () => { }
})
const attach = require('../lib/attach').default
const logger = require('../lib/util/logger')('server')
const isVim = process.env.VIM_NODE_RPC == '1'
const isWindows = process.platform == 'win32'
let address = process.env.NVIM_LISTEN_ADDRESS || '/tmp/nvim'

if (isVim) {
  if (isWindows && !address.startsWith('\\\\')) {
    address = '\\\\?\\pipe\\' + address
  }
  attach({ socket: address })
} else {
  attach({ reader: process.stdin, writer: process.stdout })
}

process.on('uncaughtException', function(err) {
  let msg = 'Uncaught exception: ' + err.stack
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
