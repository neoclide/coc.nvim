import { createLogger } from '../logger/index'
import { toErrorText } from '../util/string'
const logger = createLogger('handler-util')

export function handleError(e: any) {
  logger.error(`Error on handler: `, toErrorText(e))
}
