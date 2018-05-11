export default class Input {
    input: string;
    word: string;
    positions: number[];
    /**
     * constructor
     *
     * @public
     * @param {string} input - user input for complete
     * @param {string} word - selected complete item
     */
    constructor(input: string, word: string);
    removeCharactor(): boolean;
    addCharactor(c: string): void;
    isEmpty(): boolean;
}
