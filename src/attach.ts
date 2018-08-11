import Plugin from './plugin'
import workspace from './workspace'
import { TerminalResult } from './types'
import { Attach } from '@chemzqm/neovim/lib/attach/attach'
import { NeovimClient } from '@chemzqm/neovim'
const logger = require('./util/logger')('attach')
const attach = require('@chemzqm/neovim').attach

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
      case 'TerminalResult':
        if (workspace.moduleManager) {
          workspace.moduleManager.handleTerminalResult(args[0] as TerminalResult)
        }
        return
      case 'JobResult':
        if (workspace.jobManager) {
          let [id, data] = args
          workspace.jobManager.handleResult(id as number, data as string)
        }
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

  nvim.channelId.then(async channelId => {
    await nvim.setVar('coc_node_channel_id', channelId)
    let entered = await nvim.getVvar('vim_did_enter')
    if (entered) plugin.onEnter()
  })
  return plugin
}
