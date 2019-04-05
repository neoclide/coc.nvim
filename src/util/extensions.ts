const logger = require('./logger')('extensions')

// tslint:disable-next-line:interface-name
declare interface Promise<T> {
  /**
   * Catches task error and ignores them.
   */
  logError(): void
}

/**
 * Explicitly tells that promise should be run asynchonously.
 */
Promise.prototype.logError = function <T>(this: Promise<T>): void {
  // tslint:disable-next-line:no-empty
  this.catch(e => {
    logger.error(e)
  })
}
