export interface IIteratorResult<T> {
  readonly done: boolean
  readonly value: T
}

export interface IIterator<E> {
  next(): IIteratorResult<E>
}

export interface INextIterator<T> {
  next(): T
}

export interface INavigator<T> extends INextIterator<T> {
  current(): T
  previous(): T
  parent(): T
  first(): T
  last(): T
  next(): T
}

export class ArrayIterator<T> implements INextIterator<T> {
  private items: T[]
  protected start: number
  protected end: number
  protected index: number

  constructor(items: T[], start = 0, end = items.length) {
    this.items = items
    this.start = start
    this.end = end
    this.index = start - 1
  }

  public first(): T {
    this.index = this.start
    return this.current()
  }

  public next(): T {
    this.index = Math.min(this.index + 1, this.end)
    return this.current()
  }

  protected current(): T {
    if (this.index === this.start - 1 || this.index === this.end) {
      return null
    }

    return this.items[this.index]
  }
}

export class ArrayNavigator<T> extends ArrayIterator<T>
  implements INavigator<T> {
  constructor(items: T[], start = 0, end = items.length) {
    super(items, start, end)
  }

  public current(): T {
    return super.current()
  }

  public previous(): T {
    this.index = Math.max(this.index - 1, this.start - 1)
    return this.current()
  }

  public first(): T {
    this.index = this.start
    return this.current()
  }

  public last(): T {
    this.index = this.end - 1
    return this.current()
  }

  public parent(): T {
    return null
  }
}

export class MappedIterator<T, R> implements INextIterator<R> {
  constructor(
    protected iterator: INextIterator<T>,
    protected fn: (item: T) => R
  ) {
    // noop
  }

  next() { // tslint:disable-line
    return this.fn(this.iterator.next())
  }
}

export class MappedNavigator<T, R> extends MappedIterator<T, R>
  implements INavigator<R> {
  constructor(protected navigator: INavigator<T>, fn: (item: T) => R) {
    super(navigator, fn)
  }

  current() { // tslint:disable-line
    return this.fn(this.navigator.current())
  }
  previous() { // tslint:disable-line
    return this.fn(this.navigator.previous())
  }
  parent() { // tslint:disable-line
    return this.fn(this.navigator.parent())
  }
  first() { // tslint:disable-line
    return this.fn(this.navigator.first())
  }
  last() { // tslint:disable-line
    return this.fn(this.navigator.last())
  }
  next() { // tslint:disable-line
    return this.fn(this.navigator.next())
  }
}
