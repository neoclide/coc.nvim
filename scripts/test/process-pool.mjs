'use strict'

/**
 * Runs tasks in a rolling pool. A completed slot is filled immediately; the
 * first infrastructure error stops dispatch and aborts every active task.
 */
export async function runProcessPool(items, concurrency, runTask) {
  if (items.length === 0) return []
  const limit = Math.max(1, Math.min(items.length, Number.isInteger(concurrency) ? concurrency : 1))
  const results = new Array(items.length)
  const active = new Map()
  const abort = new AbortController()
  let next = 0
  let failure

  const launch = index => {
    const task = Promise.resolve()
      .then(() => runTask(items[index], index, abort.signal))
      .then(result => {
        results[index] = result
      })
      .catch(error => {
        if (!failure) {
          failure = error
          abort.abort(error)
        }
      })
      .finally(() => {
        active.delete(index)
      })
    active.set(index, task)
  }

  while (next < items.length && active.size < limit) launch(next++)
  while (active.size > 0) {
    await Promise.race(active.values())
    if (failure) {
      await Promise.allSettled(active.values())
      throw failure
    }
    while (next < items.length && active.size < limit) launch(next++)
  }
  return results
}
