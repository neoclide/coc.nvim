
export class Sequence {
  private _busy = false
  private _fns: (() => Promise<void>)[] = []
  private _resolves: (() => void)[] = []

  public run(fn: () => Promise<void>): void {
    if (!this._busy) {
      this._busy = true
      fn().finally(() => {
        this.next()
      })
    } else {
      this._fns.push(fn)
    }
  }

  public waitFinish(): Promise<void> {
    if (!this._busy) return Promise.resolve()
    return new Promise(resolve => {
      this._resolves.push(resolve)
    })
  }

  private next(): void {
    let fn = this._fns.shift()
    if (!fn) {
      this.finish()
    } else {
      fn().finally(() => {
        this.next()
      })
    }
  }

  private finish(): void {
    this._busy = false
    let fn: () => void
    while ((fn = this._resolves.pop()) != null) {
      fn()
    }
  }

  public cancel(): void {
    this._fns = []
    this.finish()
  }
}
