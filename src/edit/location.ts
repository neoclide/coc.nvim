/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Location as ILocation } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { Position } from './position'
import { Range } from './range'

export class Location implements ILocation {
  public static isLocation(thing: any): thing is ILocation {
    if (thing instanceof Location) {
      return true
    }
    if (!thing) {
      return false
    }
    return Range.isRange((thing as Location).range)
    && URI.isUri((thing as Location).uri)
  }

  /**
   * Creates a Location literal.
   *
   * @param uri The location's uri.
   * @param range The location's range.
   * @deprecated use `new Location(uri, range)` instead.
   */
  public static create(uri: string, range: Range): Location {
    return new Location(uri, range)
  }
  /**
   * Checks whether the given literal conforms to the [Location](#Location) interface.
   *
   * @deprecated Use the `Location.isLocation` instead.
   */
  public static is(value: any): value is ILocation {
    return ILocation.is(value)
  }

  public uri: string
  public range!: Range

  constructor(uri: string, rangeOrPosition: Range | Position) {
    this.uri = uri

    if (!rangeOrPosition) {
      // that's OK
    } else if (Range.isRange(rangeOrPosition)) {
      this.range = Range.of(rangeOrPosition)
    } else if (Position.isPosition(rangeOrPosition)) {
      this.range = new Range(rangeOrPosition, rangeOrPosition)
    } else {
      throw new Error('Illegal argument')
    }
  }

  public toJSON(): any {
    return {
      uri: this.uri,
      range: this.range
    }
  }
}
