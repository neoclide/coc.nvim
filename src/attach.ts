'use strict'
import { attach, Attach, NeovimClient } from '@chemzqm/neovim'
import semver from 'semver'
import { URI } from 'vscode-uri'
import { version as VERSION } from '../package.json'
import events from './events'
import { createLogger } from './logger'
import Plugin from './plugin'
import { objectLiteral } from './util/is'
const logger = createLogger('attach')

/**
 * Request actions that not need plugin ready
 */
const ACTIONS_NO_WAIT = ['installExtensions', 'updateExtensions']

export async function pathReplace(nvim: NeovimClient, check = true): Promise<void> {
  if (check) {
    let prefixes = await nvim.call('coc#util#path_replace_patterns')
    if (objectLiteral(prefixes)) {
      const old_uri = URI.file
      URI.file = (path): URI => {
        path = path.replace(/\\/g, '/')
        Object.keys(prefixes).forEach(k => path = path.replace(new RegExp('^' + k), prefixes[k]))
        return old_uri(path)
      }
    }
  }
}

export default (opts: Attach, requestApi = true): Plugin => {
  const nvim: NeovimClient = attach(opts, createLogger('node-client'), requestApi)
  void pathReplace(nvim, !global.__TEST__)
  nvim.setVar('coc_process_pid', process.pid, true)
  const plugin = new Plugin(nvim)
  let clientReady = false
  let initialized = false
  const doInitialize = async () => {
    if (!initialized && clientReady) {
      initialized = true
      await plugin.init()
    }
  }
  const doAction = async (method: string, args: any[]) => {
    try {
      logger.info('receive notification:', method, args, plugin.isReady)
      await plugin.cocAction(method, ...args)
    } catch (e) {
      console.error(`Error on notification "${method}": ${(e instanceof Error ? e.message : e)}`)
      logger.error(`Error on notification ${method}`, e)
    }
  }

  const pendingNotifications: Map<string, any[]> = new Map()
  let disposable = events.on('ready', () => {
    disposable.dispose()
    for (let [method, args] of pendingNotifications.entries()) {
      void doAction(method, args)
    }
  })

  nvim.on('notification', async (method, args) => {
    switch (method) {
      case 'VimEnter': {
        await doInitialize()
        break
      }
      case 'Log': {
        logger.debug('Vim log', ...args)
        break
      }
      case 'TaskExit':
      case 'TaskStderr':
      case 'TaskStdout':
      case 'GlobalChange':
      case 'PromptInsert':
      case 'InputChar':
      case 'MenuInput':
      case 'OptionSet':
      case 'PromptKeyPress':
      case 'FloatBtnClick':
      case 'CompleteStop':
        logger.trace('Event: ', method, ...args)
        await events.fire(method, args)
        break
      case 'CocAutocmd':
        logger.trace('Notification autocmd:', ...args)
        await events.fire(args[0], args.slice(1))
        break
      case 'redraw':
        break
      default: {
        if (!plugin.isReady) {
          pendingNotifications.set(method, args)
          return
        }
        void doAction(method, args)
      }
    }
  })

  nvim.on('request', async (method: string, args, resp) => {
    let timer = setTimeout(() => {
      logger.error('Request cost more than 3s', method, args)
    }, 3000)
    try {
      events.requesting = true
      if (method == 'CocAutocmd') {
        logger.trace('Request autocmd:', ...args)
        await events.fire(args[0], args.slice(1))
        resp.send(undefined)
      } else {
        if (!plugin.isReady && !ACTIONS_NO_WAIT.includes(method)) {
          logger.warn(`Plugin not ready on request "${method}"`, args)
          resp.send('Plugin not ready', true)
          return
        }
        logger.info('Request action:', method, args)
        let res = await plugin.cocAction(method, ...args)
        resp.send(res)
      }
      clearTimeout(timer)
      events.requesting = false
    } catch (e) {
      events.requesting = false
      clearTimeout(timer)
      resp.send(e instanceof Error ? e.message : e.toString(), true)
      logger.error(`Request error:`, method, args, e)
    }
  })

  void nvim.channelId.then(async channelId => {
    clientReady = true
    // Used for test client on vim side
    if (global.__TEST__) nvim.call('coc#rpc#set_channel', [channelId], true)
    let { major, minor, patch } = semver.parse(VERSION)
    nvim.setClientInfo('coc', { major, minor, patch }, 'remote', {}, {})
    let entered = await nvim.getVvar('vim_did_enter')
    if (entered) await doInitialize()
  })
  return plugin
}
