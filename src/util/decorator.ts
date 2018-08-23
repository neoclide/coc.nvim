
export function memoize(_target: any, key: string, descriptor: any): void {
  let fnKey: string
  let fn: Function

  if (typeof descriptor.value === 'function') {
    fnKey = 'value'
    fn = descriptor.value
  } else if (typeof descriptor.get === 'function') {
    fnKey = 'get'
    fn = descriptor.get
  } else {
    throw new Error('not supported')
  }

  const memoizeKey = `$memoize$${key}`

  descriptor[fnKey] = function(...args: any[]): any {
    if (!this.hasOwnProperty(memoizeKey)) {
      Object.defineProperty(this, memoizeKey, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: fn!.apply(this, args)
      })
    }

    return this[memoizeKey]
  }
}
