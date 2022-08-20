'use strict'

const canceledName = 'Canceled'

// !!!IMPORTANT!!!
// Do NOT change this class because it is also used as an API-type.
export class CancellationError extends Error {
  constructor() {
    super(canceledName)
    this.name = this.message
  }
}

/**
 * Checks if the given error is a promise in canceled state
 */
export function isCancellationError(error: any): boolean {
  if (error instanceof CancellationError) {
    return true
  }
  return error instanceof Error && error.name === canceledName && error.message === canceledName
}

export function onUnexpectedError(e: any): void {
  // ignore errors from cancelled promises
  if (isCancellationError(e)) return
  if (e.stack) {
    throw new Error(e.message + '\n\n' + e.stack)
  }
  throw e
}

export function illegalArgument(name?: string): Error {
  if (name) {
    return new Error(`Illegal argument: ${name}`)
  } else {
    return new Error('Illegal argument')
  }
}

export function directoryNotExists(dir: string): Error {
  return new Error(`Directory ${dir} not exists`)
}

export function fileExists(filepath: string) {
  return new Error(`File ${filepath} already exists`)
}

export function fileNotExists(filepath: string) {
  return new Error(`File ${filepath} not exists`)
}

export function shouldNotAsync(method: string) {
  return new Error(`${method} should not be called in an asynchronize manner`)
}

export function badScheme(scheme: string) {
  return new Error(`Change of ${scheme} not supported`)
}
