require('babel-polyfill')
const os = require('os')
const path = require('path')
process.env.NVIM_NODE_LOG_FILE = path.join(os.tmpdir(), 'coc-nvim-client.log')
process.env.NVIM_NODE_LOG_LEVEL = process.env.NVIM_COC_LOG_LEVEL || 'info'
const Plugin = require('..').default
const attach = require('@chemzqm/neovim').attach
const logger = require('../lib/util/logger')('server')

const nvim = attach({
  socket: process.env.NVIM_LISTEN_ADDRESS
})
const plugin = new Plugin(nvim)

nvim.on('notification', (method, args) => {
  switch (method) {
    case 'CocResult':
      plugin.cocResult.call(plugin, args)
      break
    case 'VimEnter':
      plugin.onEnter()
      break
    case 'CocAutocmd':
      plugin.cocAutocmd.call(plugin, args).catch(e => {
        logger.error('Autocmd error: ' + e.stack)
      })
      return
    default:
      logger.debug('notification', method)
  }
})

nvim.on('request', (method, args, resp) => {
  switch (method) {
    case 'CocAction':
      plugin.cocAction.call(plugin, args).then(res => {
        resp.send(res)
      }, e => {
        logger.error('Action error: ' + e.stack)
        resp.send(null)
      })
      return
    case 'BufWritePre':
      plugin.cocAutocmd.call(plugin, ['BufWritePre', args[0]]).then(() => {
        resp.send(null)
      }, e => {
        logger.error('Action error: ' + e.stack)
        resp.send(null)
      })
      return
    default:
      logger.error('Unknown request' + method)
      resp.send(null)
  }
})

let initialized = false

nvim.channelId.then(channelId => {
  initialized = true
  nvim.setVar('coc_node_channel_id', channelId).catch(() => {
    // noop
  })
  nvim.getVvar('vim_did_enter').then(entered => {
    if (entered) plugin.onEnter()
  })
})

process.on('uncaughtException', function (err) {
  let msg = '[coc.nvim] uncaught exception: ' + err.stack
  if (!initialized) {
    console.error(msg)
    process.exit(1)
  } else {
    nvim.call('coc#util#echo_messages', ['Error', msg.split('\n')]).catch(() => {
      // noop
    })
  }
  logger.error('uncaughtException', err.stack)
})

process.on('unhandledRejection', function (reason, p) {
  if (initialized) {
    let msg = '[coc.nvim] Unhandled Rejection at:' + p + ' reason: ' + reason
    nvim.call('coc#util#echo_messages', ['Error', msg.split('\n')]).catch(() => {
      // noop
    })
  }
  logger.error('unhandledRejection', reason)
})

process.stderr.on('data', function (data) {
  logger.error(data)
})
