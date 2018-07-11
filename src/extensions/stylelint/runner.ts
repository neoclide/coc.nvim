/*tslint:disable:no-console*/
import {ErrorCodes, ResponseError} from 'vscode-languageserver'
import {CancellationToken} from 'vscode-languageserver-protocol'

export function formatError(message: string, err: any): string {
  if (err instanceof Error) {
    let error = err as Error
    return `${message}: ${error.message}\n${error.stack}`
  } else if (typeof err === 'string') {
    return `${message}: ${err}`
  } else if (err) {
    return `${message}: ${err.toString()}`
  }
  return message
}

export function runSafe<T, E>(
  func: () => T,
  errorVal: T,
  errorMessage: string,
  token: CancellationToken
): Thenable<T | ResponseError<E>> {
  return new Promise<T | ResponseError<E>>(resolve => {
    setImmediate(() => {
      if (token.isCancellationRequested) {
        resolve(cancelValue())
      } else {
        try {
          let result = func()
          if (token.isCancellationRequested) {
            resolve(cancelValue())
            return
          } else {
            resolve(result)
          }
        } catch (e) {
          console.error(formatError(errorMessage, e))
          resolve(errorVal)
        }
      }
    })
  })
}

function cancelValue<E>(): any {
  return new ResponseError<E>(ErrorCodes.RequestCancelled, 'Request cancelled')
}
