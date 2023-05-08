'use strict'
import type { Client } from 'fb-watchman'
import { v1 as uuidv1 } from 'uuid'
import { createLogger } from '../logger'
import { OutputChannel } from '../types'
import { isParentFolder } from '../util/fs'
import { minimatch, os, path } from '../util/node'
import { Disposable } from '../util/protocol'
const logger = createLogger('core-watchman')
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
    const watchman = require('fb-watchman')
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
        if (error) return resolve(false)
        let { capabilities } = resp
        for (let key of Object.keys(capabilities)) {
          if (!capabilities[key]) return resolve(false)
        }
        resolve(true)
      })
    })
  }

  public async watchProject(root: string): Promise<boolean> {
    let resp = await this.command(['watch-project', root])
    let { watch, warning, relative_path } = resp as WatchResponse
    if (!watch) return false
    if (warning) logger.warn(warning)
    this.watch = watch
    this.relative_path = relative_path
    logger.info(`watchman watching project: ${root}`)
    this.appendOutput(`watchman watching project: ${root}`)
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

  public async subscribe(globPattern: string, cb: ChangeCallback): Promise<Disposable & { subscribe: string } | undefined> {
    let { watch, relative_path } = this
    if (!watch) throw new Error('watchman not watching')
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
    if (!this.client) return
    let { subscribe } = await this.command(['subscribe', watch, uid, sub])
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
    // return Disposable.create(() => )
    return {
      dispose: () => {
        void this.unsubscribe(subscribe)
      },
      subscribe
    }
  }

  public unsubscribe(subscription: string): Promise<any> {
    if (this._disposed) return Promise.resolve()
    let { watch } = this
    if (!watch) return
    this.appendOutput(`unsubscribe "${subscription}" in: ${watch}`)
    return this.command(['unsubscribe', watch, subscription]).catch(e => {
      if (e.message?.includes('The client was ended')) logger.error(e)
    })
  }

  public dispose(): void {
    if (this._disposed) return
    this._disposed = true
    if (this.client) {
      this.client.end()
      this.client = undefined
    }
  }

  private appendOutput(message: string, type = "Info"): void {
    if (this.channel) {
      this.channel.appendLine(`[${type}  - ${(new Date().toLocaleTimeString())}] ${message}`)
    }
  }

  public static async createClient(binaryPath: string, root: string, channel?: OutputChannel): Promise<Watchman> {
    if (!isValidWatchRoot(root)) throw new Error(`Watch for ${root} is ignored`)
    let watchman: Watchman
    try {
      watchman = new Watchman(binaryPath, channel)
      let valid = await watchman.checkCapability()
      if (!valid) throw new Error('required capabilities do not exist.')
      let watching = await watchman.watchProject(root)
      if (!watching) throw new Error('unable to watch')
      return watchman
    } catch (e) {
      if (watchman) watchman.dispose()
      throw e
    }
  }
}

/**
 * Exclude root, user's home, driver and tmpdir, but allow sub-directories under them.
 */
export function isValidWatchRoot(root: string): boolean {
  if (root == '/' || root == '/tmp' || root == '/private/tmp' || root == os.tmpdir()) return false
  if (isParentFolder(root, os.homedir(), true)) return false
  if (path.parse(root).base == root) return false
  return true
}
