/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

import { CancellationToken, Disposable, NotificationHandler, NotificationType, ProgressToken, ProgressType, WorkDoneProgress, WorkDoneProgressBegin, WorkDoneProgressCancelNotification, WorkDoneProgressReport } from 'vscode-languageserver-protocol'
import { Progress, StatusBarItem } from '../types'
import { disposeAll } from '../util'
import window from '../window'
import workspace from '../workspace'
const logger = require('../util/logger')('language-client-progressPart')

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
  private _progress: Progress<{ message?: string; increment?: number}>
  private _cancellationToken: CancellationToken
  private _progressTarget: string

  private _reported = 0
  private _resolve: (() => void) | undefined
  private _reject: ((reason?: any) => void) | undefined

  public constructor(private _client: ProgressContext, private _token: ProgressToken) {
    this._progressTarget = workspace.getConfiguration('workspace').get<string>('progressTarget', 'float')
    if (!workspace.env.dialog) {
      this._progressTarget = 'statusline'
    }
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
    this.title = params.title

    if (this._progressTarget === 'float') {
      window.withProgress<void>({ title: params.title, cancellable: params.cancellable }, async (progress, cancellationToken) => {
        this._progress = progress
        this._cancellationToken = cancellationToken
        this._cancellationToken.onCancellationRequested(() => {
          this._client.sendNotification(WorkDoneProgressCancelNotification.type, { token: this._token })
        })
        this.report(params)
        return new Promise((resolve, reject) => {
          this._resolve = resolve
          this._reject = reject
        })
      }).catch(err => {
        logger.error('Progress error:', err)
      })
    } else {
      this.report(params)
    }
  }

  private report(params: WorkDoneProgressReport | WorkDoneProgressBegin): void {
    if (this._progressTarget === 'float') {
      let delta = 0
      if (params.percentage) {
        const current = Math.max(0, Math.min(params.percentage, 100))
        delta = Math.max(0, current - this._reported)
        this._reported = current
      }
      this._progress?.report({ message: params.message, increment: delta })
    } else {
      let statusBarItem = this._statusBarItem
      let parts: string[] = []
      if (this.title) parts.push(this.title)
      if (params.percentage) parts.push(params.percentage.toFixed(0) + '%')
      if (params.message) parts.push(params.message)
      statusBarItem.text = parts.join(' ')
      statusBarItem.show()
    }
  }

  public cancel(): void {
    if (this._cancelled) return
    this._cancelled = true
    disposeAll(this._disposables)
    if (progressParts.has(this._token)) {
      progressParts.delete(this._token)
    }
    if (this._resolve) {
      this._resolve()
      this._resolve = undefined
      this._reject = undefined
    }
    if (this._reject) {
      this._reject()
      this._resolve = undefined
      this._reject = undefined
    }
  }

  public done(message?: string): void {
    if (message && this._progressTarget === 'statusline') {
      const statusBarItem = this._statusBarItem
      statusBarItem.text = `${this.title} ${message}`
    }
    setTimeout(() => {
      this.cancel()
    }, 500)
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
