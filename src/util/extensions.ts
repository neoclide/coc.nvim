const logger = require('./logger')('extensions')

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
  this.catch(e => {
    logger.error(e)
  })
}
