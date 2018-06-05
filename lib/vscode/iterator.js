"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class ArrayIterator {
    constructor(items, start = 0, end = items.length) {
        this.items = items;
        this.start = start;
        this.end = end;
        this.index = start - 1;
    }
    first() {
        this.index = this.start;
        return this.current();
    }
    next() {
        this.index = Math.min(this.index + 1, this.end);
        return this.current();
    }
    current() {
        if (this.index === this.start - 1 || this.index === this.end) {
            return null;
        }
        return this.items[this.index];
    }
}
exports.ArrayIterator = ArrayIterator;
class ArrayNavigator extends ArrayIterator {
    constructor(items, start = 0, end = items.length) {
        super(items, start, end);
    }
    current() {
        return super.current();
    }
    previous() {
        this.index = Math.max(this.index - 1, this.start - 1);
        return this.current();
    }
    first() {
        this.index = this.start;
        return this.current();
    }
    last() {
        this.index = this.end - 1;
        return this.current();
    }
    parent() {
        return null;
    }
}
exports.ArrayNavigator = ArrayNavigator;
class MappedIterator {
    constructor(iterator, fn) {
        this.iterator = iterator;
        this.fn = fn;
        // noop
    }
    next() {
        return this.fn(this.iterator.next());
    }
}
exports.MappedIterator = MappedIterator;
class MappedNavigator extends MappedIterator {
    constructor(navigator, fn) {
        super(navigator, fn);
        this.navigator = navigator;
    }
    current() {
        return this.fn(this.navigator.current());
    }
    previous() {
        return this.fn(this.navigator.previous());
    }
    parent() {
        return this.fn(this.navigator.parent());
    }
    first() {
        return this.fn(this.navigator.first());
    }
    last() {
        return this.fn(this.navigator.last());
    }
    next() {
        return this.fn(this.navigator.next());
    }
}
exports.MappedNavigator = MappedNavigator;
//# sourceMappingURL=iterator.js.map