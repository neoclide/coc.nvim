import watchman, { Client } from 'fb-watchman'
import os from 'os'
import path from 'path'
import { OutputChannel } from './types'
import uuidv1 = require('uuid/v1')
const logger = require('./util/logger')('watchman')
const requiredCapabilities = ['relative_root', 'cmd-watch-project', 'wildmatch']

export interface WatchResponse {
  warning?: string
  watcher: string
  watch: string
}

export interface FileChangeItem {
  size: number
  name: string
  exists: boolean
  type: 'f' | 'd'
  mtime_ms: number
  ['content.sha1hex']?: string
}

export interface FileChange {
  root: string
  subscription: string
  files: FileChangeItem[]
}

export type ChangeCallback = (FileChange) => void

const clientsMap: Map<string, Promise<Watchman>> = new Map()
/**
 * Watchman wrapper for fb-watchman client
 *
 * @public
 */
export default class Watchman {
  private client: Client
  private relative_path: string | null
  private clock: string | null
  private _disposed = false

  constructor(binaryPath: string, private channel?: OutputChannel) {
    this.client = new watchman.Client({
      watchmanBinaryPath: binaryPath
    })
    this.client.setMaxListeners(300)
  }

  public checkCapability(): Promise<boolean> {
    let { client } = this
    return new Promise((resolve, reject) => {
      client.capabilityCheck({
        optional: [],
        required: requiredCapabilities
      }, (error, resp) => {
        if (error) return reject(error)
        let { capabilities } = resp
        for (let key of Object.keys(capabilities)) {
          if (!capabilities[key]) return resolve(false)
        }
        resolve(true)
      })
    })
  }

  public async watchProject(root: string): Promise<boolean> {
    try {
      let resp = await this.command(['watch-project', root])
      let { watch, warning } = (resp as WatchResponse)
      if (warning) logger.warn(warning)
      this.relative_path = watch
      resp = await this.command(['clock', watch])
      this.clock = resp.clock
      logger.info(`watchman watching project ${root}`)
      this.appendOutput(`watchman watching project ${root}`)
    } catch (e) {
      logger.error(e)
      return false
    }
    return true
  }

  private command(args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      this.client.command(args, (error, resp) => {
        if (error) return reject(error)
        resolve(resp)
      })
    })
  }

  public async subscribe(globPattern: string, cb: ChangeCallback): Promise<string> {
    let { clock, relative_path } = this
    if (!clock) {
      this.appendOutput(`watchman not watching any root`, 'Error')
      return null
    }
    let uid = uuidv1()
    let sub = {
      expression: ['allof', ['match', globPattern, 'wholename']],
      fields: ['name', 'size', 'exists', 'type', 'mtime_ms', 'ctime_ms', 'content.sha1hex'],
      since: clock,
    }
    let { subscribe } = await this.command(['subscribe', relative_path, uid, sub])
    this.appendOutput(`subscribing "${globPattern}" in ${relative_path}`)
    this.client.on('subscription', resp => {
      if (!resp || resp.subscription != uid) return
      let { files } = resp
      if (!files) return
      files.map(f => f.mtime_ms = +f.mtime_ms)
      this.appendOutput(`file change detected: ${JSON.stringify(resp, null, 2)}`)
      cb(resp)
    })
    return subscribe
  }

  public unsubscribe(subscription: string): Promise<any> {
    if (this._disposed) return Promise.resolve()
    this.appendOutput(`unsubscribe "${subscription}" in: ${this.relative_path}`)
    return this.command(['unsubscribe', this.relative_path, subscription]).catch(e => {
      logger.error(e)
    })
  }

  public dispose(): void {
    this._disposed = true
    this.client.removeAllListeners()
    this.client.end()
  }

  private appendOutput(message: string, type = "Info"): void {
    if (this.channel) {
      this.channel.appendLine(`[${type}  - ${(new Date().toLocaleTimeString())}] ${message}`)
    }
  }

  public static dispose(): void {
    for (let promise of clientsMap.values()) {
      promise.then(client => {
        client.dispose()
      })
    }
  }

  public static createClient(binaryPath: string, root: string, channel?: OutputChannel): Promise<Watchman | null> {
    if (root == os.homedir() || root == '/' || path.parse(root).base == root) return null
    let client = clientsMap.get(root)
    if (client) return client
    let promise = new Promise<Watchman | null>(async (resolve, reject) => {
      try {
        let watchman = new Watchman(binaryPath, channel)
        let valid = await watchman.checkCapability()
        if (!valid) return resolve(null)
        let watching = await watchman.watchProject(root)
        if (!watching) return resolve(null)
        resolve(watchman)
      } catch (e) {
        reject(e)
      }
    })
    clientsMap.set(root, promise)
    return promise
  }
}
