/*tslint:disable*/
import { Disposable } from 'vscode-languageserver-protocol'

export interface Task<T> {
  (): T
}

/**
 * A helper to delay execution of a task that is being requested often.
 *
 * Following the throttler, now imagine the mail man wants to optimize the number of
 * trips proactively. The trip itself can be long, so he decides not to make the trip
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
 * 		const delayer = new Delayer(WAITING_PERIOD)
 * 		const letters = []
 *
 * 		function letterReceived(l) {
 * 			letters.push(l)
 * 			delayer.trigger(() => { return makeTheTrip(); })
 * 		}
 */
export class Delayer<T> implements Disposable {

  private timeout: any
  private completionPromise: Thenable<any> | null
  private doResolve: ((value?: any | Thenable<any>) => void) | null
  private doReject: (err: any) => void
  private task: Task<T | Thenable<T>> | null

  constructor(public defaultDelay: number) {
    this.timeout = null
    this.completionPromise = null
    this.doResolve = null
    this.task = null
  }

  trigger(task: Task<T | Thenable<T>>, delay: number = this.defaultDelay): Thenable<T> {
    this.task = task
    this.cancelTimeout()

    if (!this.completionPromise) {
      this.completionPromise = new Promise((c, e) => {
        this.doResolve = c
        this.doReject = e
      }).then(() => {
        this.completionPromise = null
        this.doResolve = null
        const task = this.task!
        this.task = null

        return task()
      })
    }

    this.timeout = setTimeout(() => {
      this.timeout = null
      this.doResolve!(null)
    }, delay)

    return this.completionPromise
  }

  isTriggered(): boolean {
    return this.timeout !== null
  }

  cancel(): void {
    this.cancelTimeout()

    if (this.completionPromise) {
      this.doReject(new Error('Canceled'))
      this.completionPromise = null
    }
  }

  private cancelTimeout(): void {
    if (this.timeout !== null) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
  }

  dispose(): void {
    this.cancelTimeout()
  }
}
