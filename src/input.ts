const logger = require('./util/logger')('input')

export default class Input {
  public input: string
  public word: string
  public positions: number[]

  /**
   * constructor
   *
   * @public
   * @param {string} input - user input for complete
   * @param {string} word - selected complete item
   */
  constructor(input: string, word: string) {
    this.word = word
    let positions = []
    let index = 0
    for (let i = 0, l = input.length; i < l; i++) {
      let ch = input[i]
      while (index < word.length) {
        if (word[index].toLowerCase() == ch.toLowerCase()) {
          positions.push(index)
          break
        }
        index++
      }
    }
    this.input = input
    this.positions = positions
  }

  public removeCharactor():boolean {
    let {word, input} = this
    if (!input.length) return true
    let {positions} = this
    if (positions.length) {
      positions.pop()
      this.input = this.input.slice(0, -1)
      this.word = word.slice(0, -1)
    }
    if (positions.length == 0) return true
  }

  public addCharactor(c: string):void {
    this.input = this.input + c
    this.word = this.word + c
    this.positions.push(this.word.length - 1)
  }

  public isEmpty():boolean {
    return this.positions.length == 0
  }
}
