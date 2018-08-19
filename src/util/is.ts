const toString = Object.prototype.toString
const hasOwnProperty = Object.prototype.hasOwnProperty

export function defined(value: any): boolean {
  return typeof value !== 'undefined'
}

export function undefined(value: any): boolean {
  return typeof value === 'undefined'
}

export function boolean(value: any): value is boolean {
  return value === true || value === false
}

export function string(value: any): value is string {
  return toString.call(value) === '[object String]'
}

export function number(value: any): value is number {
  return toString.call(value) === '[object Number]'
}

export function array(array: any): array is any[] {
  return Array.isArray(array)
}

export function func(value: any): value is Function {
  return toString.call(value) === '[object Function]'
}

export function objectLiteral(obj: any): obj is object {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    !Array.isArray(obj) &&
    !(obj instanceof RegExp) &&
    !(obj instanceof Date)
  )
}

export function emptyObject(obj: any): boolean {
  if (!objectLiteral(obj)) {
    return false
  }

  for (let key in obj) {
    if (hasOwnProperty.call(obj, key)) {
      return false
    }
  }

  return true
}

export function typedArray<T>(
  value: any,
  check: (value: any) => boolean
): value is T[] {
  return Array.isArray(value) && (value as any).every(check)
}

export function thenable<T>(value: any): value is Thenable<T> {
  return value && func(value.then)
}
