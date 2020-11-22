const logger = require('./logger')('extensions')

export default function logError(promise: Promise<unknown>): void {
    promise.catch(e => {
        logger.error(e)
    })
}
