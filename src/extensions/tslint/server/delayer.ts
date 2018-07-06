/**
 * A helper to delay execution of a task that is being requested often.
 *
 * Following the throttler, now imagine the mail man wants to optimize the number of
 * trips proactively. The trip itself can be long, so the he decides not to make the trip
 * as soon as a letter is submitted. Instead he waits a while, in case more
 * letters are submitted. After said waiting period, if no letters were submitted, he
 * decides to make the trip. Imagine that N more letters were submitted after the first
 * one, all within a short period of time between each other. Even though N+1
 * submissions occurred, only 1 delivery was made.
 *
 * The delayer offers this behavior via the trigger() method, into which both the task
 * to be executed and the waiting period (delay) must be passed in as arguments. Following
 * the example:
 *
 * 		var delayer = new Delayer(WAITING_PERIOD);
 * 		var letters = [];
 *
 * 		function letterReceived(l) {
 * 			letters.push(l);
 * 			delayer.trigger(() => { return makeTheTrip(); });
 * 		}
 */
export type ITask<T> = () => T

export type ValueCallback = (value: any) => any

export class Delayer<T> {
  private timeout: NodeJS.Timer | null
  private completionPromise: Promise<T> | null
  private onSuccess: ValueCallback | null
  private task: ITask<T> | null

  constructor(public defaultDelay: number) {
    this.timeout = null
    this.completionPromise = null
    this.onSuccess = null
    this.task = null
  }

  public trigger(
    task: ITask<T>,
    delay: number = this.defaultDelay
  ): Promise<T> {
    this.task = task
    this.cancelTimeout()

    if (!this.completionPromise) {
      this.completionPromise = new Promise<T>(resolve => {
        this.onSuccess = resolve
      }).then(() => {
        this.completionPromise = null
        this.onSuccess = null
        let result = this.task!()
        this.task = null
        return result
      })
    }

    if (!this.completionPromise) {
      this.completionPromise = new Promise<T>(resolve => {
        this.onSuccess = resolve
      }).then(() => {
        this.completionPromise = null
        this.onSuccess = null
        const task = this.task
        this.task = null
        return task!()
      })
    }

    this.timeout = setTimeout(() => {
      this.timeout = null
      this.onSuccess!(null)
    }, delay)

    return this.completionPromise
  }

  public isTriggered(): boolean {
    return this.timeout !== null
  }

  public cancel(): void {
    this.cancelTimeout()
    this.completionPromise = null
  }
  private cancelTimeout(): void {
    if (this.timeout !== null) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
  }
}
