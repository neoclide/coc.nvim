'use strict'

export function toArray<T>(item: T | T[] | null | undefined): T[] {
  return Array.isArray(item) ? item : item == null ? [] : [item]
}

/**
 * @returns false if the provided object is an array and not empty.
 */
export function isFalsyOrEmpty(obj: any): boolean {
  return !Array.isArray(obj) || obj.length === 0
}

function compareValue(n: number, r: [number, number]): number {
  if (n < r[0]) return 1
  if (n > r[1]) return -1
  return 0
}

/**
 * Check if n in sorted table
 */
export function intable(n: number, table: ReadonlyArray<[number, number]>): boolean {
  // do binary search
  let low = 0
  let high = table.length - 1
  while (low <= high) {
    const mid = ((low + high) / 2) | 0
    const comp = compareValue(n, table[mid])
    if (comp < 0) {
      low = mid + 1
    } else if (comp > 0) {
      high = mid - 1
    } else {
      return true
    }
  }
  return false
}

/**
 * Performs a binary search algorithm over a sorted array.
 *
 * @param array The array being searched.
 * @param key The value we search for.
 * @param comparator A function that takes two array elements and returns zero
 * if they are equal, a negative number if the first element precedes the
 * second one in the sorting order, or a positive number if the second element
 * precedes the first one.
 * @return See {@link binarySearch2}
 */
export function binarySearch<T>(array: ReadonlyArray<T>, key: T, comparator: (op1: T, op2: T) => number): number {
  return binarySearch2(array.length, i => comparator(array[i], key))
}

/**
 * Performs a binary search algorithm over a sorted collection. Useful for cases
 * when we need to perform a binary search over something that isn't actually an
 * array, and converting data to an array would defeat the use of binary search
 * in the first place.
 *
 * @param length The collection length.
 * @param compareToKey A function that takes an index of an element in the
 * collection and returns zero if the value at this index is equal to the
 * search key, a negative number if the value precedes the search key in the
 * sorting order, or a positive number if the search key precedes the value.
 * @return A non-negative index of an element, if found. If not found, the
 * result is -(n+1) (or ~n, using bitwise notation), where n is the index
 * where the key should be inserted to maintain the sorting order.
 */
export function binarySearch2(length: number, compareToKey: (index: number) => number): number {
  let low = 0
  let high = length - 1

  while (low <= high) {
    const mid = ((low + high) / 2) | 0
    const comp = compareToKey(mid)
    if (comp < 0) {
      low = mid + 1
    } else if (comp > 0) {
      high = mid - 1
    } else {
      return mid
    }
  }
  return -(low + 1)
}

export function intersect<T>(array: T[], other: T[]): boolean {
  for (let item of other) {
    if (array.includes(item)) {
      return true
    }
  }
  return false
}

export function findIndex<T>(array: ArrayLike<T>, val: T, start = 0): number {
  let idx = -1
  for (let i = start; i < array.length; i++) {
    if (array[i] === val) {
      idx = i
      break
    }
  }
  return idx
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

export function groupBy<T>(array: T[], fn: (v: T) => boolean): [T[], T[]] {
  let res: [T[], T[]] = [[], []]
  array.forEach(v => {
    if (fn(v)) {
      res[0].push(v)
    } else {
      res[1].push(v)
    }
  })
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

/**
 * Add text to sorted array
 */
export function addSortedArray(text: string, arr: string[]): string[] {
  let idx: number
  for (let i = 0; i < arr.length; i++) {
    let s = arr[i]
    if (text === s) return arr
    if (s > text) {
      idx = i
      break
    }
  }
  if (idx === undefined) {
    arr.push(text)
  } else {
    arr.splice(idx, 0, text)
  }
  return arr
}
