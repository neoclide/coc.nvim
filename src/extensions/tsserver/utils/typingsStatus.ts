/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Disposable } from 'vscode-languageserver-protocol'
import { ITypeScriptServiceClient } from '../typescriptService'
import { errorMsg, moreMsg } from './nvimBinding'

const typingsInstallTimeout = 30 * 1000

export default class TypingsStatus implements Disposable {
  private _acquiringTypings: { [eventId: string]: NodeJS.Timer } = Object.create(
    {}
  )
  private _client: ITypeScriptServiceClient
  private _subscriptions: Disposable[] = []

  constructor(client: ITypeScriptServiceClient) {
    this._client = client
    this._subscriptions.push(
      this._client.onDidBeginInstallTypings(event =>
        this.onBeginInstallTypings(event.eventId)
      )
    )

    this._subscriptions.push(
      this._client.onDidEndInstallTypings(event =>
        this.onEndInstallTypings(event.eventId)
      )
    )
  }

  public dispose(): void {
    this._subscriptions.forEach(x => x.dispose())

    for (const eventId of Object.keys(this._acquiringTypings)) {
      clearTimeout(this._acquiringTypings[eventId])
    }
  }

  public get isAcquiringTypings(): boolean {
    return Object.keys(this._acquiringTypings).length > 0
  }

  private onBeginInstallTypings(eventId: number): void {
    if (this._acquiringTypings[eventId]) {
      return
    }
    this._acquiringTypings[eventId] = setTimeout(() => {
      moreMsg('typing install timeout')
      this.onEndInstallTypings(eventId)
    }, typingsInstallTimeout)
  }

  private onEndInstallTypings(eventId: number): void {
    const timer = this._acquiringTypings[eventId]
    if (timer) {
      clearTimeout(timer)
    }
    delete this._acquiringTypings[eventId]
  }
}

export class AtaProgressReporter {
  private _promises = new Map<number, Function>()
  private _disposable: Disposable
  private _invalid = false

  constructor(client: ITypeScriptServiceClient) {
    const disposables: Disposable[] = []
    disposables.push(client.onDidBeginInstallTypings(e => this._onBegin(e.eventId)))
    disposables.push(client.onDidEndInstallTypings(e => this._onEndOrTimeout(e.eventId)))
    disposables.push(client.onTypesInstallerInitializationFailed(_ =>
      this.onTypesInstallerInitializationFailed()
    ))
    this._disposable = Disposable.create(() => {
      disposables.forEach(disposable => {
        disposable.dispose()
      })
    })
  }

  public dispose(): void {
    this._disposable.dispose()
    this._promises.forEach(value => value())
  }

  private _onBegin(eventId: number): void {
    const handle = setTimeout(
      () => this._onEndOrTimeout(eventId),
      typingsInstallTimeout
    )
    const promise = new Promise(resolve => { // tslint:disable-line
      this._promises.set(eventId, () => {
        clearTimeout(handle)
        resolve()
      })
    })
    moreMsg('Fetching data for better TypeScript IntelliSense')
  }

  private _onEndOrTimeout(eventId: number): void {
    const resolve = this._promises.get(eventId)
    if (resolve) {
      this._promises.delete(eventId)
      resolve()
    }
  }

  private onTypesInstallerInitializationFailed() { // tslint:disable-line
    if (!this._invalid) {
      errorMsg('Could not install typings files for JavaScript language features. Please ensure that NPM is installed')
    }
    this._invalid = true
  }
}
