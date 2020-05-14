import { attach, NeovimClient } from '@chemzqm/neovim'
import log4js from 'log4js'
import { Attach } from '@chemzqm/neovim/lib/attach/attach'
import events from './events'
import Plugin from './plugin'
import semver from 'semver'
import { objectLiteral } from './util/is'
import './util/extensions'
import { URI } from 'vscode-uri'
const logger = require('./util/logger')('attach')
const isTest = process.env.NODE_ENV == 'test'

export default (opts: Attach, requestApi = true): Plugin => {
  const nvim: NeovimClient = attach(opts, log4js.getLogger('node-client'), requestApi)
  const timeout: number = process.env.COC_CHANNEL_TIMEOUT ? parseInt(process.env.COC_CHANNEL_TIMEOUT, 10) : 30
  if (!global.hasOwnProperty('__TEST__')) {
    nvim.call('coc#util#path_replace_patterns').then(prefixes => {
      if (objectLiteral(prefixes)) {
        const old_uri = URI.file
        URI.file = (path): URI => {
          path = path.replace(/\\/g, '/')
          Object.keys(prefixes).forEach(k => path = path.replace(new RegExp('^' + k), prefixes[k]))
          return old_uri(path)
        }
      }
    }).logError()
  }
  const plugin = new Plugin(nvim)
  let clientReady = false
  let initialized = false
  nvim.on('notification', async (method, args) => {
    switch (method) {
      case 'VimEnter': {
        if (!initialized && clientReady) {
          initialized = true
          await plugin.init()
        }
        break
      }
      case 'TaskExit':
      case 'TaskStderr':
      case 'TaskStdout':
      case 'GlobalChange':
      case 'InputChar':
      case 'OptionSet':
        await events.fire(method, args)
        break
      case 'CocAutocmd':
        await events.fire(args[0], args.slice(1))
        break
      default: {
        const m = method[0].toLowerCase() + method.slice(1)
        if (typeof plugin[m] == 'function') {
          try {
            await Promise.resolve(plugin[m].apply(plugin, args))
          } catch (e) {
            console.error(`error on notification '${method}': ${e}`)
          }
        }
      }
    }
  })

  nvim.on('request', async (method: string, args, resp) => {
    let timer = setTimeout(() => {
      logger.error(`Timeout on request "${method}": `, args)
      resp.send(`request ${method} timeout after ${timeout}s`, true)
    }, timeout * 1000)
    try {
      if (method == 'CocAutocmd') {
        await events.fire(args[0], args.slice(1))
        resp.send()
      } else {
        let m = method[0].toLowerCase() + method.slice(1)
        if (typeof plugin[m] !== 'function') {
          resp.send(`Method ${m} not found`, true)
        } else {
          let res = await Promise.resolve(plugin[m].apply(plugin, args))
          resp.send(res)
        }
      }
      clearTimeout(timer)
    } catch (e) {
      clearTimeout(timer)
      logger.error(`Error on "${method}": ` + e.stack)
      resp.send(e.message, true)
    }
  })

  nvim.channelId.then(async channelId => {
    clientReady = true
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
    console.error(`Channel create error: ${e.message}`)
  })
  return plugin
}
