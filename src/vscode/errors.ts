const logger = require('../util/logger')('vscode-errors')
const canceledName = 'Canceled'

/**
 * Checks if the given error is a promise in canceled state
 */
export function isPromiseCanceledError(error: any): boolean {
  return error instanceof Error && error.name === canceledName && error.message === canceledName
}

export function onUnexpectedError(e: any): undefined {
  // ignore errors from cancelled promises
  if (!isPromiseCanceledError(e)) {
    logger.error(e.stack)
  }
  return undefined
}
