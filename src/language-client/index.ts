/* eslint-disable no-redeclare */
import cp, { SpawnOptions } from 'child_process'
import fs from 'fs'
import path from 'path'
import { createClientPipeTransport, createClientSocketTransport, Disposable, generateRandomPipeName, IPCMessageReader, IPCMessageWriter, StreamMessageReader, StreamMessageWriter } from 'vscode-languageserver-protocol'
import { ServiceStat } from '../types'
import { disposeAll } from '../util'
import * as Is from '../util/is'
import { terminate } from '../util/processes'
import workspace from '../workspace'
import { BaseLanguageClient, ClientState, DynamicFeature, LanguageClientOptions, MessageTransports, StaticFeature } from './client'
import { ColorProviderFeature } from './colorProvider'
import { ConfigurationFeature as PullConfigurationFeature } from './configuration'
import { DeclarationFeature } from './declaration'
import { FoldingRangeFeature } from './foldingRange'
import { ImplementationFeature } from './implementation'
import { ProgressFeature } from './progress'
import { TypeDefinitionFeature } from './typeDefinition'
import { WorkspaceFoldersFeature } from './workspaceFolders'
import { SelectionRangeFeature } from './selectionRange'
import ChildProcess = cp.ChildProcess

const logger = require('../util/logger')('language-client-index')

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
 * programm language the server simply needs to create a connection to the
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
    if (forceDebug === void 0) {
      forceDebug = false
    }
    super(id, name, clientOptions)
    this._serverOptions = serverOptions
    this._forceDebug = forceDebug
    this.registerProposedFeatures()
  }

  public stop(): Promise<void> {
    return super.stop().then(() => {
      if (this._serverProcess) {
        let toCheck = this._serverProcess
        this._serverProcess = undefined
        if (this._isDetached === void 0 || !this._isDetached) {
          this.checkProcessDied(toCheck)
        }
        this._isDetached = undefined
      }
    })
  }

  public get serviceState(): ServiceStat {
    let state = this._state
    switch (state) {
      case ClientState.Initial:
        return ServiceStat.Initial
      case ClientState.Running:
        return ServiceStat.Running
      case ClientState.StartFailed:
        return ServiceStat.StartFailed
      case ClientState.Starting:
        return ServiceStat.Starting
      case ClientState.Stopped:
        return ServiceStat.Stopped
      case ClientState.Stopping:
        return ServiceStat.Stopping
      default:
        logger.error(`Unknown state: ${state}`)
        return ServiceStat.Stopped
    }
  }

  public static stateName(state: ClientState): string {
    switch (state) {
      case ClientState.Initial:
        return 'Initial'
      case ClientState.Running:
        return 'Running'
      case ClientState.StartFailed:
        return 'StartFailed'
      case ClientState.Starting:
        return 'Starting'
      case ClientState.Stopped:
        return 'Stopped'
      case ClientState.Stopping:
        return 'Stopping'
      default:
        return 'Unknonw'
    }
  }

  private checkProcessDied(childProcess: ChildProcess | undefined): void {
    if (!childProcess || global.hasOwnProperty('__TEST__')) return
    setTimeout(() => {
      // Test if the process is still alive. Throws an exception if not
      try {
        process.kill(childProcess.pid, 0)
        terminate(childProcess)
      } catch (error) {
        // All is fine.
      }
    }, 1000)
  }

  protected handleConnectionClosed(): void {
    this._serverProcess = undefined
    super.handleConnectionClosed()
  }

  protected createMessageTransports(encoding: string): Promise<MessageTransports | null> {
    function getEnvironment(env: any): any {
      if (!env) return process.env
      return Object.assign({}, process.env, env)
    }

    function startedInDebugMode(): boolean {
      let args: string[] = (process as any).execArgv
      if (args) {
        return args.some(
          arg =>
            /^--debug=?/.test(arg) ||
            /^--debug-brk=?/.test(arg) ||
            /^--inspect=?/.test(arg) ||
            /^--inspect-brk=?/.test(arg)
        )
      }
      return false
    }

    let server = this._serverOptions
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
          cp.stderr.on('data', data => this.appendOutput(data, encoding))
          return {
            reader: new StreamMessageReader(cp.stdout),
            writer: new StreamMessageWriter(cp.stdin)
          }
        }
      })
    }
    let json = server as NodeModule | Executable
    let runDebug = server as { run: any; debug: any }
    if (runDebug.run || runDebug.debug) {
      // We are under debugging. So use debug as well.
      if (typeof v8debug === 'object' || this._forceDebug || startedInDebugMode()) {
        json = runDebug.debug
      } else {
        json = runDebug.run
      }
    } else {
      json = server as NodeModule | Executable
    }
    return this._getServerWorkingDir(json.options).then(serverWorkingDir => {
      if (NodeModule.is(json) && json.module) {
        let node = json
        let transport = node.transport || TransportKind.stdio
        let args: string[] = []
        let options: ForkOptions = node.options || Object.create(null)
        let runtime = node.runtime || process.execPath
        if (options.execArgv) options.execArgv.forEach(element => args.push(element))
        if (transport != TransportKind.ipc) args.push(node.module)
        if (node.args) node.args.forEach(element => args.push(element))
        let execOptions: SpawnOptions = Object.create(null)
        execOptions.cwd = serverWorkingDir
        execOptions.env = getEnvironment(options.env)
        let pipeName: string | undefined
        if (transport === TransportKind.ipc) {
          execOptions.stdio = [null, null, null]
          args.push('--node-ipc')
        } else if (transport === TransportKind.stdio) {
          args.push('--stdio')
        } else if (transport === TransportKind.pipe) {
          pipeName = generateRandomPipeName()
          args.push(`--pipe=${pipeName}`)
        } else if (Transport.isSocket(transport)) {
          args.push(`--socket=${transport.port}`)
        }
        args.push(`--clientProcessId=${process.pid.toString()}`)
        if (transport === TransportKind.ipc) {
          let forkOptions: cp.ForkOptions = {
            cwd: serverWorkingDir,
            env: getEnvironment(options.env),
            stdio: [null, null, null, 'ipc'],
            execPath: runtime,
            execArgv: options.execArgv || [],
          }
          let serverProcess = cp.fork(node.module, args, forkOptions)
          if (!serverProcess || !serverProcess.pid) {
            return Promise.reject<MessageTransports>(`Launching server module "${node.module}" failed.`)
          }
          serverProcess.on('error', e => {
            logger.error(e)
          })
          logger.info(`${this.id} started with ${serverProcess.pid}`)
          this._serverProcess = serverProcess
          serverProcess.stdout.on('data', data => this.appendOutput(data, encoding))
          serverProcess.stderr.on('data', data => this.appendOutput(data, encoding))
          return {
            reader: new IPCMessageReader(serverProcess),
            writer: new IPCMessageWriter(serverProcess)
          }
        } else if (transport === TransportKind.stdio) {
          let serverProcess = cp.spawn(runtime, args, execOptions)
          if (!serverProcess || !serverProcess.pid) {
            return Promise.reject<MessageTransports>(`Launching server module "${node.module}" failed.`)
          }
          logger.info(`${this.id} started with ${serverProcess.pid}`)
          this._serverProcess = serverProcess
          serverProcess.stderr.on('data', data => this.appendOutput(data, encoding))
          return {
            reader: new StreamMessageReader(serverProcess.stdout),
            writer: new StreamMessageWriter(serverProcess.stdin)
          }
        } else if (transport == TransportKind.pipe) {
          return Promise.resolve(createClientPipeTransport(pipeName)).then(transport => {
            let process = cp.spawn(runtime, args, execOptions)
            if (!process || !process.pid) {
              return Promise.reject<MessageTransports>(`Launching server module "${node.module}" failed.`)
            }
            logger.info(`Language server ${this.id} started with ${process.pid}`)
            this._serverProcess = process
            process.stderr.on('data', data => this.appendOutput(data, encoding))
            process.stdout.on('data', data => this.appendOutput(data, encoding))
            return Promise.resolve(transport.onConnected()).then(protocol => ({ reader: protocol[0], writer: protocol[1] }))
          })
        } else if (Transport.isSocket(node.transport)) {
          return Promise.resolve(createClientSocketTransport(node.transport.port)).then(transport => {
            let process = cp.spawn(runtime, args, execOptions)
            if (!process || !process.pid) {
              return Promise.reject<MessageTransports>(`Launching server ${node.module} failed.`)
            }
            process.on('exit', code => {
              if (code != 0) this.error(`command "${runtime} ${args.join(' ')}" exited with code: ${code}`)
            })
            logger.info(`Language server ${this.id} started with ${process.pid}`)
            this._serverProcess = process
            process.stderr.on('data', data => this.appendOutput(data, encoding))
            process.stdout.on('data', data => this.appendOutput(data, encoding))
            return Promise.resolve(transport.onConnected()).then(protocol => ({ reader: protocol[0], writer: protocol[1] }))
          })
        }
      } else if (Executable.is(json) && json.command) {
        let command: Executable = json
        let args = command.args || []
        let options = Object.assign({}, command.options)
        options.env = options.env ? Object.assign({}, process.env, options.env) : process.env
        options.cwd = serverWorkingDir
        let cmd = workspace.expand(json.command)
        let serverProcess = cp.spawn(cmd, args, options)
        serverProcess.on('error', e => {
          logger.error(e)
        })
        if (!serverProcess || !serverProcess.pid) {
          return Promise.reject<MessageTransports>(`Launching server "${this.id}" using command ${command.command} failed.`)
        }
        logger.info(`Language server "${this.id}" started with ${serverProcess.pid}`)
        serverProcess.on('exit', code => {
          if (code != 0) this.error(`${command.command} exited with code: ${code}`)
        })
        serverProcess.stderr.on('data', data => this.appendOutput(data, encoding))
        this._serverProcess = serverProcess
        this._isDetached = !!options.detached
        return {
          reader: new StreamMessageReader(serverProcess.stdout),
          writer: new StreamMessageWriter(serverProcess.stdin)
        }
      }
      return Promise.reject<MessageTransports>(`Unsupported server configuration ${JSON.stringify(server, null, 2)}`)
    })
  }

  public registerProposedFeatures(): void {
    this.registerFeatures(ProposedFeatures.createAll(this))
  }

  protected registerBuiltinFeatures(): void {
    super.registerBuiltinFeatures()
    this.registerFeature(new PullConfigurationFeature(this))
    this.registerFeature(new TypeDefinitionFeature(this))
    this.registerFeature(new ImplementationFeature(this))
    this.registerFeature(new DeclarationFeature(this))
    this.registerFeature(new ColorProviderFeature(this))
    this.registerFeature(new FoldingRangeFeature(this))
    this.registerFeature(new SelectionRangeFeature(this))
    this.registerFeature(new ProgressFeature(this))
    if (!this.clientOptions.disableWorkspaceFolders) {
      this.registerFeature(new WorkspaceFoldersFeature(this))
    }
  }

  private _getServerWorkingDir(options?: { cwd?: string }): Promise<string | undefined> {
    let cwd = options && options.cwd
    if (cwd && !path.isAbsolute(cwd)) cwd = path.join(workspace.cwd, cwd)
    if (!cwd) cwd = workspace.cwd
    if (cwd) {
      // make sure the folder exists otherwise creating the process will fail
      return new Promise(s => {
        fs.lstat(cwd, (err, stats) => {
          s(!err && stats.isDirectory() ? cwd : undefined)
        })
      })
    }
    return Promise.resolve(undefined)
  }

  private appendOutput(data: any, encoding: string): void {
    let msg: string = Is.string(data) ? data : data.toString(encoding)
    if (global.hasOwnProperty('__TEST__')) {
      console.log(msg)
      return
    }
    this.outputChannel.append(msg.endsWith('\n') ? msg : msg + '\n')
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
        if (this._client.needsStop()) {
          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          this._client.stop()
        }
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
      this._client.start()
    } else if (!enabled && this._client.needsStop()) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this._client.stop()
    }
  }
}

// Exporting proposed protocol.
export namespace ProposedFeatures {
  export function createAll(_client: BaseLanguageClient): (StaticFeature | DynamicFeature<any>)[] {
    let result: (StaticFeature | DynamicFeature<any>)[] = [
      // TODO
      // new CallHierarchyFeature(client),
      // new SemanticTokensFeature(client)
    ]
    return result
  }
}
