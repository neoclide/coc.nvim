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
          logger.error(e.message)
        })
        return
      case 'CocAutocmd':
        (events as any).fire(args[0], args.slice(1))
        return
      case 'CocInstalled':
        for (let name of args) {
          extensions.onExtensionInstall(name).catch(e => {
            logger.error(e.message)
          })
        }
        return
      default:
        plugin.emit('notification', method, args)
    }
  })

  nvim.on('request', (method: string, args, resp) => {
    switch (method) {
      case 'CocAutocmd':
        (events as any).fire(args[0], args.slice(1)).then(() => {
          resp.send()
        }, () => {
          resp.send()
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
          resp.send()
        })
    }
  })

  nvim.channelId.then(async channelId => {
    await nvim.setVar('coc_node_channel_id', channelId)
    let entered = await nvim.getVvar('vim_did_enter')
    if (entered) plugin.init().catch(e => {
      logger.error(e.message)
    })
  }).catch(e => {
    logger.error(e)
  })
  return plugin
}
