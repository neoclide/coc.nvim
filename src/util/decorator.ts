const logger = require('./logger')('util-decorator')

export function memorize<R extends(...args: any[]) => Promise<R>>(_target: any, key: string, descriptor: any): void {
  let fn = descriptor.value
  if (typeof fn !== 'function') return
  let memoKey = '$' + key

  descriptor.value = function(...args): Promise<R> {
    if (this.hasOwnProperty(memoKey)) return Promise.resolve(this[memoKey])
    return new Promise((resolve, reject): void => {
      Promise.resolve(fn.apply(this, args)).then(res => {
        this[memoKey] = res
        resolve(res)
      }, e => {
        reject(e)
      })
    })
  }
}
