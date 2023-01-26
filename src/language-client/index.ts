'use strict'
/* eslint-disable no-redeclare */
import { ChildProcess, ChildProcessWithoutNullStreams, ForkOptions as CForkOptions } from 'child_process'
import { createLogger } from '../logger'
import { disposeAll, getConditionValue } from '../util'
import * as Is from '../util/is'
import { child_process, fs, path } from '../util/node'
import { terminate } from '../util/processes'
import { createClientPipeTransport, createClientSocketTransport, Disposable, generateRandomPipeName, IPCMessageReader, IPCMessageWriter, StreamMessageReader, StreamMessageWriter } from '../util/protocol'
import workspace from '../workspace'
import { BaseLanguageClient, LanguageClientOptions, MessageTransports } from './client'

const logger = createLogger('language-client-index')
const debugStartWith: string[] = ['--debug=', '--debug-brk=', '--inspect=', '--inspect-brk=']
const debugEquals: string[] = ['--debug', '--debug-brk', '--inspect', '--inspect-brk']
const STOP_TIMEOUT = getConditionValue(2000, 100)

export * from './client'

declare let v8debug: any

export interface ExecutableOptions {
  cwd?: string
  env?: any
  detached?: boolean
  shell?: boolean
}

export interface Executable {
  command: string
  args?: string[]
  options?: ExecutableOptions
}

namespace Executable {
  export function is(value: any): value is Executable {
    return Is.string(value.command)
  }
}

export interface ForkOptions {
  cwd?: string
  env?: any
  execPath?: string
  encoding?: string
  execArgv?: string[]
}

export enum TransportKind {
  stdio,
  ipc,
  pipe,
  socket
}

export interface SocketTransport {
  kind: TransportKind.socket
  port: number
}

namespace Transport {
  export function isSocket(value: Transport): value is SocketTransport {
    let candidate = value as SocketTransport
    return (
      candidate &&
      candidate.kind === TransportKind.socket &&
      Is.number(candidate.port)
    )
  }
}

/**
 * To avoid any timing, pipe name or port number issues the pipe (TransportKind.pipe)
 * and the sockets (TransportKind.socket and SocketTransport) are owned by the
 * VS Code processes. The server process simply connects to the pipe / socket.
 * In node term the VS Code process calls `createServer`, then starts the server
 * process, waits until the server process has connected to the pipe / socket
 * and then signals that the connection has been established and messages can
 * be send back and forth. If the language server is implemented in a different
 * program language the server simply needs to create a connection to the
 * passed pipe name or port number.
 */
export type Transport = TransportKind | SocketTransport

export interface NodeModule {
  module: string
  transport?: Transport
  args?: string[]
  runtime?: string
  options?: ForkOptions
}

namespace NodeModule {
  export function is(value: any): value is NodeModule {
    return Is.string(value.module)
  }
}

export interface StreamInfo {
  writer: NodeJS.WritableStream
  reader: NodeJS.ReadableStream
  detached?: boolean
}

namespace StreamInfo {
  export function is(value: any): value is StreamInfo {
    let candidate = value as StreamInfo
    return (
      candidate && candidate.writer !== void 0 && candidate.reader !== void 0
    )
  }
}

export interface ChildProcessInfo {
  process: ChildProcess
  detached: boolean
}

namespace ChildProcessInfo {
  export function is(value: any): value is ChildProcessInfo {
    let candidate = value as ChildProcessInfo
    return (
      candidate &&
      candidate.process !== void 0 &&
      typeof candidate.detached === 'boolean'
    )
  }
}

export type ServerOptions =
  | Executable
  | { run: Executable; debug: Executable }
  | { run: NodeModule; debug: NodeModule }
  | NodeModule
  | (() => Promise<ChildProcess | StreamInfo | MessageTransports | ChildProcessInfo>)

export class LanguageClient extends BaseLanguageClient {
  private _forceDebug: boolean
  private _isInDebugMode: boolean

  private _serverProcess: ChildProcess | undefined
  private _isDetached: boolean | undefined
  private _serverOptions: ServerOptions

  public constructor(
    name: string,
    serverOptions: ServerOptions,
    clientOptions: LanguageClientOptions,
    forceDebug?: boolean
  )
  public constructor(
    id: string,
    name: string,
    serverOptions: ServerOptions,
    clientOptions: LanguageClientOptions,
    forceDebug?: boolean
  )
  public constructor(
    arg1: string,
    arg2: string | ServerOptions,
    arg3: LanguageClientOptions | ServerOptions,
    arg4?: boolean | LanguageClientOptions,
    arg5?: boolean
  ) {
    let id: string
    let name: string
    let serverOptions: ServerOptions
    let clientOptions: LanguageClientOptions
    let forceDebug: boolean
    if (Is.string(arg2)) {
      id = arg1
      name = arg2
      serverOptions = arg3 as ServerOptions
      clientOptions = arg4 as LanguageClientOptions
      forceDebug = !!arg5
    } else {
      // first signature
      id = arg1.toLowerCase()
      name = arg1
      serverOptions = arg2
      clientOptions = arg3 as LanguageClientOptions
      forceDebug = arg4 as boolean
    }
    super(id, name, clientOptions)
    this._serverOptions = serverOptions
    this._forceDebug = !!forceDebug
    this._isInDebugMode = !!forceDebug
  }

  public stop(timeout = STOP_TIMEOUT): Promise<void> {
    return super.stop(timeout).then(() => {
      if (this._serverProcess) {
        let toCheck = this._serverProcess
        this._serverProcess = undefined
        if (this._isDetached === void 0 || !this._isDetached) {
          this.checkProcessDied(toCheck)
        }
        this._isDetached = undefined
      }
    }, err => {
      if (this._serverProcess && err.message.includes('timed out')) {
        this._serverProcess.kill('SIGKILL')
        this._serverProcess = undefined
        return
      }
      throw err
    })
  }

  public get serviceState() {
    return this._state
  }

  private checkProcessDied(childProcess: ChildProcess | undefined): void {
    if (!childProcess || childProcess.pid === undefined) return
    setTimeout(() => {
      // Test if the process is still alive. Throws an exception if not
      try {
        process.kill(childProcess.pid, 0)
        terminate(childProcess)
      } catch (error) {
        // All is fine.
      }
    }, STOP_TIMEOUT)
  }

  protected handleConnectionClosed(): void {
    this._serverProcess = undefined
    super.handleConnectionClosed()
  }

  public get isInDebugMode(): boolean {
    return this._isInDebugMode
  }

  public async restart(): Promise<void> {
    await this.stop()
    // We are in debug mode. Wait a little before we restart
    // so that the debug port can be freed. We can safely ignore
    // the disposable returned from start since it will call
    // stop on the same client instance.
    if (this.isInDebugMode) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      await this._start()
    } else {
      await this._start()
    }
  }

  protected createMessageTransports(encoding: string): Promise<MessageTransports> {

    function getEnvironment(env: any, fork: boolean): any {
      if (!env && !fork) {
        return undefined
      }
      let result: any = Object.create(null)
      Object.keys(process.env).forEach(key => result[key] = process.env[key])
      if (env) {
        Object.keys(env).forEach(key => result[key] = env[key])
      }
      return result
    }

    function assertStdio(process: ChildProcess): asserts process is ChildProcessWithoutNullStreams {
      if (process.stdin === null || process.stdout === null || process.stderr === null) {
        throw new Error('Process created without stdio streams')
      }
    }

    let server = this._serverOptions
    const logMessage = this.logMessage.bind(this)
    // We got a function.
    if (Is.func(server)) {
      return server().then(result => {
        if (MessageTransports.is(result)) {
          this._isDetached = !!result.detached
          return result
        } else if (StreamInfo.is(result)) {
          this._isDetached = !!result.detached
          return {
            reader: new StreamMessageReader(result.reader),
            writer: new StreamMessageWriter(result.writer)
          }
        } else {
          let cp: ChildProcess
          if (ChildProcessInfo.is(result)) {
            cp = result.process
            this._isDetached = result.detached
          } else {
            cp = result
            this._isDetached = false
          }
          cp.stderr!.on('data', logMessage)
          return {
            reader: new StreamMessageReader(cp.stdout!),
            writer: new StreamMessageWriter(cp.stdin!)
          }
        }
      })
    }
    let json: NodeModule | Executable
    let runDebug = server as { run: any; debug: any }
    if (runDebug.run || runDebug.debug) {
      if (typeof v8debug === 'object' || this._forceDebug || startedInDebugMode(process.execArgv)) {
        json = runDebug.debug
      } else {
        json = runDebug.run
      }
    } else {
      json = server as NodeModule | Executable
    }
    return getServerWorkingDir(json.options).then(serverWorkingDir => {
      if (NodeModule.is(json) && json.module) {
        let node = json
        let transport = node.transport || TransportKind.stdio
        let pipeName: string | undefined
        let runtime = node.runtime ? getRuntimePath(node.runtime, serverWorkingDir) : undefined
        return new Promise<MessageTransports>((resolve, _reject) => {
          let args = node.args && node.args.slice() || []
          if (transport === TransportKind.ipc) {
            args.push('--node-ipc')
          } else if (transport === TransportKind.stdio) {
            args.push('--stdio')
          } else if (transport === TransportKind.pipe) {
            pipeName = generateRandomPipeName()
            args.push(`--pipe=${pipeName}`)
          } else if (Transport.isSocket(transport)) {
            args.push(`--socket=${transport.port}`)
          }
          args.push(`--clientProcessId=${process.pid}`)
          let options: CForkOptions = node.options || Object.create(null)
          options.env = getEnvironment(options.env, true)
          options.execArgv = options.execArgv || []
          options.cwd = serverWorkingDir
          options.silent = true
          if (runtime) options.execPath = runtime
          if (transport === TransportKind.ipc || transport === TransportKind.stdio) {
            let sp = child_process.fork(node.module, args || [], options)
            assertStdio(sp)
            this._serverProcess = sp
            logger.info(`Language server "${this.id}" started with ${sp.pid}`)
            sp.stderr.on('data', logMessage)
            if (transport === TransportKind.ipc) {
              sp.stdout.on('data', logMessage)
              resolve({ reader: new IPCMessageReader(this._serverProcess), writer: new IPCMessageWriter(this._serverProcess) })
            } else {
              resolve({ reader: new StreamMessageReader(sp.stdout), writer: new StreamMessageWriter(sp.stdin) })
            }
          } else if (transport === TransportKind.pipe) {
            return createClientPipeTransport(pipeName!).then(transport => {
              let sp = child_process.fork(node.module, args || [], options)
              assertStdio(sp)
              logger.info(`Language server "${this.id}" started with ${sp.pid}`)
              this._serverProcess = sp
              sp.stderr.on('data', logMessage)
              sp.stdout.on('data', logMessage)
              void transport.onConnected().then(protocol => {
                resolve({ reader: protocol[0], writer: protocol[1] })
              })
            })
          } else if (Transport.isSocket(transport)) {
            return createClientSocketTransport(transport.port).then(transport => {
              let sp = child_process.fork(node.module, args || [], options)
              assertStdio(sp)
              this._serverProcess = sp
              logger.info(`Language server "${this.id}" started with ${sp.pid}`)
              sp.stderr.on('data', logMessage)
              sp.stdout.on('data', logMessage)
              void transport.onConnected().then(protocol => {
                resolve({ reader: protocol[0], writer: protocol[1] })
              })
            })
          }
        })
      } else if (Executable.is(json) && json.command) {
        let command: Executable = json
        let args = command.args || []
        let options = Object.assign({}, command.options)
        options.env = options.env ? Object.assign({}, process.env, options.env) : process.env
        options.cwd = options.cwd || serverWorkingDir
        let cmd = workspace.expand(json.command)
        let serverProcess = child_process.spawn(cmd, args, options)
        serverProcess.on('error', e => {
          this.error(e.message, e)
        })
        if (!serverProcess || !serverProcess.pid) {
          return Promise.reject<MessageTransports>(new Error(`Launching server "${this.id}" using command ${command.command} failed.`))
        }
        logger.info(`Language server "${this.id}" started with ${serverProcess.pid}`)
        serverProcess.on('exit', code => {
          if (code != 0) this.error(`${command.command} exited with code: ${code}`)
        })
        serverProcess.stderr.on('data', data => this.outputChannel.append(Is.string(data) ? data : data.toString(encoding)))
        this._serverProcess = serverProcess
        this._isDetached = !!options.detached
        return Promise.resolve({ reader: new StreamMessageReader(serverProcess.stdout), writer: new StreamMessageWriter(serverProcess.stdin) })
      }
      return Promise.reject<MessageTransports>(`Unsupported server configuration ${JSON.stringify(server, null, 2)}`)
    })
  }

  public logMessage(data: string | Buffer): void {
    let encoding = this.clientOptions.stdioEncoding
    this.outputChannel.append(Is.string(data) ? data : data.toString(encoding as BufferEncoding))
  }
}

export class SettingMonitor {
  private _listeners: Disposable[]

  constructor(private _client: LanguageClient, private _setting: string) {
    this._listeners = []
  }

  public start(): Disposable {
    workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration(this._setting)) {
        this.onDidChangeConfiguration()
      }
    }, null, this._listeners)
    this.onDidChangeConfiguration()
    return {
      dispose: () => {
        disposeAll(this._listeners)
        void this._client.dispose()
      }
    }
  }

  private onDidChangeConfiguration(): void {
    let index = this._setting.indexOf('.')
    let primary = index >= 0 ? this._setting.substr(0, index) : this._setting
    let rest = index >= 0 ? this._setting.substr(index + 1) : undefined
    let enabled = rest
      ? workspace.getConfiguration(primary).get(rest, true)
      : workspace.getConfiguration(primary)
    if (enabled && this._client.needsStart()) {
      this._client.start().catch(error => this._client.error('Start failed after configuration change', error, 'force'))
    } else if (!enabled && this._client.needsStop()) {
      this._client.stop().catch(error => this._client.error('Stop failed after configuration change', error, 'force'))
    }
  }
}

export function getRuntimePath(runtime: string, serverWorkingDirectory: string | undefined): string {
  if (path.isAbsolute(runtime)) {
    return runtime
  }
  const mainRootPath = mainGetRootPath()
  if (mainRootPath !== undefined) {
    const result = path.join(mainRootPath, runtime)
    if (fs.existsSync(result)) {
      return result
    }
  }
  if (serverWorkingDirectory !== undefined) {
    const result = path.join(serverWorkingDirectory, runtime)
    if (fs.existsSync(result)) {
      return result
    }
  }
  return runtime
}

export function mainGetRootPath(): string | undefined {
  let folders = workspace.workspaceFolders
  if (!folders || folders.length === 0) {
    return undefined
  }
  let folder = folders[0]
  return folder.uri
}

export function getServerWorkingDir(options?: { cwd?: string }): Promise<string | undefined> {
  let cwd = options && options.cwd
  if (cwd && !path.isAbsolute(cwd)) cwd = path.join(workspace.cwd, cwd)
  if (!cwd) cwd = workspace.cwd
  // make sure the folder exists otherwise creating the process will fail
  return new Promise(s => {
    fs.lstat(cwd, (err, stats) => {
      s(!err && stats.isDirectory() ? cwd : undefined)
    })
  })
}

export function startedInDebugMode(args: string[] | undefined): boolean {
  if (args) {
    return args.some(arg => {
      return debugStartWith.some(value => arg.startsWith(value)) ||
        debugEquals.some(value => arg === value)
    })
  }
  return false
}
