'use strict'
import type { Logger } from 'vscode-languageserver-protocol'
import { createLogger } from '../../logger'
const logger = createLogger('language-client')

export class ConsoleLogger implements Logger {
  public error(message: string): void {
    logger.error(message)
  }
  public warn(message: string): void {
    logger.warn(message)
  }
  public info(message: string): void {
    logger.info(message)
  }
  public log(message: string): void {
    logger.log(message)
  }
}

export class NullLogger implements Logger {
  public error(_message: string): void {
  }
  public warn(_message: string): void {
  }
  public info(_message: string): void {
  }
  public log(_message: string): void {
  }
}
