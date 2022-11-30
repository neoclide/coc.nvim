'use strict'
import * as Is from './is'

export function isEmpty(obj: object | null | undefined): boolean {
  if (!obj) return true
  if (Array.isArray(obj)) return obj.length == 0
  return Object.keys(obj).length == 0
}

export function toObject<T>(obj: T | null | undefined): T | {} {
  return obj == null ? {} : obj
}

export function omitUndefined(obj: object): object {
  const result: any = {}
  Object.entries(obj).forEach(([key, val]) => {
    if (val !== undefined) result[key] = val
  })
  return result
}

export function deepIterate(obj: object, fn: (node: object, key: string) => void): object {
  Object.entries(obj).forEach(([key, val]) => {
    fn(obj, key)
    if (Array.isArray(val)) {
      val.forEach(node => {
        if (Is.objectLiteral(node)) {
          deepIterate(node, fn)
        }
      })
    } else if (Is.objectLiteral(val)) {
      deepIterate(val, fn)
    }
  })
  return obj
}

export function toReadonly<T extends object>(obj: T): T {
  const result = {}
  for (let key of Object.keys(obj)) {
    Object.defineProperty(result, key, {
      value: obj[key],
      writable: false,
      enumerable: true
    })
  }
  return result as T
}

export function deepClone<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') {
    return obj
  }
  if (obj instanceof RegExp) {
    // See https://github.com/Microsoft/TypeScript/issues/10990
    return obj as any
  }
  const result: any = Array.isArray(obj) ? [] : {}
  Object.keys(obj).forEach(key => {
    if (obj[key] && typeof obj[key] === 'object') {
      result[key] = deepClone(obj[key])
    } else {
      result[key] = obj[key]
    }
  })
  return result
}

const _hasOwnProperty = Object.prototype.hasOwnProperty

export function hasOwnProperty(obj: any, key: string): boolean {
  return _hasOwnProperty.call(obj, key)
}

export function deepFreeze<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') {
    return obj
  }
  const stack: any[] = [obj]
  while (stack.length > 0) {
    let obj = stack.shift()
    Object.freeze(obj)
    for (const key of Object.keys(obj)) {
      let prop = obj[key]
      if (typeof prop === 'object' && !Object.isFrozen(prop)) {
        stack.push(prop)
      }
    }
  }
  return obj
}

/**
 * Copies all properties of source into destination. The optional parameter "overwrite" allows to control
 * if existing properties on the destination should be overwritten or not. Defaults to true (overwrite).
 */
export function mixin(
  destination: any,
  source: any,
  overwrite = true
): any {
  if (!Is.objectLiteral(destination)) {
    return source
  }

  if (Is.objectLiteral(source)) {
    Object.keys(source).forEach(key => {
      if (key in destination) {
        if (overwrite) {
          if (Is.objectLiteral(destination[key]) && Is.objectLiteral(source[key])) {
            mixin(destination[key], source[key], overwrite)
          } else {
            destination[key] = source[key]
          }
        }
      } else {
        destination[key] = source[key]
      }
    })
  }
  return destination
}

export function equals(one: any, other: any): boolean {
  if (one === other) {
    return true
  }
  if (
    one === null ||
    one === undefined ||
    other === null ||
    other === undefined
  ) {
    return false
  }
  if (typeof one !== typeof other) {
    return false
  }
  if (typeof one !== 'object') {
    return false
  }
  if (Array.isArray(one) !== Array.isArray(other)) {
    return false
  }

  let i: number
  let key: string

  if (Array.isArray(one)) {
    if (one.length !== other.length) {
      return false
    }
    for (i = 0; i < one.length; i++) {
      if (!equals(one[i], other[i])) {
        return false
      }
    }
  } else {
    const oneKeys: string[] = []

    for (key in one) {
      oneKeys.push(key)
    }
    oneKeys.sort()
    const otherKeys: string[] = []
    for (key in other) {
      otherKeys.push(key)
    }
    otherKeys.sort()
    if (!equals(oneKeys, otherKeys)) {
      return false
    }
    for (i = 0; i < oneKeys.length; i++) {
      if (!equals(one[oneKeys[i]], other[oneKeys[i]])) {
        return false
      }
    }
  }
  return true
}
