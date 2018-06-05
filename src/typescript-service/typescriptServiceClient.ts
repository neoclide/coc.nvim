import {Neovim} from 'neovim'
import * as cp from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import Tracer from './utils/tracer'
import {echoErr, echoWarning} from '../util/index'
import * as Proto from './protocol'
import {fork, getTempFile, makeRandomHexString} from './utils/process'
import API from './utils/api'
import {Reader, ICallback} from './utils/wireProtocol'
import {
  TypeScriptServiceConfiguration,
  TsServerLogLevel
} from './utils/configuration'
import {
  Uri,
  DiagnosticKind,
  EventEmitter,
  Event,
  disposeAll,
  fileSchemes,
} from '../vscode'
import {
  Disposable,
  CancellationToken,
} from 'vscode-languageserver-protocol'
import which = require('which')
import {ITypeScriptServiceClient} from './typescriptService'
import {inferredProjectConfig} from './utils/tsconfig'
import {
  TypeScriptVersionProvider,
  TypeScriptVersion
} from './utils/versionProvider'

import os = require('os')

const logger = require('../util/logger')('typescript-client')

interface CallbackItem {
  c: (value: any) => void
  e: (err: any) => void
  start: number
}

class CallbackMap {
  private readonly callbacks: Map<number, CallbackItem> = new Map()
  public pendingResponses = 0

  public destroy(e: any): void {
    for (const callback of this.callbacks.values()) {
      callback.e(e)
    }
    this.callbacks.clear()
    this.pendingResponses = 0
  }

  public add(seq: number, callback: CallbackItem):void {
    this.callbacks.set(seq, callback)
    ++this.pendingResponses
  }

  public fetch(seq: number): CallbackItem | undefined {
    const callback = this.callbacks.get(seq)
    this.delete(seq)
    return callback
  }

  private delete(seq: number):void {
    if (this.callbacks.delete(seq)) {
      --this.pendingResponses
    }
  }
}

interface RequestItem {
  request: Proto.Request
  callbacks: CallbackItem | null
}

class RequestQueue {
  private queue: RequestItem[] = []
  private sequenceNumber = 0

  public get length(): number {
    return this.queue.length
  }

  public push(item: RequestItem): void {
    this.queue.push(item)
  }

  public shift(): RequestItem | undefined {
    return this.queue.shift()
  }

  public tryCancelPendingRequest(seq: number): boolean {
    for (let i = 0; i < this.queue.length; i++) {
      if (this.queue[i].request.seq === seq) {
        this.queue.splice(i, 1)
        return true
      }
    }
    return false
  }

  public createRequest(command: string, args: any): Proto.Request {
    return {
      seq: this.sequenceNumber++,
      type: 'request',
      command,
      arguments: args
    }
  }
}

class ForkedTsServerProcess {
  constructor(private childProcess: cp.ChildProcess) {}

  public onError(cb: (err: Error) => void): void {
    this.childProcess.on('error', cb)
  }

  public onExit(cb: (err: any) => void): void {
    this.childProcess.on('exit', cb)
  }

  public write(serverRequest: Proto.Request):void {
    this.childProcess.stdin.write(
      JSON.stringify(serverRequest) + '\r\n',
      'utf8'
    )
  }

  public createReader(
    callback: ICallback<Proto.Response>,
    onError: (error: any) => void
  ):void {
    // tslint:disable-next-line:no-unused-expression
    new Reader<Proto.Response>(this.childProcess.stdout, callback, onError)
  }

  public kill():void {
    this.childProcess.kill()
  }
}

export interface TsDiagnostics {
  readonly kind: DiagnosticKind
  readonly resource: Uri
  readonly diagnostics: Proto.Diagnostic[]
}

export default class TypeScriptServiceClient implements ITypeScriptServiceClient {
  private static readonly WALK_THROUGH_SNIPPET_SCHEME_COLON = `${
    fileSchemes.walkThroughSnippet
  }:`

  private pathSeparator: string
  private tracer: Tracer

  private _onReady?: {
    promise: Promise<void>
    resolve: () => void
    reject: () => void
  }
  private _configuration: TypeScriptServiceConfiguration
  private versionProvider: TypeScriptVersionProvider
  private tsServerLogFile: string | null = null
  private servicePromise: Thenable<ForkedTsServerProcess> | null
  private lastError: Error | null
  private lastStart: number
  private numberRestarts: number
  private isRestarting = false

  private cancellationPipeName: string | null = null

  private requestQueue: RequestQueue
  private callbacks: CallbackMap

  private readonly _onTsServerStarted = new EventEmitter<API>()
  private readonly _onProjectLanguageServiceStateChanged = new EventEmitter<Proto.ProjectLanguageServiceStateEventBody>()
  private readonly _onDidBeginInstallTypings = new EventEmitter<Proto.BeginInstallTypesEventBody>()
  private readonly _onDidEndInstallTypings = new EventEmitter<Proto.EndInstallTypesEventBody>()
  private readonly _onTypesInstallerInitializationFailed = new EventEmitter<
    Proto.TypesInstallerInitializationFailedEventBody
  >()
  /**
   * API version obtained from the version picker after checking the corresponding path exists.
   */
  private _apiVersion: API
  /**
   * Version reported by currently-running tsserver.
   */
  private _tsserverVersion: string | undefined

  private readonly disposables: Disposable[] = []

  constructor(
    private readonly nvim: Neovim,
    public readonly root:string
  ) {
    this.root = root
    this.pathSeparator = path.sep
    this.lastStart = Date.now()

    let p = new Promise<void>((resolve, reject) => {
      // tslint:disable-line
      this._onReady = {promise: p, resolve, reject}
    })
    this._onReady!.promise = p

    this.servicePromise = null
    this.lastError = null
    this.numberRestarts = 0

    this.requestQueue = new RequestQueue()
    this.callbacks = new CallbackMap()
    this._configuration = TypeScriptServiceConfiguration.loadFromWorkspace()
    this.versionProvider = new TypeScriptVersionProvider(this._configuration)
    this._apiVersion = API.defaultVersion
    this._tsserverVersion = undefined
    this.tracer = new Tracer(logger)
  }

  private _onDiagnosticsReceived = new EventEmitter<TsDiagnostics>()
  public get onDiagnosticsReceived(): Event<TsDiagnostics> {
    return this._onDiagnosticsReceived.event
  }

  private _onConfigDiagnosticsReceived = new EventEmitter<Proto.ConfigFileDiagnosticEvent>()
  public get onConfigDiagnosticsReceived(): Event<Proto.ConfigFileDiagnosticEvent> {
    return this._onConfigDiagnosticsReceived.event
  }

  private _onResendModelsRequested = new EventEmitter<void>()
  public get onResendModelsRequested(): Event<void> {
    return this._onResendModelsRequested.event
  }

  public get configuration():TypeScriptServiceConfiguration {
    return this._configuration
  }

  public dispose():void {
    this._onTsServerStarted.dispose()
    this._onDidBeginInstallTypings.dispose()
    this._onDidEndInstallTypings.dispose()
    this._onTypesInstallerInitializationFailed.dispose()

    if (this.servicePromise) {
      this.servicePromise
        .then(childProcess => {
          childProcess.kill()
        })
        .then(undefined, () => void 0)
    }

    disposeAll(this.disposables)
    this._onDiagnosticsReceived.dispose()
    this._onConfigDiagnosticsReceived.dispose()
    this._onResendModelsRequested.dispose()
  }

  public restartTsServer(): void {
    const start = () => {
      this.servicePromise = this.startService(true)
      return this.servicePromise
    }

    if (this.servicePromise) {
      this.servicePromise.then(childProcess => {
          this.info('Killing TS Server')
          this.isRestarting = true
          childProcess.kill()
          this.resetClientVersion()
          this.servicePromise = null
        }).then(start)
    } else {
      start()
    }
  }

  public get onTsServerStarted(): Event<API> {
    return this._onTsServerStarted.event
  }

  public get onProjectLanguageServiceStateChanged(): Event<
    Proto.ProjectLanguageServiceStateEventBody
  > {
    return this._onProjectLanguageServiceStateChanged.event
  }

  public get onDidBeginInstallTypings(): Event<Proto.BeginInstallTypesEventBody> {
    return this._onDidBeginInstallTypings.event
  }

  public get onDidEndInstallTypings(): Event<Proto.EndInstallTypesEventBody> {
    return this._onDidEndInstallTypings.event
  }

  public get onTypesInstallerInitializationFailed():Event<Proto.TypesInstallerInitializationFailedEventBody> {
    return this._onTypesInstallerInitializationFailed.event
  }

  public get apiVersion(): API {
    return this._apiVersion
  }

  public onReady(f: () => void): Promise<void> {
    return this._onReady!.promise.then(f)
  }

  private info(message: string, data?: any): void {
    logger.info(message, data)
  }

  private error(message: string, data?: any): void {
    logger.error(message, data)
  }

  private service(): Thenable<ForkedTsServerProcess> {
    if (this.servicePromise) {
      return this.servicePromise
    }
    if (this.lastError) {
      return Promise.reject<ForkedTsServerProcess>(this.lastError)
    }
    this.startService() // tslint:disable-line
    if (this.servicePromise) {
      return this.servicePromise
    }
    return Promise.reject<ForkedTsServerProcess>(
      new Error('Could not create TS service')
    )
  }

  public ensureServiceStarted():void {
    if (!this.servicePromise) {
      this.startService() // tslint:disable-line
    }
  }

  private startService(
    resendModels = false
  ): Promise<ForkedTsServerProcess> {
    let {root} = this
    let currentVersion = this.versionProvider.getLocalVersion(root)
    if (!currentVersion && !fs.existsSync(currentVersion.tsServerPath)) {
      echoWarning(this.nvim, `Can't find local tsserver, Falling back to global TypeScript version.`) // tslint:disable-line
      currentVersion = this.versionProvider.defaultVersion
    }
    if (!currentVersion.isValid) {
      echoErr(this.nvim, 'Can not find tsserver') // tslint:disable-line
      return
    }
    this.info(`Using tsserver from: ${currentVersion.path}`)
    this._apiVersion = currentVersion.version
    this.requestQueue = new RequestQueue()
    this.callbacks = new CallbackMap()
    this.lastError = null
    return (this.servicePromise = new Promise<ForkedTsServerProcess>(
      async (resolve, reject) => {
        try {
          const tsServerForkArgs = await this.getTsServerArgs(currentVersion)
          const debugPort = this.getDebugPort()
          const tsServerForkOptions = {
            execArgv: debugPort ? [`--inspect=${debugPort}`] : [], // [`--debug-brk=5859`]
            cwd: this.root
          }
          fork(
            currentVersion.tsServerPath,
            tsServerForkArgs,
            tsServerForkOptions,
            (err: any, childProcess: cp.ChildProcess | null) => {
              if (err || !childProcess) {
                this.lastError = err

                this.error('Starting TSServer failed with error.', err)

                /* __GDPR__
							"error" : {}
						*/
                this.resetClientVersion()
                return
              }

              this.info('Started TSServer')
              const handle = new ForkedTsServerProcess(childProcess)
              this.lastStart = Date.now()

              handle.onError((err: Error) => {
                this.lastError = err
                this.error('TSServer errored with error.', err)
                if (this.tsServerLogFile) {
                  this.error(`TSServer log file: ${this.tsServerLogFile}`)
                }
                this.serviceExited(false)
              })
              handle.onExit((code: any) => {
                if (code === null || typeof code === 'undefined') {
                  this.info('TSServer exited')
                } else {
                  this.error(`TSServer exited with code: ${code}`)
                }
                if (this.tsServerLogFile) {
                  this.info(`TSServer log file: ${this.tsServerLogFile}`)
                }
                this.serviceExited(!this.isRestarting)
                this.isRestarting = false
              })

              handle.createReader(
                msg => {
                  this.dispatchMessage(msg)
                },
                error => {
                  this.error('ReaderError', error)
                }
              )

              this._onReady!.resolve()
              resolve(handle)
              this._onTsServerStarted.fire(currentVersion.version)

              this.serviceStarted(resendModels)
            }
          )
        } catch (error) {
          reject(error)
        }
      }
    ))
  }

  public async openTsServerLogFile(): Promise<boolean> {
    if (!this.apiVersion.has222Features()) {
      echoErr(this.nvim, 'TS Server logging requires TS 2.2.2+') // tslint:disable-line
      return false
    }

    if (this._configuration.tsServerLogLevel === TsServerLogLevel.Off) {
      echoErr(this.nvim, 'TS Server logging is off. Set env TSS_LOG_LEVEL to enable logging') // tslint:disable-line
      return false
    }

    if (!this.tsServerLogFile) {
      echoErr(this.nvim, 'TS Server has not started logging.') // tslint:disable-line
      return false
    }

    try {
      await this.nvim.command(`edit ${this.tsServerLogFile}`)
      return true
    } catch {
      echoErr(this.nvim, 'Could not open TS Server log file') // tslint:disable-line
      return false
    }
  }

  private serviceStarted(resendModels: boolean): void {
    const configureOptions: Proto.ConfigureRequestArguments = {
      hostInfo: 'coc-nvim'
    }
    this.execute('configure', configureOptions).catch(err => {
      logger.error(err)
    })
    this.setCompilerOptionsForInferredProjects(this._configuration)
    if (resendModels) {
      this._onResendModelsRequested.fire()
    }
  }

  private setCompilerOptionsForInferredProjects(
    configuration: TypeScriptServiceConfiguration
  ): void {
    if (!this.apiVersion.has206Features()) {
      return
    }

    const args: Proto.SetCompilerOptionsForInferredProjectsArgs = {
      options: this.getCompilerOptionsForInferredProjects(configuration)
    }
    this.execute('compilerOptionsForInferredProjects', args, true) // tslint:disable-line
  }

  private getCompilerOptionsForInferredProjects(
    configuration: TypeScriptServiceConfiguration
  ): Proto.ExternalProjectCompilerOptions {
    return {
      ...inferredProjectConfig(configuration),
      allowJs: true,
      allowSyntheticDefaultImports: true,
      allowNonTsExtensions: true
    }
  }

  private serviceExited(restart: boolean): void {
    this.servicePromise = null
    this.tsServerLogFile = null
    this.callbacks.destroy(new Error('Service died.'))
    this.callbacks = new CallbackMap()
    if (!restart) {
      this.resetClientVersion()
    } else {
      const diff = Date.now() - this.lastStart
      this.numberRestarts++
      let startService = true
      if (this.numberRestarts > 5) {
        this.numberRestarts = 0
        if (diff < 10 * 1000 /* 10 seconds */) {
          this.lastStart = Date.now()
          startService = false
          echoErr(this.nvim, 'The TypeScript language service died 5 times right after it got started.') // tslint:disable-line
          this.resetClientVersion()
        } else if (diff < 60 * 1000 /* 1 Minutes */) {
          this.lastStart = Date.now()
          echoErr(this.nvim, 'The TypeScript language service died unexpectedly 5 times in the last 5 Minutes.') // tslint:disable-line
        }
      }
      if (startService) {
        this.startService(true) // tslint:disable-line
      }
    }
  }

  public normalizePath(resource: Uri): string | null {
    if (this._apiVersion.has213Features()) {
      if (
        resource.scheme === fileSchemes.walkThroughSnippet ||
        resource.scheme === fileSchemes.untitled
      ) {
        const dirName = path.dirname(resource.path)
        const fileName =
          this.inMemoryResourcePrefix + path.basename(resource.path)
        return resource
          .with({path: path.posix.join(dirName, fileName)})
          .toString(true)
      }
    }

    if (resource.scheme !== fileSchemes.file) {
      return null
    }

    const result = resource.fsPath
    if (!result) {
      return null
    }

    // Both \ and / must be escaped in regular expressions
    return result.replace(new RegExp('\\' + this.pathSeparator, 'g'), '/')
  }

  private get inMemoryResourcePrefix(): string {
    return this._apiVersion.has270Features() ? '^' : ''
  }

  public asUrl(filepath: string): Uri {
    if (this._apiVersion.has213Features()) {
      if (
        filepath.startsWith(
          TypeScriptServiceClient.WALK_THROUGH_SNIPPET_SCHEME_COLON
        ) ||
        filepath.startsWith(fileSchemes.untitled + ':')
      ) {
        let resource = Uri.parse(filepath)
        if (this.inMemoryResourcePrefix) {
          const dirName = path.dirname(resource.path)
          const fileName = path.basename(resource.path)
          if (fileName.startsWith(this.inMemoryResourcePrefix)) {
            resource = resource.with({
              path: path.posix.join(
                dirName,
                fileName.slice(this.inMemoryResourcePrefix.length)
              )
            })
          }
        }
        return resource
      }
    }
    return Uri.file(filepath)
  }

  public execute(
    command: string,
    args: any,
    expectsResultOrToken?: boolean | CancellationToken
  ): Promise<any> {
    let token: CancellationToken | undefined
    let expectsResult = true
    if (typeof expectsResultOrToken === 'boolean') {
      expectsResult = expectsResultOrToken
    } else {
      token = expectsResultOrToken
    }

    const request = this.requestQueue.createRequest(command, args)
    const requestInfo: RequestItem = {
      request,
      callbacks: null
    }
    let result: Promise<any>
    if (expectsResult) {
      let wasCancelled = false
      result = new Promise<any>((resolve, reject) => {
        requestInfo.callbacks = {c: resolve, e: reject, start: Date.now()}
        if (token) {
          token.onCancellationRequested(() => {
            wasCancelled = true
            this.tryCancelRequest(request.seq)
          })
        }
      }).catch((err: any) => {
        if (!wasCancelled) {
          this.error(`'${command}' request failed with error.`, err)
        }
        throw err
      })
    } else {
      result = Promise.resolve(null)
    }
    this.requestQueue.push(requestInfo)
    this.sendNextRequests()

    return result
  }

  private sendNextRequests(): void {
    while (
      this.callbacks.pendingResponses === 0 &&
      this.requestQueue.length > 0
    ) {
      const item = this.requestQueue.shift()
      if (item) {
        this.sendRequest(item)
      }
    }
  }

  private sendRequest(requestItem: RequestItem): void {
    const serverRequest = requestItem.request
    this.tracer.traceRequest(
      serverRequest,
      !!requestItem.callbacks,
      this.requestQueue.length
    )
    if (requestItem.callbacks) {
      this.callbacks.add(serverRequest.seq, requestItem.callbacks)
    }
    this.service()
      .then(childProcess => {
        childProcess.write(serverRequest)
      })
      .then(undefined, err => {
        const callback = this.callbacks.fetch(serverRequest.seq)
        if (callback) {
          callback.e(err)
        }
      })
  }

  private tryCancelRequest(seq: number): boolean {
    try {
      if (this.requestQueue.tryCancelPendingRequest(seq)) {
        this.tracer.logTrace(
          `TypeScript Service: canceled request with sequence number ${seq}`
        )
        return true
      }

      if (this.apiVersion.has222Features() && this.cancellationPipeName) {
        this.tracer.logTrace(
          `TypeScript Service: trying to cancel ongoing request with sequence number ${seq}`
        )
        try {
          fs.writeFileSync(this.cancellationPipeName + seq, '')
        } catch {
          // noop
        }
        return true
      }

      this.tracer.logTrace(
        `TypeScript Service: tried to cancel request with sequence number ${seq}. But request got already delivered.`
      )
      return false
    } finally {
      const p = this.callbacks.fetch(seq)
      if (p) {
        p.e(new Error(`Cancelled Request ${seq}`))
      }
    }
  }

  private dispatchMessage(message: Proto.Message): void {
    try {
      if (message.type === 'response') {
        const response: Proto.Response = message as Proto.Response
        const p = this.callbacks.fetch(response.request_seq)
        if (p) {
          this.tracer.traceResponse(response, p.start)
          if (response.success) {
            p.c(response)
          } else {
            p.e(response)
          }
        }
      } else if (message.type === 'event') {
        const event: Proto.Event = message as Proto.Event
        this.tracer.traceEvent(event)
        this.dispatchEvent(event)
      } else {
        throw new Error('Unknown message type ' + message.type + ' received')
      }
    } finally {
      this.sendNextRequests()
    }
  }

  private dispatchEvent(event: Proto.Event):void {
    switch (event.event) {
      case 'syntaxDiag':
      case 'semanticDiag':
      case 'suggestionDiag':
        const diagnosticEvent: Proto.DiagnosticEvent = event
        if (diagnosticEvent.body && diagnosticEvent.body.diagnostics) {
          this._onDiagnosticsReceived.fire({
            kind: getDignosticsKind(event),
            resource: this.asUrl(diagnosticEvent.body.file),
            diagnostics: diagnosticEvent.body.diagnostics
          })
        }
        break

      case 'configFileDiag':
        this._onConfigDiagnosticsReceived.fire(
          event as Proto.ConfigFileDiagnosticEvent
        )
        break

      case 'projectLanguageServiceState':
        if (event.body) {
          this._onProjectLanguageServiceStateChanged.fire(
            (event as Proto.ProjectLanguageServiceStateEvent).body
          )
        }
        break

      case 'beginInstallTypes':
        if (event.body) {
          this._onDidBeginInstallTypings.fire(
            (event as Proto.BeginInstallTypesEvent).body
          )
        }
        break

      case 'endInstallTypes':
        if (event.body) {
          this._onDidEndInstallTypings.fire(
            (event as Proto.EndInstallTypesEvent).body
          )
        }
        break

      case 'typesInstallerInitializationFailed':
        if (event.body) {
          this._onTypesInstallerInitializationFailed.fire(
            (event as Proto.TypesInstallerInitializationFailedEvent).body
          )
        }
        break
    }
  }

  private async getTsServerArgs(
    currentVersion: TypeScriptVersion
  ): Promise<string[]> {
    const args: string[] = []

    if (this.apiVersion.has206Features()) {
      if (this.apiVersion.has250Features()) {
        args.push('--useInferredProjectPerProjectRoot')
      } else {
        args.push('--useSingleInferredProject')
      }

      if (this._configuration.disableAutomaticTypeAcquisition) {
        args.push('--disableAutomaticTypingAcquisition')
      }
    }

    if (this.apiVersion.has208Features()) {
      args.push('--enableTelemetry')
    }

    if (this.apiVersion.has222Features()) {
      this.cancellationPipeName = getTempFile(
        `tscancellation-${makeRandomHexString(20)}`
      )
      args.push('--cancellationPipeName', this.cancellationPipeName + '*')
    }

    if (this.apiVersion.has222Features()) {
      if (this._configuration.tsServerLogLevel !== TsServerLogLevel.Off) {
        const logDir = os.tmpdir()
        if (logDir) {
          this.tsServerLogFile = path.join(logDir, `coc-tsserver.log`)
          this.info(`TSServer log file: ${this.tsServerLogFile}`)
        } else {
          this.tsServerLogFile = null
          this.error('Could not create TSServer log directory')
        }

        if (this.tsServerLogFile) {
          args.push(
            '--logVerbosity',
            TsServerLogLevel.toString(this._configuration.tsServerLogLevel)
          )
          args.push('--logFile', this.tsServerLogFile)
        }
      }
    }

    if (this.apiVersion.has230Features()) {
      const plugins = this._configuration.tsServerPluginNames
      const pluginRoot = this._configuration.tsServerPluginRoot
      if (plugins.length) {
        args.push('--globalPlugins', plugins.join(','))
        if (pluginRoot) {
          args.push('--pluginProbeLocations', pluginRoot)
        }
      }
    }

    if (this.apiVersion.has234Features()) {
      if (this._configuration.npmLocation) {
        args.push('--npmLocation', `"${this._configuration.npmLocation}"`)
      } else {
        try {
          args.push('--npmLocation', `${which.sync('npm')}`)
        } catch (e) {} // tslint:disable-line
      }
    }
    return args
  }

  private getDebugPort(): number | undefined {
    const value = process.env['TSS_DEBUG'] // tslint:disable-line
    if (value) {
      const port = parseInt(value, 10)
      if (!isNaN(port)) {
        return port
      }
    }
    return undefined
  }

  private resetClientVersion():void {
    this._apiVersion = API.defaultVersion
    this._tsserverVersion = undefined
  }
}

function getDignosticsKind(event: Proto.Event):DiagnosticKind {
  switch (event.event) {
    case 'syntaxDiag':
      return DiagnosticKind.Syntax
    case 'semanticDiag':
      return DiagnosticKind.Semantic
    case 'suggestionDiag':
      return DiagnosticKind.Suggestion
  }
  throw new Error('Unknown dignostics kind')
}
