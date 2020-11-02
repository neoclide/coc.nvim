/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

import { Disposable, NotificationHandler, NotificationType, ProgressToken, ProgressType, WorkDoneProgress, WorkDoneProgressBegin, WorkDoneProgressReport } from 'vscode-languageserver-protocol'
import { StatusBarItem } from '../types'
import window from '../window'
import { disposeAll } from '../util'

export interface ProgressContext {
  onProgress<P>(type: ProgressType<P>, token: string | number, handler: NotificationHandler<P>): Disposable
  sendNotification<P, RO>(type: NotificationType<P, RO>, params?: P): void
}

const progressParts: Map<ProgressToken, ProgressPart> = new Map()

class ProgressPart {
  private _disposables: Disposable[] = []
  private _statusBarItem: StatusBarItem | undefined
  private _cancelled = false
  private title: string

  public constructor(private _client: ProgressContext, private _token: ProgressToken) {
    this._statusBarItem = window.createStatusBarItem(99, { progress: true })
    this._disposables.push(this._statusBarItem)
    this._disposables.push(_client.onProgress(WorkDoneProgress.type, this._token, value => {
      switch (value.kind) {
        case 'begin':
          this.begin(value)
          break
        case 'report':
          this.report(value)
          break
        case 'end':
          this.done(value.message)
          break
      }
    }))
  }

  public begin(params: WorkDoneProgressBegin): void {
    // TODO: support progress window with cancel button & WorkDoneProgressCancelNotification
    this.title = params.title
    this.report(params)
  }

  private report(params: WorkDoneProgressReport | WorkDoneProgressBegin): void {
    let statusBarItem = this._statusBarItem
    let parts: string[] = []
    if (this.title) parts.push(this.title)
    if (params.percentage) parts.push(params.percentage.toFixed(0) + '%')
    if (params.message) parts.push(params.message)
    statusBarItem.text = parts.join(' ')
    statusBarItem.show()
  }

  public cancel(): void {
    if (this._cancelled) return
    this._cancelled = true
    disposeAll(this._disposables)
    if (progressParts.has(this._token)) {
      progressParts.delete(this._token)
    }
  }

  public done(message?: string): void {
    let statusBarItem = this._statusBarItem
    if (!message) {
      this.cancel()
    } else {
      statusBarItem.text = `${this.title} ${message}`
      setTimeout(() => {
        this.cancel()
      }, 500)
    }
  }
}

class ProgressManager {
  public create(client: ProgressContext, token: ProgressToken): ProgressPart {
    let part = this.getProgress(token)
    if (part) return part
    part = new ProgressPart(client, token)
    progressParts.set(token, part)
    return part
  }

  public getProgress(token: ProgressToken): ProgressPart | null {
    return progressParts.get(token) || null
  }

  public cancel(token: ProgressToken): void {
    let progress = this.getProgress(token)
    if (progress) progress.cancel()
  }
}

export default new ProgressManager()
