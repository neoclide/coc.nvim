"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Node {
    constructor(element) {
        this.element = element;
    }
}
class LinkedList {
    isEmpty() {
        return !this._first;
    }
    clear() {
        this._first = undefined;
        this._last = undefined;
    }
    unshift(element) {
        return this.insert(element, false);
    }
    push(element) {
        return this.insert(element, true);
    }
    insert(element, atTheEnd) {
        const newNode = new Node(element);
        if (!this._first) {
            this._first = newNode;
            this._last = newNode;
        }
        else if (atTheEnd) {
            // push
            const oldLast = this._last;
            this._last = newNode;
            newNode.prev = oldLast;
            oldLast.next = newNode;
        }
        else {
            // unshift
            const oldFirst = this._first;
            this._first = newNode;
            newNode.next = oldFirst;
            oldFirst.prev = newNode;
        }
        return () => {
            for (let candidate = this._first; candidate instanceof Node; candidate = candidate.next) {
                if (candidate !== newNode) {
                    continue;
                }
                if (candidate.prev && candidate.next) {
                    // middle
                    let anchor = candidate.prev;
                    anchor.next = candidate.next;
                    candidate.next.prev = anchor;
                }
                else if (!candidate.prev && !candidate.next) {
                    // only node
                    this._first = undefined;
                    this._last = undefined;
                }
                else if (!candidate.next) {
                    // last
                    this._last = this._last.prev;
                    this._last.next = undefined;
                }
                else if (!candidate.prev) {
                    // first
                    this._first = this._first.next;
                    this._first.prev = undefined;
                }
                // done
                break;
            }
        };
    }
    iterator() {
        let element = {
            done: undefined,
            value: undefined
        };
        let node = this._first;
        return {
            next() {
                if (!node) {
                    element.done = true;
                    element.value = undefined;
                }
                else {
                    element.done = false;
                    element.value = node.element;
                    node = node.next;
                }
                return element;
            }
        };
    }
    toArray() {
        let result = [];
        for (let node = this._first; node instanceof Node; node = node.next) {
            result.push(node.element);
        }
        return result;
    }
}
exports.LinkedList = LinkedList;
//# sourceMappingURL=linkedList.js.map