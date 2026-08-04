'use strict'
import { createLogger } from './logger'
import mcp from './mcp'
import services from './services'
const logger = createLogger('exit')

// Best-effort budget for stopping language servers on SIGTERM/SIGINT.
export const EXIT_TIMEOUT = 1000

export type ExitFunction = (code?: number) => never

let exitFn: ExitFunction = code => process.exit(code)

/**
 * Replace the function used to exit the process, mainly for tests to
 * observe the exit without terminating the test process.
 */
export function setExitHook(fn: ExitFunction): void {
  exitFn = fn
}

/**
 * Best-effort graceful shutdown: stop all language servers (LSP
 * shutdown/exit) before exiting, so server processes are not orphaned
 * when the editor restarts or terminates coc.
 */
export function gracefulExit(signal: string): void {
  logger.info(`Received ${signal}, stopping language servers`)
  mcp.stop()
  let timer = setTimeout(() => exitFn(0), EXIT_TIMEOUT)
  void services.stopAll(EXIT_TIMEOUT).finally(() => {
    clearTimeout(timer)
    exitFn(0)
  })
}

/**
 * Register SIGTERM/SIGINT handlers for the coc service process.
 */
export function registerExitHandlers(): void {
  let exiting = false
  const handler = (signal: string): void => {
    if (exiting) return
    exiting = true
    gracefulExit(signal)
  }
  process.on('SIGTERM', () => handler('SIGTERM'))
  process.on('SIGINT', () => handler('SIGINT'))
}
