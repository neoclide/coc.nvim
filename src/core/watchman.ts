'use strict'
import type { Client } from 'fb-watchman'
import { v1 as uuidv1 } from 'uuid'
import { createLogger } from '../logger'
import { OutputChannel } from '../types'
import { minimatch, path } from '../util/node'
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
 * @public
 */
export default class Watchman {
  private client: Client
  private relative_path: string | undefined
  private _listeners: ((change: FileChange) => void)[] = []
  private _root: string
  public subscription: string | undefined

  constructor(binaryPath: string, private channel?: OutputChannel) {
    const watchman = require('fb-watchman')
    this.client = new watchman.Client({
      watchmanBinaryPath: binaryPath
    })
    this.client.setMaxListeners(300)
  }

  public get root(): string {
    return this._root
  }

  public checkCapability(): Promise<boolean> {
    let { client } = this
    return new Promise(resolve => {
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
    this._root = root
    let resp = await this.command(['watch-project', root])
    let { watch, warning, relative_path } = resp as WatchResponse
    if (!watch) return false
    if (warning) {
      logger.warn(warning)
      this.appendOutput(warning, 'Warning')
    }
    this.relative_path = relative_path
    logger.info(`watchman watching project: ${root}`)
    this.appendOutput(`watchman watching project: ${root}`)
    let { clock } = await this.command(['clock', watch])
    let sub: any = {
      expression: ['allof', ['type', 'f', 'wholename']],
      fields: ['name', 'size', 'new', 'exists', 'type', 'mtime_ms', 'ctime_ms'],
      since: clock,
    }
    if (relative_path) {
      sub.relative_root = relative_path
      root = path.join(watch, relative_path)
    }
    let uid = uuidv1()
    let { subscribe } = await this.command(['subscribe', watch, uid, sub])
    this.subscription = subscribe
    this.appendOutput(`subscribing events in ${root}`)
    this.client.on('subscription', resp => {
      if (!resp || resp.subscription != uid || !resp.files) return
      for (let listener of this._listeners) {
        // @ts-expect-error file change item
        listener(resp)
      }
    })
    return true
  }

  private command(args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      // @ts-expect-error any type
      this.client.command(args, (error, resp) => {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        if (error) return reject(error)
        resolve(resp)
      })
    })
  }

  public subscribe(globPattern: string, cb: ChangeCallback): Disposable {
    let fn = (change: FileChange) => {
      let { files } = change
      files = files.filter(f => f.type == 'f' && minimatch(f.name, globPattern, { dot: true }))
      if (!files.length) return
      let ev: FileChange = Object.assign({}, change)
      if (this.relative_path) ev.root = path.resolve(change.root, this.relative_path)
      this.appendOutput(`file change of "${globPattern}" detected: ${JSON.stringify(ev, null, 2)}`)
      cb(ev)
    }
    this._listeners.push(fn)
    return {
      dispose: () => {
        let idx = this._listeners.indexOf(fn)
        if (idx !== -1) this._listeners.splice(idx, 1)
      },
    }
  }

  public dispose(): void {
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
