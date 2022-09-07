/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { TextEdit as ITextEdit } from 'vscode-languageserver-protocol'
import { illegalArgument } from '../util/errors'
import { Position } from './position'
import { Range } from './range'

export enum EndOfLine {
  LF = 1,
  CRLF = 2
}

export enum EnvironmentVariableMutatorType {
  Replace = 1,
  Append = 2,
  Prepend = 3
}

export class TextEdit implements ITextEdit {
  public static isTextEdit(thing: any): thing is TextEdit {
    if (thing instanceof TextEdit) {
      return true
    }
    if (!thing) {
      return false
    }
    return Range.isRange((thing as TextEdit))
      && typeof (thing as TextEdit).newText === 'string'
  }

  public static replace(range: Range, newText: string): TextEdit {
    return new TextEdit(range, newText)
  }

  public static insert(position: Position, newText: string): TextEdit {
    return TextEdit.replace(new Range(position, position), newText)
  }

  public static delete(range: Range): TextEdit {
    return TextEdit.replace(range, '')
  }

  /**
   * Creates a delete text edit.
   *
   * @param range The range of text to be deleted.
   * @deprecated use `TextEdit.delete(range)` instead.
   */
  public static del(range: Range): ITextEdit {
    return new TextEdit(range, null)
  }

  /**
   * @deprecated use `TextEdit.isTextEdit(value)` instead.
   */
  public static is(value: any): value is ITextEdit {
    return ITextEdit.is(value)
  }

  public static setEndOfLine(eol: EndOfLine): TextEdit {
    const ret = new TextEdit(new Range(new Position(0, 0), new Position(0, 0)), '')
    ret.newEol = eol
    return ret
  }

  protected _range: Range
  protected _newText: string | null
  protected _newEol?: EndOfLine

  public get range(): Range {
    return this._range
  }

  public set range(value: Range) {
    if (value && !Range.isRange(value)) {
      throw illegalArgument('range')
    }
    this._range = value
  }

  public get newText(): string {
    return this._newText || ''
  }

  public set newText(value: string) {
    if (value && typeof value !== 'string') {
      throw illegalArgument('newText')
    }
    this._newText = value
  }

  public get newEol(): EndOfLine | undefined {
    return this._newEol
  }

  public set newEol(value: EndOfLine | undefined) {
    if (value && typeof value !== 'number') {
      throw illegalArgument('newEol')
    }
    this._newEol = value
  }

  constructor(range: Range, newText: string | null) {
    this._range = range
    this._newText = newText
  }

  public toJSON(): any {
    return {
      range: this.range,
      newText: this.newText,
      newEol: this._newEol
    }
  }
}
