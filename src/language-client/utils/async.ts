'use strict'
import { Disposable, RAL } from '../../util/protocol'

export interface ITask<T> {
  (): T
}

export class Delayer<T> {

  public defaultDelay: number
  private timeout: Disposable | undefined
  private completionPromise: Promise<T> | undefined
  private onSuccess: ((value: T | Promise<T> | undefined) => void) | undefined
  private task: ITask<T> | undefined

  constructor(defaultDelay: number) {
    this.defaultDelay = defaultDelay
    this.timeout = undefined
    this.completionPromise = undefined
    this.onSuccess = undefined
    this.task = undefined
  }

  public trigger(task: ITask<T>, delay: number = this.defaultDelay): Promise<T> {
    this.task = task
    if (delay >= 0) {
      this.cancelTimeout()
    }

    if (!this.completionPromise) {
      this.completionPromise = new Promise<T | undefined>(resolve => {
        this.onSuccess = resolve
      }).then(() => {
        this.completionPromise = undefined
        this.onSuccess = undefined
        let result = this.task!()
        this.task = undefined
        return result
      })
    }

    if (delay >= 0 || this.timeout === void 0) {
      this.timeout = RAL().timer.setTimeout(() => {
        this.timeout = undefined
        this.onSuccess!(undefined)
      }, delay >= 0 ? delay : this.defaultDelay)
    }

    return this.completionPromise
  }

  public forceDelivery(): T | undefined {
    if (!this.completionPromise) {
      return undefined
    }
    this.cancelTimeout()
    let result: T = this.task!()
    this.completionPromise = undefined
    this.onSuccess = undefined
    this.task = undefined
    return result
  }

  public isTriggered(): boolean {
    return this.timeout !== undefined
  }

  public cancel(): void {
    this.cancelTimeout()
    this.completionPromise = undefined
  }

  public dispose(): void {
    this.cancelTimeout()
  }

  private cancelTimeout(): void {
    if (this.timeout !== undefined) {
      this.timeout.dispose()
      this.timeout = undefined
    }
  }
}
