/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

import { Disposable, NotificationHandler, NotificationType, ProgressToken, ProgressType, ProtocolNotificationType, WorkDoneProgress, WorkDoneProgressBegin, WorkDoneProgressReport } from 'vscode-languageserver-protocol'
import { StatusBarItem } from '../types'
import { disposeAll } from '../util'
import window from '../window'
const logger = require('../util/logger')('language-client-progressPart')

export interface ProgressContext {
  onProgress<P>(type: ProgressType<P>, token: string | number, handler: NotificationHandler<P>): Disposable
  sendNotification<P, RO>(type: ProtocolNotificationType<P, RO>, params?: P): void
}

export class ProgressPart {
  private disposables: Disposable[] = []
  private statusBarItem: StatusBarItem | undefined
  private _cancelled = false
  private title: string

  public constructor(private client: ProgressContext, private token: ProgressToken, done?: (part: ProgressPart) => void) {
    this.statusBarItem = window.createStatusBarItem(99, { progress: true })
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
    // TODO support  params.cancellable
    this.title = params.title
    this.report(params)
  }

  private report(params: WorkDoneProgressReport | WorkDoneProgressBegin): void {
    let statusBarItem = this.statusBarItem
    let parts: string[] = []
    if (this.title) parts.push(this.title)
    if (typeof params.percentage == 'number') parts.push(params.percentage.toFixed(0) + '%')
    if (params.message) parts.push(params.message)
    statusBarItem.text = parts.join(' ')
    statusBarItem.show()
  }

  public cancel(): void {
    if (this._cancelled) return
    this._cancelled = true
    disposeAll(this.disposables)
  }

  public done(message?: string): void {
    if (this._cancelled) return
    const statusBarItem = this.statusBarItem
    statusBarItem.text = `${this.title} ${message || 'finished'}`
    setTimeout(() => {
      statusBarItem.dispose()
    }, 300)
    this.cancel()
  }
}
