/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict'

import { Disposable, NotificationHandler, NotificationType, ProgressToken, ProgressType, WorkDoneProgress, WorkDoneProgressBegin, WorkDoneProgressReport } from 'vscode-languageserver-protocol'
import { StatusBarItem } from '../types'
import workspace from '../workspace'

export interface ProgressContext {
  onProgress<P>(type: ProgressType<P>, token: string | number, handler: NotificationHandler<P>): Disposable
  sendNotification<P, RO>(type: NotificationType<P, RO>, params?: P): void
}

const _disposables: Map<ProgressToken, Disposable> = new Map()

export class ProgressPart {
  private _disposable: Disposable | undefined
  private _workDoneStatus: StatusBarItem
  private _title: string
  private _message: string
  private _percentage: string

  public constructor(private _client: ProgressContext, private _token: ProgressToken) {
    if (_disposables.has(_token)) {
      workspace.showMessage(`Progress for token ${_token} already registered`, 'warning')
      return
    }

    this._workDoneStatus = workspace.createStatusBarItem(99, { progress: true })
    this._disposable = this._client.onProgress(WorkDoneProgress.type, this._token, value => {
      switch (value.kind) {
        case 'begin':
          this.begin(value)
          break
        case 'report':
          this.report(value)
          break
        case 'end':
          this.done()
          break
      }
    })
    _disposables.set(_token, this._disposable)
  }

  private begin(params: WorkDoneProgressBegin): void {
    // TODO: WorkDoneProgressCancelNotification
    this._title = params.title

    this.report(params)
  }

	private report(params: WorkDoneProgressReport | WorkDoneProgressBegin): void {
		this._message = params.message ? params.message : ''
		this._percentage = params.percentage ? params.percentage.toFixed(0) + '%' : ''

		this._workDoneStatus.text = `${this._percentage} ${this._title} ${this._message}`
		this._workDoneStatus.show()
	}

  public cancel(): void {
    _disposables.clear()
    this._disposable?.dispose()
    this._workDoneStatus?.dispose()
  }

  public done(): void {
    this._workDoneStatus?.hide()
  }
}
