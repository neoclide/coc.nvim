import watchman, { Client } from 'fb-watchman'
import os from 'os'
import path from 'path'
import { OutputChannel } from './types'
import { v1 as uuidv1 } from 'uuid'
import { Disposable } from 'vscode-languageserver-protocol'
import minimatch from 'minimatch'
import { isParentFolder } from './util/fs'
const logger = require('./util/logger')('watchman')
const requiredCapabilities = ['relative_root', 'cmd-watch-project', 'wildmatch', 'field-new']

export interface WatchResponse {
  warning?: string
  watcher: string
  watch: string
  relative_path?: string
}

export interface FileChangeItem {
  size: number
  name: string
  exists: boolean
  new: boolean
  type: 'f' | 'd'
  mtime_ms: number
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
  private watch: string | undefined
  private relative_path: string | undefined
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
      let { watch, warning, relative_path } = (resp as WatchResponse)
      if (warning) logger.warn(warning)
      this.watch = watch
      this.relative_path = relative_path
      logger.info(`watchman watching project: ${root}`)
      this.appendOutput(`watchman watching project: ${root}`)
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

  public async subscribe(globPattern: string, cb: ChangeCallback): Promise<Disposable> {
    let { watch, relative_path } = this
    if (!watch) {
      this.appendOutput(`watchman not watching: ${watch}`, 'Error')
      return null
    }
    let { clock } = await this.command(['clock', watch])
    let uid = uuidv1()
    let sub: any = {
      expression: ['allof', ['match', '**/*', 'wholename']],
      fields: ['name', 'size', 'new', 'exists', 'type', 'mtime_ms', 'ctime_ms'],
      since: clock,
    }
    let root = watch
    if (relative_path) {
      sub.relative_root = relative_path
      root = path.join(watch, relative_path)
    }
    let { subscribe } = await this.command(['subscribe', watch, uid, sub])
    if (global.hasOwnProperty('__TEST__')) (global as any).subscribe = subscribe
    this.appendOutput(`subscribing "${globPattern}" in ${root}`)
    this.client.on('subscription', resp => {
      if (!resp || resp.subscription != uid) return
      let { files } = resp as FileChange
      if (!files) return
      files = files.filter(f => f.type == 'f' && minimatch(f.name, globPattern, { dot: true }))
      if (!files.length) return
      let ev: FileChange = Object.assign({}, resp)
      if (this.relative_path) ev.root = path.resolve(resp.root, this.relative_path)
      this.appendOutput(`file change detected: ${JSON.stringify(ev, null, 2)}`)
      cb(ev)
    })
    return Disposable.create(() => this.unsubscribe(subscribe))
  }

  public unsubscribe(subscription: string): Promise<any> {
    if (this._disposed) return Promise.resolve()
    let { watch } = this
    if (!watch) return
    this.appendOutput(`unsubscribe "${subscription}" in: ${watch}`)
    return this.command(['unsubscribe', watch, subscription]).catch(e => {
      logger.error(e)
    })
  }

  public dispose(): void {
    if (this._disposed) return
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
      }, _e => {
        // noop
      })
    }
  }

  public static createClient(binaryPath: string, root: string, channel?: OutputChannel): Promise<Watchman | null> {
    if (!isValidWatchRoot(root)) return null
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

/**
 * Exclude user's home, driver, tmpdir
 */
export function isValidWatchRoot(root: string): boolean {
  if (root == '/' || root == '/tmp' || root == '/private/tmp') return false
  if (root.toLowerCase() === os.homedir().toLowerCase()) return false
  if (path.parse(root).base == root) return false
  if (root.startsWith('/tmp/') || root.startsWith('/private/tmp/')) return false
  if (isParentFolder(os.tmpdir(), root, true)) return false
  return true
}
