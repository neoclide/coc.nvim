"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const logger = require('./util/logger')('input');
class Input {
    /**
     * constructor
     *
     * @public
     * @param {string} input - user input for complete
     * @param {string} word - selected complete item
     */
    constructor(input, word) {
        this.word = word;
        let positions = [];
        let index = 0;
        for (let i = 0, l = input.length; i < l; i++) {
            let ch = input[i];
            while (index < word.length) {
                if (word[index].toLowerCase() == ch.toLowerCase()) {
                    positions.push(index);
                    break;
                }
                index++;
            }
        }
        this.input = input;
        this.positions = positions;
    }
    removeCharactor() {
        let { word, input } = this;
        if (!input.length)
            return true;
        let { positions } = this;
        if (positions.length) {
            positions.pop();
            this.input = this.input.slice(0, -1);
            this.word = word.slice(0, -1);
        }
        if (positions.length == 0)
            return true;
    }
    addCharactor(c) {
        this.input = this.input + c;
        this.word = this.word + c;
        this.positions.push(this.word.length - 1);
    }
    isEmpty() {
        return this.positions.length == 0;
    }
}
exports.default = Input;
//# sourceMappingURL=input.js.map