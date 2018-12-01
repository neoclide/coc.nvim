const attach = require('../lib/attach').default
const logger = require('../lib/util/logger')('server')
const address = process.env.NVIM_LISTEN_ADDRESS || '/tmp/nvim'

attach({
  socket: address
})

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
