import { IIterator } from './iterator'

class Node<E> {
  public element: E
  public next: Node<E>
  public prev: Node<E>

  constructor(element: E) {
    this.element = element
  }
}

export class LinkedList<E> {
  private _first: Node<E>
  private _last: Node<E>

  public isEmpty(): boolean {
    return !this._first
  }

  public clear(): void {
    this._first = undefined
    this._last = undefined
  }

  public unshift(element: E) { // tslint:disable-line
    return this.insert(element, false)
  }

  public push(element: E) { // tslint:disable-line
    return this.insert(element, true)
  }

  private insert(element: E, atTheEnd: boolean) { // tslint:disable-line
    const newNode = new Node(element)
    if (!this._first) {
      this._first = newNode
      this._last = newNode
    } else if (atTheEnd) {
      // push
      const oldLast = this._last
      this._last = newNode
      newNode.prev = oldLast
      oldLast.next = newNode
    } else {
      // unshift
      const oldFirst = this._first
      this._first = newNode
      newNode.next = oldFirst
      oldFirst.prev = newNode
    }

    return () => {
      for (
        let candidate = this._first;
        candidate instanceof Node;
        candidate = candidate.next
      ) {
        if (candidate !== newNode) {
          continue
        }
        if (candidate.prev && candidate.next) {
          // middle
          let anchor = candidate.prev
          anchor.next = candidate.next
          candidate.next.prev = anchor
        } else if (!candidate.prev && !candidate.next) {
          // only node
          this._first = undefined
          this._last = undefined
        } else if (!candidate.next) {
          // last
          this._last = this._last.prev
          this._last.next = undefined
        } else if (!candidate.prev) {
          // first
          this._first = this._first.next
          this._first.prev = undefined
        }

        // done
        break
      }
    }
  }

  public iterator(): IIterator<E> {
    let element = {
      done: undefined,
      value: undefined
    }
    let node = this._first
    return {
      next(): { done: boolean; value: E } {
        if (!node) {
          element.done = true
          element.value = undefined
        } else {
          element.done = false
          element.value = node.element
          node = node.next
        }
        return element
      }
    }
  }

  public toArray(): E[] {
    let result: E[] = []
    for (let node = this._first; node instanceof Node; node = node.next) {
      result.push(node.element)
    }
    return result
  }
}
