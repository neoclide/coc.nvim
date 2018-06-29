
export interface ITask<T> {
  (): T // tslint:disable-line
}

export class Delayer<T> {
  public defaultDelay: number
  private timeout: NodeJS.Timer | undefined
  private completionPromise: Promise<T> | undefined
  private onSuccess: ((value?: T | Thenable<T>) => void) | undefined
  private task: ITask<T> | undefined

  constructor(defaultDelay: number) {
    this.defaultDelay = defaultDelay
    this.timeout = undefined
    this.completionPromise = undefined
    this.onSuccess = undefined
    this.task = undefined
  }

  public trigger(
    task: ITask<T>,
    delay: number = this.defaultDelay
  ): Promise<T> {
    this.task = task
    if (delay >= 0) {
      this.cancelTimeout()
    }

    if (!this.completionPromise) {
      this.completionPromise = new Promise<T>(resolve => {
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
      this.timeout = setTimeout(() => {
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
    return this.timeout !== void 0
  }

  public cancel(): void {
    this.cancelTimeout()
    this.completionPromise = undefined
  }

  private cancelTimeout(): void {
    if (this.timeout !== void 0) {
      clearTimeout(this.timeout)
      this.timeout = undefined
    }
  }
}
