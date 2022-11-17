'use strict'
import type { Disposable, NotificationHandler, ProgressToken, ProgressType, ProtocolNotificationType, WorkDoneProgressBegin, WorkDoneProgressReport } from 'vscode-languageserver-protocol'
import { disposeAll } from '../util'
import { WorkDoneProgress, WorkDoneProgressCancelNotification } from '../util/protocol'
import window from '../window'

export interface Progress {
  report(value: { message?: string; increment?: number }): void
}

export interface ProgressContext {
  readonly id: string
  onProgress<P>(type: ProgressType<P>, token: string | number, handler: NotificationHandler<P>): Disposable
  sendNotification<P, RO>(type: ProtocolNotificationType<P, RO>, params?: P): void
}

export class ProgressPart {
  private disposables: Disposable[] = []
  private _cancelled = false
  private _percent = 0
  private _started = false
  private progress: Progress
  private _resolve: () => void
  private _reject: ((reason?: any) => void) | undefined

  public constructor(private client: ProgressContext, private token: ProgressToken, done?: (part: ProgressPart) => void) {
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

  public begin(params: WorkDoneProgressBegin): boolean {
    if (this._started || this._cancelled) return false
    this._started = true
    void window.withProgress<void>({
      source: `language-client-${this.client.id}`,
      cancellable: params.cancellable,
      title: params.title,
    }, (progress, token) => {
      this.progress = progress
      this.report(params)
      if (this._cancelled) return Promise.resolve()
      this.disposables.push(token.onCancellationRequested(() => {
        this.client.sendNotification(WorkDoneProgressCancelNotification.type, { token: this.token })
        this.cancel()
      }))
      return new Promise((resolve, reject) => {
        this._resolve = resolve
        this._reject = reject
      })
    })
    return true
  }

  public report(params: WorkDoneProgressReport | WorkDoneProgressBegin): void {
    if (!this.progress) return
    let msg: { message?: string, increment?: number } = {}
    if (params.message) msg.message = params.message
    if (validPercent(params.percentage)) {
      msg.increment = params.percentage - this._percent
      this._percent = params.percentage
    }
    if (Object.keys(msg).length > 0) {
      this.progress.report(msg)
    }
  }

  public cancel(): void {
    if (this._cancelled) return
    this.cleanUp()
    if (this._reject !== undefined) {
      this._reject()
      this._resolve = undefined
      this._reject = undefined
    }
  }

  public done(message?: string): void {
    if (this.progress) {
      let msg: { message?: string, increment?: number } = {}
      if (message) msg.message = message
      if (typeof this._percent === 'number' && this._percent > 0) msg.increment = 100 - this._percent
      this.progress.report(msg)
    }
    this.cleanUp()
    if (this._resolve) {
      this._resolve()
      this._resolve = undefined
      this._reject = undefined
    }
  }

  private cleanUp(): void {
    this._cancelled = true
    this.progress = undefined
    disposeAll(this.disposables)
  }
}

function validPercent(n: unknown): boolean {
  if (typeof n !== 'number') return false
  return n >= 0 && n <= 100
}
