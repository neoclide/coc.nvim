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

export class ProgressPart {
  private disposables: Disposable[] = []
  private statusBarItem: StatusBarItem | undefined
  private _cancelled = false
  private title: string
  private _progress: Progress<{ message?: string; increment?: number }>
  private _cancellationToken: CancellationToken
  private _progressTarget: string

  private _reported = 0
  private _resolve: (() => void) | undefined
  private _reject: ((reason?: any) => void) | undefined

  public constructor(private client: ProgressContext, private token: ProgressToken, done?: (part: ProgressPart) => void) {
    this._progressTarget = workspace.getConfiguration('workspace').get<string>('progressTarget', 'float')
    if (!workspace.env.dialog) {
      this._progressTarget = 'statusline'
    }
    if (this._progressTarget == 'statusline') {
      this.statusBarItem = window.createStatusBarItem(99, { progress: true })
      this.disposables.push(this.statusBarItem)
    }
    this.disposables.push(client.onProgress(WorkDoneProgress.type, this.token, value => {
      switch (value.kind) {
        case 'begin':
          this.begin(value)
          break
        case 'report':
          this.report(value)
          break
        case 'end':
          this.done(value.message)
          done && done(this)
          break
      }
    }))
  }

  public begin(params: WorkDoneProgressBegin): void {
    if (typeof this.title === 'string') return
    this.title = params.title
    if (this._progressTarget === 'float') {
      window.withProgress<void>({ title: params.title, cancellable: params.cancellable }, async (progress, cancellationToken) => {
        this._progress = progress
        this._cancellationToken = cancellationToken
        this._cancellationToken.onCancellationRequested(() => {
          this.client.sendNotification(WorkDoneProgressCancelNotification.type, { token: this.token })
        })
        this.report(params)
        return new Promise((resolve, reject) => {
          this._resolve = resolve
          this._reject = reject
        })
      }).catch(() => {
        // cancelled
      })
    } else {
      this.report(params)
    }
  }

  private report(params: WorkDoneProgressReport | WorkDoneProgressBegin): void {
    if (this._progressTarget === 'float') {
      let delta = 0
      if (typeof params.percentage === 'number') {
        const current = Math.max(0, Math.min(params.percentage, 100))
        delta = Math.max(0, current - this._reported)
        this._reported = current
      }
      this._progress?.report({ message: params.message || '', increment: delta })
    } else {
      let statusBarItem = this.statusBarItem
      let parts: string[] = []
      if (this.title) parts.push(this.title)
      if (typeof params.percentage == 'number') parts.push(params.percentage.toFixed(0) + '%')
      if (params.message) parts.push(params.message)
      statusBarItem.text = parts.join(' ')
      statusBarItem.show()
    }
  }

  public cancel(): void {
    if (this._cancelled) return
    this._cancelled = true
    disposeAll(this.disposables)
    if (this._reject) {
      this._reject()
      this._resolve = undefined
      this._reject = undefined
    }
  }

  public done(message?: string): void {
    if (this._cancelled) return
    if (message && this._progressTarget === 'statusline') {
      const statusBarItem = this.statusBarItem
      statusBarItem.text = `${this.title} ${message}`
      setTimeout(() => {
        this.cancel()
      }, 300)
    } else {
      if (this._resolve) {
        this._resolve()
        this._resolve = undefined
        this._reject = undefined
      }
      this.cancel()
    }
  }
}
