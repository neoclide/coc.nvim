require('babel-polyfill')
const logger = require('../lib/util/logger')('server')
const attach = require('..').default
const address = process.env.NVIM_LISTEN_ADDRESS || '/tmp/nvim'

let plugin = attach({
  socket: address
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
  if (plugin.nvim) {
    plugin.nvim.call('coc#util#echo_messages', ['Error', 'UnhandledRejection run :CocErrors to checkout'], true)
  }
  logger.error('unhandledRejection ', p, reason)
})
