import path from 'path'
import watchman, { Client } from 'fb-watchman'
import fs from 'fs'
import which from 'which'
import uuidv1 = require('uuid/v1')
import os from 'os'
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

const clientsMap: Map<string, Watchman> = new Map()
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

  constructor(binaryPath: string) {
    this.client = new watchman.Client({
      watchmanBinaryPath: binaryPath
    })
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
    if (!clock) return null
    let uid = uuidv1()
    let sub = {
      expression: ['allof', ['match', globPattern, 'wholename']],
      fields: ['name', 'size', 'exists', 'type', 'mtime_ms', 'ctime_ms', 'content.sha1hex'],
      since: clock,
    }
    let { subscribe } = await this.command(['subscribe', relative_path, uid, sub])
    this.client.on('subscription', resp => {
      if (!resp || resp.subscription != uid) return
      let { files } = resp
      if (!files) return
      files.map(f => f.mtime_ms = +f.mtime_ms)
      cb(resp)
    })
    return subscribe
  }

  public unsubscribe(subscription: string): Promise<any> {
    if (this._disposed) return Promise.resolve()
    return this.command(['unsubscribe', this.relative_path, subscription]).catch(e => {
      logger.error(e)
    })
  }

  public dispose(): void {
    this._disposed = true
    this.client.removeAllListeners()
    this.client.end()
  }

  public static dispose(): void {
    for (let client of clientsMap.values()) {
      client.dispose()
    }
  }

  public static async createClient(binaryPath: string, root: string): Promise<Watchman | null> {
    if (root == os.homedir() || root == '/' || path.parse(root).base == root) return null
    let client = clientsMap.get(root)
    if (client) return client
    client = new Watchman(binaryPath)
    clientsMap.set(root, client)
    let valid = await client.checkCapability()
    if (!valid) return null
    let watching = await client.watchProject(root)
    if (!watching) return null
    return client
  }

  public static getBinaryPath(path: string): string | null {
    if (path && fs.existsSync(path)) return path
    try {
      path = which.sync('watchman')
      return path
    } catch (e) {
      return null
    }
  }
}
