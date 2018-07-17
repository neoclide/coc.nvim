const attach = require('neovim').attach
const Plugin = require('..').default
const logger = require('../lib/util/logger')('server')

const nvim = attach({
  socket: process.env.NVIM_LISTEN_ADDRESS
})
const plugin = new Plugin(nvim)

nvim.on('notification', (method, args) => {
  switch (method) {
    case 'CocResult':
      plugin.cocResult.call(plugin, args)
  }
})

nvim.on('request', (method, args, resp) => {
  switch (method) {
    case 'CocAutocmd':
      plugin.cocAutocmd.call(plugin, args).then(res => {
        resp.send(res)
      }, e => {
        logger.error('Autocmd error: ' + e.stack)
        resp.send(null)
      })
      return
    case 'CocAction':
      plugin.cocAction.call(plugin, args).then(res => {
        resp.send(res)
      }, e => {
        logger.error('Action error: ' + e.stack)
        resp.send(null)
      })
      return
    default:
      resp.send(null)
  }
})

let initialized = false

nvim.channelId.then(channelId => {
  initialized = true
  nvim.command('let g:coc_node_channel_id=' + channelId).catch(onError)
  plugin.onInit(channelId).catch(onError)
})

function onError(err) {
  console.error('[coc.nvim] error: ' + err.message)
  process.exit(1)
}

process.on('uncaughtException', function(err) {
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

process.on('unhandledRejection', (reason, p) => {
  if (initialized) {
    let msg = '[coc.nvim] Unhandled Rejection at:' + p + ' reason: ' + reason
    nvim.call('coc#util#echo_messages', ['Error', msg.split('\n')]).catch(() => {
      // noop
    })
  }
  logger.error('unhandledRejection', reason)
})
