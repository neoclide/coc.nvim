
export function tail<T>(array: T[], n = 0): T {
  return array[array.length - (1 + n)]
}

export function equals<T>(
  one: T[],
  other: T[],
  itemEquals: (a: T, b: T) => boolean = (a, b) => a === b
): boolean {
  if (one.length !== other.length) {
    return false
  }

  for (let i = 0, len = one.length; i < len; i++) {
    if (!itemEquals(one[i], other[i])) {
      return false
    }
  }

  return true
}

/**
 * Removes duplicates from the given array. The optional keyFn allows to specify
 * how elements are checked for equalness by returning a unique string for each.
 */
export function distinct<T>(array: T[], keyFn?: (t: T) => string): T[] {
  if (!keyFn) {
    return array.filter((element, position) => {
      return array.indexOf(element) === position
    })
  }

  const seen: { [key: string]: boolean } = Object.create(null)
  return array.filter(elem => {
    const key = keyFn(elem)
    if (seen[key]) {
      return false
    }

    seen[key] = true

    return true
  })
}

export function lastIndex<T>(array: T[], fn: (t: T) => boolean): number {
  let i = array.length - 1
  while (i >= 0) {
    if (fn(array[i])) {
      break
    }
    i--
  }
  return i
}
