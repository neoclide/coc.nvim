import { attach, NeovimClient } from '@chemzqm/neovim'
import { Attach } from '@chemzqm/neovim/lib/attach/attach'
import events from './events'
import Plugin from './plugin'
import semver from 'semver'
const logger = require('./util/logger')('attach')
const isTest = process.env.NODE_ENV == 'test'

export default (opts: Attach): Plugin => {
  const nvim: NeovimClient = attach(opts)
  const plugin = new Plugin(nvim)
  let initialized = false
  nvim.on('notification', async (method, args) => {
    switch (method) {
      case 'VimEnter': {
        if (!initialized) {
          initialized = true
          await plugin.init()
        }
        break
      }
      case 'OptionSet':
        await events.fire('OptionSet', args)
        break
      case 'InputChar':
        await events.fire('InputChar', args)
        break
      case 'GlobalChange':
        await events.fire('GlobalChange', args)
        break
      case 'CocAutocmd':
        await events.fire(args[0], args.slice(1))
        break
      default:
        const m = method[0].toLowerCase() + method.slice(1)
        if (typeof plugin[m] == 'function') {
          try {
            await Promise.resolve(plugin[m].apply(plugin, args))
          } catch (e) {
            // tslint:disable-next-line:no-console
            console.error(`error on notification '${method}': ${e}`)
          }
        }
    }
  })

  nvim.on('request', async (method: string, args, resp) => {
    try {
      if (method == 'CocAutocmd') {
        await events.fire(args[0], args.slice(1))
        resp.send()
        return
      }
      let m = method[0].toLowerCase() + method.slice(1)
      if (typeof plugin[m] !== 'function') {
        return resp.send(`Method ${m} not found`, true)
      }
      let res = await Promise.resolve(plugin[m].apply(plugin, args))
      resp.send(res)
    } catch (e) {
      logger.error(`Error on "${method}": ` + e.stack)
      resp.send(e.message, true)
    }
  })

  nvim.channelId.then(async channelId => {
    if (isTest) nvim.command(`let g:coc_node_channel_id = ${channelId}`, true)
    let json = require('../package.json')
    let { major, minor, patch } = semver.parse(json.version)
    nvim.setClientInfo('coc', { major, minor, patch }, 'remote', {}, {})
    let entered = await nvim.getVvar('vim_did_enter')
    if (entered && !initialized) {
      initialized = true
      await plugin.init()
    }
  }).catch(e => {
    console.error(`Channel create error: ${e.message}`) // tslint:disable-line
  })
  return plugin
}
