const toString = Object.prototype.toString

export function boolean(value: any): value is boolean {
  return value === true || value === false
}

export function string(value: any): value is string {
  return toString.call(value) === '[object String]'
}

export function number(value: any): value is number {
  return toString.call(value) === '[object Number]'
}

export function error(value: any): value is Error {
  return toString.call(value) === '[object Error]'
}

export function func(value: any): value is Function {
  return toString.call(value) === '[object Function]'
}

export function array<T>(value: any): value is T[] {
  return Array.isArray(value)
}

export function stringArray(value: any): value is string[] {
  return array(value) && (<any[]>value).every(elem => string(elem))
}

export function typedArray<T>(
  value: any,
  check: (value: any) => boolean
): value is T[] {
  return Array.isArray(value) && (<any[]>value).every(check)
}

export function thenable<T>(value: any): value is Thenable<T> {
  return value && func(value.then)
}
