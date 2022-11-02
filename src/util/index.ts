'use strict'
import { CancellationToken, Disposable } from 'vscode-languageserver-protocol'

export const CONFIG_FILE_NAME = 'coc-settings.json'

export function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve(undefined)
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(undefined)
    }, ms)
  })
}

export function waitNextTick(): Promise<void> {
  return new Promise(resolve => {
    process.nextTick(() => {
      resolve(undefined)
    })
  })
}

export function waitImmediate(): Promise<void> {
  return new Promise(resolve => {
    setImmediate(() => {
      resolve(undefined)
    })
  })
}

export function delay(func: () => void, defaultDelay: number): ((ms?: number) => void) & { clear: () => void } {
  let timer: NodeJS.Timer
  let fn = (ms?: number) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      func()
    }, ms ?? defaultDelay)
  }
  Object.defineProperty(fn, 'clear', {
    get: () => {
      return () => {
        clearTimeout(timer)
      }
    }
  })
  return fn as any
}

export function concurrent<T>(arr: ReadonlyArray<T>, fn: (val: T) => Promise<void>, limit = 3, token?: CancellationToken): Promise<void> {
  if (arr.length == 0) return Promise.resolve()
  let finished = 0
  let total = arr.length
  let curr = 0
  return new Promise(resolve => {
    let run = (val): void => {
      if (token && token.isCancellationRequested) return resolve()
      let cb = () => {
        finished = finished + 1
        if (finished == total) {
          resolve()
        } else if (curr < total - 1) {
          curr++
          run(arr[curr])
        }
      }
      fn(val).then(cb, cb)
    }
    curr = Math.min(limit, total) - 1
    for (let i = 0; i <= curr; i++) {
      run(arr[i])
    }
  })
}

export function disposeAll(disposables: Disposable[]): void {
  while (disposables.length) {
    const item = disposables.pop()
    item?.dispose()
  }
}
