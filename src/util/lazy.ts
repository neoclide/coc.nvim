export class Lazy<T> {
  private val: T
  public constructor(private expr: () => T) { }
  public value(): T {
    if(!this.val) {
      this.val = this.expr()
    }
    return this.val
  }
}
