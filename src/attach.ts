import { attach, NeovimClient } from '@chemzqm/neovim'
import { Attach } from '@chemzqm/neovim/lib/attach/attach'
import events from './events'
import Plugin from './plugin'
import extensions from './extensions'
const logger = require('./util/logger')('attach')

export default function(opts: Attach): Plugin {
  const nvim: NeovimClient = attach(opts)
  const plugin = new Plugin(nvim)
  nvim.on('notification', (method, args) => {
    switch (method) {
      case 'VimEnter':
        plugin.init().catch(e => {
          logger.error(e)
        })
        return
      case 'CocAutocmd':
        (events as any).fire(args[0], args.slice(1))
        return
      case 'CocInstalled':
        for (let name of args) {
          extensions.onExtensionInstall(name).catch(e => {
            logger.error(e)
          })
        }
        return
      default:
        plugin.emit(method, args)
    }
  })

  nvim.on('request', (method: string, args, resp) => {
    switch (method) {
      case 'CocAutocmd':
        (events as any).fire(args[0], args.slice(1)).then(() => {
          resp.send()
        }, e => {
          logger.error(`Autocmd ${args[0]} error: ` + e.stack)
          resp.send()
        })
        return
      default:
        let m = method[0].toLowerCase() + method.slice(1)
        if (typeof plugin[m] !== 'function') {
          return resp.send(`Action ${m} not found`, true)
        }
        plugin[m].apply(plugin, args).then(res => {
          resp.send(res)
        }, e => {
          logger.error(`Action ${m} error: ` + e.stack)
          resp.send(e.message, true)
        })
    }
  })

  nvim.channelId.then(async channelId => {
    await nvim.setVar('coc_node_channel_id', channelId)
    let entered = await nvim.getVvar('vim_did_enter')
    if (entered) plugin.init().catch(e => {
      logger.error(e)
    })
  }).catch(e => {
    logger.error(e)
  })
  return plugin
}
