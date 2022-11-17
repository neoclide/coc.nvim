'use strict'

declare interface Promise<T> {
  /**
   * Catches task error and ignores them.
   */
  logError(): void
}

Promise.prototype.logError = function <T>(this: Promise<T>): void {
  this.catch(_e => {
    // noop
  })
}
