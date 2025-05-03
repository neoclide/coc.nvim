import { CancellationToken } from '../util/protocol'

const defaultYieldTimeout = 15

function waitImmediate(): Promise<void> {
  return new Promise(resolve => {
    setImmediate(() => {
      resolve(undefined)
    })
  })
}

class Timer {

  private readonly yieldAfter: number
  private startTime: number
  private counter: number
  private total: number
  private counterInterval: number

  constructor(yieldAfter: number = defaultYieldTimeout) {
    this.yieldAfter = Math.max(yieldAfter, defaultYieldTimeout)
    this.startTime = Date.now()
    this.counter = 0
    this.total = 0
    // start with a counter interval of 1.
    this.counterInterval = 1
  }
  public start() {
    this.startTime = Date.now()
  }
  public shouldYield(): boolean {
    if (++this.counter >= this.counterInterval) {
      const timeTaken = Date.now() - this.startTime
      const timeLeft = Math.max(0, this.yieldAfter - timeTaken)
      this.total += this.counter
      this.counter = 0
      if (timeTaken >= this.yieldAfter || timeLeft <= 1) {
        // Yield also if time left <= 1 since we compute the counter
        // for max < 2 ms.

        // Start with interval 1 again. We could do some calculation
        // with using 80% of the last counter however other things (GC)
        // affect the timing heavily since we have small timings (1 - 15ms).
        this.counterInterval = 1
        this.total = 0
        return true
      } else {
        // Only increase the counter until we have spent <= 2 ms. Increasing
        // the counter further is very fragile since timing is influenced
        // by other things and can increase the counter too much. This will result
        // that we yield in average after [14 - 16]ms.
        switch (timeTaken) {
          case 0:
          case 1:
            this.counterInterval = this.total * 2
            break
        }
      }
    }
    return false
  }
}

export async function runSequence(funcs: (() => Promise<void>)[], token: CancellationToken): Promise<void> {
  for (const fn of funcs) {
    if (token.isCancellationRequested) {
      break
    }
    await fn()
  }
}

export interface YieldOptions {
  /**
   * The time in ms after which the function should yield.
   * The minimum yield time is 15ms
   */
  yieldAfter?: number /* ms */

  /**
   * An optional callback that is invoke when the code yields.
   */
  yieldCallback?: () => void
}

export async function map<P, C>(items: ReadonlyArray<P>, func: (item: P) => C, token?: CancellationToken, options?: YieldOptions): Promise<C[]> {
  if (items.length === 0) {
    return []
  }
  const result: C[] = new Array(items.length)
  const timer = new Timer(options?.yieldAfter)
  function convertBatch(start: number): number {
    timer.start()
    for (let i = start; i < items.length; i++) {
      result[i] = func(items[i])
      if (timer.shouldYield()) {
        if (options?.yieldCallback) {
          options.yieldCallback()
        }
        return i + 1
      }
    }
    return -1
  }
  // Convert the first batch sync on the same frame.
  let index = convertBatch(0)
  while (index !== -1) {
    await waitImmediate()
    if (token !== undefined && token.isCancellationRequested) {
      return result
    }
    index = convertBatch(index)
  }
  return result
}

export async function forEach<P>(items: ReadonlyArray<P>, func: (item: P) => void, token?: CancellationToken, options?: YieldOptions): Promise<void> {
  if (items.length === 0) {
    return
  }
  const timer = new Timer(options?.yieldAfter)
  function runBatch(start: number): number {
    timer.start()
    for (let i = start; i < items.length; i++) {
      func(items[i])
      if (timer.shouldYield()) {
        if (options?.yieldCallback) {
          options.yieldCallback()
        }
        return i + 1
      }
    }
    return -1
  }
  // Convert the first batch sync on the same frame.
  let index = runBatch(0)
  while (index !== -1) {
    await waitImmediate()
    if (token !== undefined && token.isCancellationRequested) {
      break
    }
    index = runBatch(index)
  }
}

export async function filter<P>(items: ReadonlyArray<P>, isValid: (item: P) => boolean | { [key: string]: any }, onFilter: (items: (P & { [key: string]: any })[], done: boolean) => void, token?: CancellationToken): Promise<void> {
  if (items.length === 0) return
  const timer = new Timer()
  const len = items.length
  function convertBatch(start: number): number {
    const result: P[] = []
    timer.start()
    for (let i = start; i < len; i++) {
      let item = items[i]
      let res = isValid(item)
      if (res === true) {
        result.push(item)
      } else if (res) {
        result.push(Object.assign({}, item, res))
      }
      if (timer.shouldYield()) {
        let done = i === len - 1
        onFilter(result, done)
        return done ? -1 : i + 1
      }
    }
    onFilter(result, true)
    return -1
  }
  // Convert the first batch sync on the same frame.
  let index = convertBatch(0)
  while (index !== -1) {
    await waitImmediate()
    if (token != null && token.isCancellationRequested) {
      break
    }
    index = convertBatch(index)
  }
}
