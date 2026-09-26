'use strict'
import type { Client } from 'fb-watchman'
import { createLogger } from '../logger'
import { OutputChannel } from '../types'
import { child_process, path, promisify } from '../util/node'
import { Disposable } from '../util/protocol'
import { ChangeCallback, createChangeFilter, FileChange, FileChangeItem, FileWatcherClient } from './fileWatcher'
const logger = createLogger('core-watchman')
const requiredCapabilities = ['relative_root', 'cmd-watch-project', 'wildmatch', 'field-new']

export interface WatchResponse {
  warning?: string
  watcher: string
  watch: string
  relative_path?: string
}

export type { FileChange, FileChangeItem } from './fileWatcher'

/**
 * Watchman wrapper for fb-watchman client
 * @public
 */
export default class Watchman implements FileWatcherClient {
  private client: Client
  private relative_path: string | undefined
  private _listeners: ((change: FileChange) => void)[] = []
  private _root: string
  public subscription: string | undefined

  constructor(binaryPath: string, private channel?: OutputChannel, socketPath?: string) {
    const watchman = require('fb-watchman')
    this.client = new watchman.Client({
      watchmanBinaryPath: binaryPath
    })
    this.client.setMaxListeners(300)
    if (socketPath) {
      let client = this.client
      let connect = client.connect.bind(client)
      client.connect = () => {
        let previous = process.env.WATCHMAN_SOCK
        process.env.WATCHMAN_SOCK = socketPath
        try {
          // fb-watchman has no socket-path option. It reads WATCHMAN_SOCK
          // synchronously before creating the socket, so restore it before
          // returning and never expose it across asynchronous work.
          connect()
        } finally {
          if (previous == null) delete process.env.WATCHMAN_SOCK
          else process.env.WATCHMAN_SOCK = previous
        }
      }
    }
    this.client.on('error', error => {
      logger.error('Watchman client error', error)
      this.appendOutput(`Watchman client error: ${error}`, 'Error')
      // fb-watchman reports connection and spawn failures only through this
      // event. Ending the client cancels the pending command so initialization
      // can fail and the manager can try its other backend.
      this.dispose()
    })
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
    let uid = crypto.randomUUID()
    let { subscribe } = await this.command(['subscribe', watch, uid, sub])
    this.subscription = subscribe
    this.appendOutput(`subscribing events in ${root}`)
    this.client.on('subscription', resp => {
      if (!resp || resp.subscription != uid || !resp.files) return
      for (let listener of this._listeners) {
        // The watchman subscription payload matches FileChange at runtime;
        // @types/fb-watchman's FileChange shape omits the `new` field.
        listener(resp as unknown as FileChange)
      }
    })
    return true
  }

  private command(args: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
      // Watchman commands are built dynamically from `args`, so they don't
      // statically match any single overload of Client.command().
      // @ts-expect-error dynamic watchman command args
      this.client.command(args, (error, resp) => {
        if (error) return reject(error)
        resolve(resp)
      })
    })
  }

  public subscribe(globPattern: string, cb: ChangeCallback): Disposable {
    let filterChanges = createChangeFilter(globPattern)
    let fn = (change: FileChange) => {
      let ev = filterChanges(change)
      if (!ev) return
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
      let socketPath: string | undefined
      if (!process.env.WATCHMAN_SOCK) {
        try {
          let execFile = promisify(child_process.execFile)
          let { stdout, stderr } = await execFile(binaryPath, ['--no-pretty', 'get-sockname'], { windowsHide: true })
          if (stderr) channel?.appendLine(`Watchman get-sockname stderr: ${stderr}`)
          let value: unknown = JSON.parse(stdout)
          if (typeof value !== 'object' || value == null || typeof (value as { sockname?: unknown }).sockname !== 'string' || (value as { sockname: string }).sockname.length === 0) {
            throw new Error(`Invalid Watchman socket response: ${stdout}`)
          }
          socketPath = (value as { sockname: string }).sockname
        } catch (error) {
          let stderr = (error as { stderr?: string | Buffer }).stderr
          if (stderr) channel?.appendLine(`Watchman get-sockname stderr: ${stderr}`)
          channel?.appendLine(`Watchman get-sockname failed: ${error}`)
          throw error
        }
      }
      if (socketPath) channel?.appendLine(`Watchman socket: ${socketPath}`)
      else channel?.appendLine(`Watchman socket from WATCHMAN_SOCK: ${process.env.WATCHMAN_SOCK}`)
      watchman = new Watchman(binaryPath, channel, socketPath)
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
