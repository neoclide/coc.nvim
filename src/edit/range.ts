/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Range as IRange } from 'vscode-languageserver-protocol'
import { illegalArgument } from '../util/errors'
import { IPosition, Position } from './position'

export class Range implements IRange {
  public static isRange(thing: any): thing is IRange {
    if (thing instanceof Range) {
      return true
    }
    if (!thing) {
      return false
    }
    return Position.isPosition((thing as Range).start)
      && Position.isPosition(thing.end)
  }

  public static of(obj: IRange): Range {
    if (obj instanceof Range) {
      return obj
    }
    if (this.isRange(obj)) {
      return new Range(obj.start, obj.end)
    }
    throw new Error('Invalid argument, is NOT a range-like object')
  }

  /**
   * Create a new Range liternal.
   *
   * @param start The range's start position.
   * @param end The range's end position.
   * @deprecated use `new Range(start, end)` instead.
   */
  public static create(start: Position, end: Position): Range
  /**
   * Create a new Range liternal.
   *
   * @param startLine The start line number.
   * @param startCharacter The start character.
   * @param endLine The end line number.
   * @param endCharacter The end character.
   * @deprecated use `new Range(startLine, startCharacter, endLine, endCharacter)` instead.
   */
  public static create(startLine: number, startCharacter: number, endLine: number, endCharacter: number): Range
  public static create(startLineOrStart: number | Position | IPosition, startColumnOrEnd: number | Position | IPosition, endLine?: number, endColumn?: number): Range {
    return new Range(startLineOrStart as number, startColumnOrEnd as number, endLine, endColumn)
  }

  /**
   * Checks whether the given literal conforms to the [Range](#Range) interface.
   *
   * @deprecated Use the `Range.isRange` instead.
   */
  public is(value: any): value is IRange {
    return IRange.is(value)
  }

  protected _start: Position
  protected _end: Position

  public get start(): Position {
    return this._start
  }

  public get end(): Position {
    return this._end
  }

  constructor(start: IPosition, end: IPosition)
  constructor(start: Position, end: Position)
  constructor(startLine: number, startColumn: number, endLine: number, endColumn: number)
  constructor(startLineOrStart: number | Position | IPosition, startColumnOrEnd: number | Position | IPosition, endLine?: number, endColumn?: number) {
    let start: Position | undefined
    let end: Position | undefined

    if (typeof startLineOrStart === 'number' && typeof startColumnOrEnd === 'number' && typeof endLine === 'number' && typeof endColumn === 'number') {
      start = new Position(startLineOrStart, startColumnOrEnd)
      end = new Position(endLine, endColumn)
    } else if (Position.isPosition(startLineOrStart) && Position.isPosition(startColumnOrEnd)) {
      start = Position.of(startLineOrStart)
      end = Position.of(startColumnOrEnd)
    }

    if (!start || !end) {
      throw new Error('Invalid arguments')
    }

    if (start.isBefore(end)) {
      this._start = start
      this._end = end
    } else {
      this._start = end
      this._end = start
    }
  }

  public contains(positionOrRange: Position | Range): boolean {
    if (Range.isRange(positionOrRange)) {
      return this.contains(positionOrRange.start)
        && this.contains(positionOrRange.end)

    } else if (Position.isPosition(positionOrRange)) {
      if (Position.of(positionOrRange).isBefore(this._start)) {
        return false
      }
      if (this._end.isBefore(positionOrRange)) {
        return false
      }
      return true
    }
    return false
  }

  public isEqual(other: Range): boolean {
    return this._start.isEqual(other._start) && this._end.isEqual(other._end)
  }

  public intersection(other: Range): Range | undefined {
    const start = Position.Max(other.start, this._start)
    const end = Position.Min(other.end, this._end)
    if (start.isAfter(end)) {
      // this happens when there is no overlap:
      // |-----|
      //          |----|
      return undefined
    }
    return new Range(start, end)
  }

  public union(other: Range): Range {
    if (this.contains(other)) {
      return this
    } else if (other.contains(this)) {
      return other
    }
    const start = Position.Min(other.start, this._start)
    const end = Position.Max(other.end, this.end)
    return new Range(start, end)
  }

  public get isEmpty(): boolean {
    return this._start.isEqual(this._end)
  }

  public get isSingleLine(): boolean {
    return this._start.line === this._end.line
  }

  public with(change: { start?: Position; end?: Position }): Range
  public with(start?: Position, end?: Position): Range
  public with(startOrChange: Position | undefined | { start?: Position; end?: Position }, end: Position = this.end): Range {

    if (startOrChange === null || end === null) {
      throw illegalArgument()
    }

    let start: Position
    if (!startOrChange) {
      start = this.start

    } else if (Position.isPosition(startOrChange)) {
      start = startOrChange

    } else {
      start = startOrChange.start || this.start
      end = startOrChange.end || this.end
    }

    if (start.isEqual(this._start) && end.isEqual(this.end)) {
      return this
    }
    return new Range(start, end)
  }

  public toJSON(): any {
    return [this.start, this.end]
  }
}
