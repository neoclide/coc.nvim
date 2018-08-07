require('babel-polyfill')
const logger = require('../lib/util/logger')('server')
const attach = require('..').default

let plugin = attach({
  socket: process.env.NVIM_LISTEN_ADDRESS
})

process.on('uncaughtException', function (err) {
  let msg = '[coc.nvim] uncaught exception: ' + err.stack
  console.error(msg)
  if (plugin.nvim) {
    plugin.nvim.call('coc#util#echo_messages', ['Error', msg.split('\n')], true)
  }
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
