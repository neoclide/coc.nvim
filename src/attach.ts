import Plugin from './plugin'
import { Attach } from '@chemzqm/neovim/lib/attach/attach'
import { NeovimClient, attach } from '@chemzqm/neovim'
const logger = require('./util/logger')('attach')

export default function(opts: Attach):Plugin {
  const nvim:NeovimClient = attach(opts)
  const plugin = new Plugin(nvim)
  nvim.on('notification', (method, args) => {
    switch (method) {
      case 'CocResult':
        plugin.cocResult(args)
        return
      case 'VimEnter':
        plugin.onEnter()
        return
      case 'CocAutocmd':
        plugin.cocAutocmd(args).catch(e => {
          logger.error('Autocmd error: ' + e.stack)
        })
        return
      default:
        plugin.emitter.emit('notification', method, args)
    }
  })

  nvim.on('request', (method:string, args, resp) => {
    switch (method) {
      case 'BufWritePre':
        plugin.cocAutocmd.call(plugin, ['BufWritePre', args[0]]).then(() => {
          resp.send(null)
        }, e => {
          logger.error('Action error: ' + e.stack)
          resp.send(null)
        })
        return
      default:
        let m = method[0].toLowerCase() + method.slice(1)
        if (typeof plugin[m] !== 'function') {
          // tslint:disable-next-line:no-console
          console.error(`Action ${m} not found`)
          logger.error(`Action ${m} not found`)
          return resp.send(null)
        }
        plugin[m](args).then(res => {
          resp.send(res)
        }, e => {
          logger.error('Action error: ' + e.stack)
          resp.send(null)
        })
    }
  })

  nvim.channelId.then(async channelId => {
    await nvim.setVar('coc_node_channel_id', channelId)
    let entered = await nvim.getVvar('vim_did_enter')
    if (entered) plugin.onEnter()
  })
  return plugin
}
