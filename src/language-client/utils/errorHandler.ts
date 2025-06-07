'use strict'
import type { InitializeError, Message, ResponseError } from 'vscode-languageserver-protocol'
import { OutputChannel } from '../../types'

/**
 * An action to be performed when the connection to a server got closed.
 */
export enum CloseAction {
  /**
   * Don't restart the server. The connection stays closed.
   */
  DoNotRestart = 1,
  /**
   * Restart the server.
   */
  Restart = 2
}

export interface CloseHandlerResult {
  /**
   * The action to take.
   */
  action: CloseAction

  /**
   * An optional message to be presented to the user.
   */
  message?: string

  /**
   * If set to true the client assumes that the corresponding
   * close handler has presented an appropriate message to the
   * user and the message will only be log to the client's
   * output channel.
   */
  handled?: boolean
}

/**
 * An action to be performed when the connection is producing errors.
 */
export enum ErrorAction {
  /**
   * Continue running the server.
   */
  Continue = 1,
  /**
   * Shutdown the server.
   */
  Shutdown = 2
}

export interface ErrorHandlerResult {
  /**
   * The action to take.
   */
  action: ErrorAction

  /**
   * An optional message to be presented to the user.
   */
  message?: string

  /**
   * If set to true the client assumes that the corresponding
   * error handler has presented an appropriate message to the
   * user and the message will only be log to the client's
   * output channel.
   */
  handled?: boolean
}

/**
 * A pluggable error handler that is invoked when the connection is either
 * producing errors or got closed.
 */
export interface ErrorHandler {
  /**
   * An error has occurred while writing or reading from the connection.
   * @param error - the error received
   * @param message - the message to be delivered to the server if know.
   * @param count - a count indicating how often an error is received. Will
   * be reset if a message got successfully send or received.
   */
  error(error: Error, message: Message | undefined, count: number | undefined): ErrorAction | ErrorHandlerResult | Promise<ErrorHandlerResult>

  /**
   * The connection to the server got closed.
   */
  closed(): CloseHandlerResult | Promise<CloseHandlerResult> | CloseAction
}

export function toCloseHandlerResult(result: CloseHandlerResult | CloseAction): CloseHandlerResult {
  if (typeof result === 'number') return { action: result }
  return result
}

export interface InitializationFailedHandler {
  (error: ResponseError<InitializeError> | Error | any): boolean
}

export class DefaultErrorHandler implements ErrorHandler {
  private readonly restarts: number[]
  public milliseconds = 3 * 60 * 1000

  constructor(private name: string, private maxRestartCount: number, private outputChannel?: OutputChannel) {
    this.restarts = []
  }

  public error(_error: Error, _message: Message, count: number): ErrorHandlerResult {
    if (count && count <= 3) {
      return { action: ErrorAction.Continue }
    }
    return { action: ErrorAction.Shutdown }
  }

  public closed(): CloseHandlerResult {
    this.restarts.push(Date.now())
    if (this.restarts.length < this.maxRestartCount) {
      return { action: CloseAction.Restart }
    } else {
      let diff = this.restarts[this.restarts.length - 1] - this.restarts[0]
      if (diff <= this.milliseconds) {
        if (this.outputChannel) this.outputChannel.appendLine(`The server crashed ${this.maxRestartCount + 1} times in the last 3 minutes. The server will not be restarted.`)
        return {
          action: CloseAction.DoNotRestart,
          message: `The "${this.name}" server crashed ${this.maxRestartCount + 1} times in the last 3 minutes. The server will not be restarted.`
        }
      } else {
        this.restarts.shift()
        return { action: CloseAction.Restart }
      }
    }
  }
}
