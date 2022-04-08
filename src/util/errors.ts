'use strict'

export function illegalArgument(name?: string): Error {
  if (name) {
    return new Error(`Illegal argument: ${name}`)
  } else {
    return new Error('Illegal argument')
  }
}
