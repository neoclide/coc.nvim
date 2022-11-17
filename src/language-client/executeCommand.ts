'use strict'
import type { Disposable, ExecuteCommandRegistrationOptions, ClientCapabilities, ServerCapabilities, RegistrationType, ExecuteCommandParams } from 'vscode-languageserver-protocol'
import { ExecuteCommandRequest, CancellationToken } from '../util/protocol'
import { ProviderResult } from '../provider'
import { ensure, RegistrationData, DynamicFeature, FeatureClient, FeatureState, BaseFeature } from './features'
import commands from '../commands'
import * as UUID from './utils/uuid'

export interface ExecuteCommandSignature {
  (this: void, command: string, args: any[]): ProviderResult<any>
}

export interface ExecuteCommandMiddleware {
  executeCommand?: (this: void, command: string, args: any[], next: ExecuteCommandSignature) => ProviderResult<any>
}

export class ExecuteCommandFeature extends BaseFeature<ExecuteCommandMiddleware> implements DynamicFeature<ExecuteCommandRegistrationOptions> {
  private _commands: Map<string, Disposable[]> = new Map<string, Disposable[]>()
  constructor(client: FeatureClient<ExecuteCommandMiddleware>) {
    super(client)
  }

  public getState(): FeatureState {
    return { kind: 'workspace', id: this.registrationType.method, registrations: this._commands.size > 0 }
  }

  public get registrationType(): RegistrationType<ExecuteCommandRegistrationOptions> {
    return ExecuteCommandRequest.type
  }

  public fillClientCapabilities(capabilities: ClientCapabilities): void {
    ensure(ensure(capabilities, 'workspace')!, 'executeCommand')!.dynamicRegistration = true
  }

  public initialize(capabilities: ServerCapabilities): void {
    if (!capabilities.executeCommandProvider) {
      return
    }
    this.register({
      id: UUID.generateUuid(),
      registerOptions: Object.assign({}, capabilities.executeCommandProvider)
    })
  }

  public register(
    data: RegistrationData<ExecuteCommandRegistrationOptions>
  ): void {
    const client = this._client
    const middleware = client.middleware!
    const executeCommand: ExecuteCommandSignature = (command: string, args: any[]): any => {
      const params: ExecuteCommandParams = {
        command,
        arguments: args
      }
      return this.sendRequest(ExecuteCommandRequest.type, params, CancellationToken.None)
    }
    if (data.registerOptions.commands) {
      let disposables: Disposable[] = []
      for (const command of data.registerOptions.commands) {
        disposables.push(commands.registerCommand(command, (...args: any[]) => {
          return middleware.executeCommand
            ? middleware.executeCommand(command, args, executeCommand)
            : executeCommand(command, args)
        }, null, true))
      }
      this._commands.set(data.id, disposables)
    }
  }

  public unregister(id: string): void {
    let disposables = this._commands.get(id)
    if (disposables) {
      disposables.forEach(disposable => disposable.dispose())
    }
  }

  public dispose(): void {
    this._commands.forEach(value => {
      value.forEach(disposable => disposable.dispose())
    })
    this._commands.clear()
  }
}
