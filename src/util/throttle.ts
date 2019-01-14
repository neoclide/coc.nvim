
/**
 * Returns a new function that, when invoked, invokes `func` at most once per `wait` milliseconds.
 *
 * @param {Function} func Function to wrap.
 * @param {Number} wait Number of milliseconds that must elapse between `func` invocations.
 * @return {Function} A new function that wraps the `func` function passed in.
 */

export default function throttle(func: Function, wait: number): Function & { clear(): void; } {
  let args, rtn, timeoutID; // caching
  let last = 0

  function fn() {
    args = arguments
    let delta = Date.now() - last
    if (!timeoutID)
      if (last != 0 && delta >= wait) call()
      else timeoutID = setTimeout(call, wait - delta)
    return rtn
  }

  function call() {
    timeoutID = 0
    last = +new Date()
    rtn = func.apply(null, args)
    args = null
  }

  fn.clear = () => {
    if (timeoutID) {
      clearTimeout(timeoutID)
    }
  }
  return fn
}
