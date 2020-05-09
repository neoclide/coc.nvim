
/**
 * Returns a new function that, when invoked, invokes `func` at most once per `wait` milliseconds.
 *
 * @param {Function} func Function to wrap.
 * @param {Number} wait Number of milliseconds that must elapse between `func` invocations.
 * @return {Function} A new function that wraps the `func` function passed in.
 */

export default function throttle(func: Function, wait: number): Function & { clear(): void } {
  let args
  let rtn
  let timeoutID
  let last = 0

  function fn(): any {
    args = arguments
    let delta = Date.now() - last
    if (!timeoutID) {
      if (last != 0 && delta >= wait) {
        call()
      } else {
        timeoutID = setTimeout(call, wait - delta)
      }
    }
    return rtn
  }

  function call(): any {
    timeoutID = 0
    last = Date.now()
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
