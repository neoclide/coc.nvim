const logger = require('./logger')('util-decorator')

export function memorize<R extends (...args: any[]) => Promise<R>>(_target: any, key: string, descriptor: any): void {
  let fn = descriptor.get
  if (typeof fn !== 'function') return
  let memoKey = '$' + key

  descriptor.get = function(...args): Promise<R> {
    if (this.hasOwnProperty(memoKey)) return Promise.resolve(this[memoKey])
    return new Promise((resolve, reject): void => { // tslint:disable-line
      Promise.resolve(fn.apply(this, args)).then(res => {
        this[memoKey] = res
        resolve(res)
      }, e => {
        reject(e)
      })
    })
  }
}

// Ensures an asynchronous method is not called concurrently.
// If called while running, it returns a promise for the original call.
// (Only methods without args are supported).
export function combineConcurrent<R extends () => Promise<R>>(_target: any, key: string, descriptor: PropertyDescriptor) : void {
  let fn = descriptor.value
  if (typeof fn !== 'function') return
  // The promise is stored in $foldConcurrent$foo while foo() is running.
  let promiseKey = '$foldConcurrent$' + key

  descriptor.value = function() : Promise<R> {
    if (!this.hasOwnProperty(promiseKey)) {
      // Avoid fn() in promise constructor, in case it returns synchronously.
      let resolve
      this[promiseKey] = new Promise((res, _) => resolve = res)
      resolve((async () => {
        let result = await fn.call(this)
        delete this[promiseKey]
        return result
      })())
    }
    return this[promiseKey]
  }
}
