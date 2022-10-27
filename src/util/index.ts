'use strict'
interface Disposable {
  dispose(): void
}

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

export function concurrent<T>(arr: T[], fn: (val: T) => Promise<void>, limit = 3): Promise<void> {
  if (arr.length == 0) return Promise.resolve()
  let finished = 0
  let total = arr.length
  let remain = arr.slice()
  return new Promise(resolve => {
    let run = (val): void => {
      let cb = () => {
        finished = finished + 1
        if (finished == total) {
          resolve()
        } else if (remain.length) {
          let next = remain.shift()
          run(next)
        }
      }
      fn(val).then(cb, cb)
    }
    for (let i = 0; i < Math.min(limit, remain.length); i++) {
      let val = remain.shift()
      run(val)
    }
  })
}

export function disposeAll(disposables: Disposable[]): void {
  while (disposables.length) {
    const item = disposables.pop()
    item?.dispose()
  }
}
