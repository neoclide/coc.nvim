/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Position as IPosition } from 'vscode-languageserver-protocol'
import { illegalArgument } from '../util/errors'

export { IPosition }

export class Position implements IPosition {
  public static Min(...positions: Position[]): Position {
    if (positions.length === 0) {
      throw new TypeError()
    }
    let result = positions[0]
    for (let i = 1; i < positions.length; i++) {
      const p = positions[i]
      if (p.isBefore(result!)) {
        result = p
      }
    }
    return result
  }

  public static Max(...positions: Position[]): Position {
    if (positions.length === 0) {
      throw new TypeError()
    }
    let result = positions[0]
    for (let i = 1; i < positions.length; i++) {
      const p = positions[i]
      if (p.isAfter(result!)) {
        result = p
      }
    }
    return result
  }

  public static isPosition(other: any): other is Position {
    if (!other) {
      return false
    }
    if (other instanceof Position) {
      return true
    }
    let { line, character } = other as Position
    if (typeof line === 'number' && typeof character === 'number') {
      return true
    }
    return false
  }

  public static of(obj: IPosition): Position {
    if (obj instanceof Position) {
      return obj
    } else if (this.isPosition(obj)) {
      return new Position(obj.line, obj.character)
    }
    throw new Error('Invalid argument, is NOT a position-like object')
  }

  /**
   * Creates a new Position literal from the given line and character.
   *
   * @param line The position's line.
   * @param character The position's character.
   */
  public static create(line: number, character: number): Position {
    return new Position(line, character)
  }

  /**
   * Checks whether the given liternal conforms to the [Position](#Position) interface.
   */
  public static is(value: any): value is IPosition {
    return IPosition.is(value)
  }

  private _line: number
  private _character: number

  public get line(): number {
    return this._line
  }

  public get character(): number {
    return this._character
  }

  constructor(line: number, character: number) {
    if (line < 0) {
      throw illegalArgument('line must be non-negative')
    }
    if (character < 0) {
      throw illegalArgument('character must be non-negative')
    }
    this._line = line
    this._character = character
  }

  public isBefore(other: Position): boolean {
    if (this._line < other._line) {
      return true
    }
    if (other._line < this._line) {
      return false
    }
    return this._character < other._character
  }

  public isBeforeOrEqual(other: Position): boolean {
    if (this._line < other._line) {
      return true
    }
    if (other._line < this._line) {
      return false
    }
    return this._character <= other._character
  }

  public isAfter(other: Position): boolean {
    return !this.isBeforeOrEqual(other)
  }

  public isAfterOrEqual(other: Position): boolean {
    return !this.isBefore(other)
  }

  public isEqual(other: Position): boolean {
    return this._line === other._line && this._character === other._character
  }

  public compareTo(other: Position): number {
    if (this._line < other._line) {
      return -1
    } else if (this._line > other.line) {
      return 1
    } else {
      // equal line
      if (this._character < other._character) {
        return -1
      } else if (this._character > other._character) {
        return 1
      } else {
        // equal line and character
        return 0
      }
    }
  }

  public translate(change: { lineDelta?: number; characterDelta?: number }): Position
  public translate(lineDelta?: number, characterDelta?: number): Position
  public translate(lineDeltaOrChange: number | undefined | { lineDelta?: number; characterDelta?: number }, characterDelta = 0): Position {

    if (lineDeltaOrChange === null || characterDelta === null) {
      throw illegalArgument()
    }

    let lineDelta: number
    if (typeof lineDeltaOrChange === 'undefined') {
      lineDelta = 0
    } else if (typeof lineDeltaOrChange === 'number') {
      lineDelta = lineDeltaOrChange
    } else {
      lineDelta = typeof lineDeltaOrChange.lineDelta === 'number' ? lineDeltaOrChange.lineDelta : 0
      characterDelta = typeof lineDeltaOrChange.characterDelta === 'number' ? lineDeltaOrChange.characterDelta : 0
    }

    if (lineDelta === 0 && characterDelta === 0) {
      return this
    }
    return new Position(this.line + lineDelta, this.character + characterDelta)
  }

  public with(change: { line?: number; character?: number }): Position
  public with(line?: number, character?: number): Position
  public with(lineOrChange: number | undefined | { line?: number; character?: number }, character: number = this.character): Position {
    if (lineOrChange === null || character === null) {
      throw illegalArgument()
    }

    let line: number
    if (typeof lineOrChange === 'undefined') {
      line = this.line

    } else if (typeof lineOrChange === 'number') {
      line = lineOrChange

    } else {
      line = typeof lineOrChange.line === 'number' ? lineOrChange.line : this.line
      character = typeof lineOrChange.character === 'number' ? lineOrChange.character : this.character
    }

    if (line === this.line && character === this.character) {
      return this
    }
    return new Position(line, character)
  }

  public toJSON(): any {
    return { line: this.line, character: this.character }
  }
}
