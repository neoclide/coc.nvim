
export function intersect<T>(array: T[], other: T[]): boolean {
  for (let item of other) {
    if (array.includes(item)) {
      return true
    }
  }
  return false
}

export function splitArray<T>(array: T[], fn: (item: T) => boolean): [T[], T[]] {
  let res: [T[], T[]] = [[], []]
  for (let item of array) {
    if (fn(item)) {
      res[0].push(item)
    } else {
      res[1].push(item)
    }
  }
  return res
}

export function tail<T>(array: T[], n = 0): T {
  return array[array.length - (1 + n)]
}

export function group<T>(array: T[], size: number): T[][] {
  let len = array.length
  let res: T[][] = []
  for (let i = 0; i < Math.ceil(len / size); i++) {
    res.push(array.slice(i * size, (i + 1) * size))
  }
  return res
}

/**
 * Removes duplicates from the given array. The optional keyFn allows to specify
 * how elements are checked for equalness by returning a unique string for each.
 */
export function distinct<T>(array: T[], keyFn?: (t: T) => string): T[] {
  if (!keyFn) {
    return array.filter((element, position) => array.indexOf(element) === position)
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

export const flatMap = <T, U>(xs: T[], f: (item: T) => U[]): U[] =>
  xs.reduce((x: U[], y: T) => [...x, ...f(y)], [])
