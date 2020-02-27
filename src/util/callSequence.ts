
export default class CallSequence {
  private funcs: Set<Function> = new Set()
  private _canceled = false
  private _resolved = false
  private promise: Promise<boolean>

  public addFunction(fn: Function): void {
    this.funcs.add(fn)
  }

  public start(): Promise<boolean> {
    this.promise = new Promise<boolean>(async (resolve, reject) => {
      for (let fn of this.funcs) {
        if (this._canceled) return resolve(true)
        try {
          let cancel = await Promise.resolve(fn())
          if (cancel === true) {
            this._canceled = true
            return resolve(true)
          }
        } catch (e) {
          reject(e)
          return
        }
      }
      this._resolved = true
      resolve(false)
    })
    return this.promise
  }

  public ready(): Promise<any> {
    return this.promise
  }

  public cancel(): Promise<any> {
    if (this._resolved) return Promise.resolve(void 0)
    if (this._canceled) return this.promise
    this._canceled = true
    return this.promise
  }
}
