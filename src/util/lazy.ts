export class Lazy<T> {
  private val: T
  private computed: boolean
  public constructor(private expr: () => T) {
    this.computed = false
  }
  public invalidate(): void {
    this.computed = false
  }
  public value(): T {
    if(!this.computed) {
      this.val = this.expr()
      this.computed = true
    }
    return this.val
  }
}
