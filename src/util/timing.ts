'use strict'
import { createLogger } from '../logger'
const logger = createLogger('timing')

interface Timing {
  start(label?: string): void
  stop(): void
}

/**
 * Trace the duration and show error on timeout
 */
export function createTiming(name: string, timeout?: number): Timing {
  let start: number
  let timer: NodeJS.Timer
  let _label: string
  return {
    start(label?: string) {
      _label = label
      start = Date.now()
      clearTimeout(timer)
      if (timeout) {
        timer = setTimeout(() => {
          logger.error(`${name} timeout after ${timeout}ms`)
        }, timeout)
        timer.unref()
      }
    },
    stop() {
      clearTimeout(timer)
      logger.trace(`${name}${_label ? ` ${_label}` : ''} cost:`, Date.now() - start)
    }
  }
}
