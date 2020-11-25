/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from '../util/charCode'
import { Range } from 'vscode-languageserver-protocol'
import { TextDocument } from 'vscode-languageserver-textdocument'
const logger = require('../util/logger')('snippets-parser')

export const enum TokenType {
  Dollar,
  Colon,
  Comma,
  CurlyOpen,
  CurlyClose,
  Backslash,
  Forwardslash,
  Pipe,
  Int,
  VariableName,
  Format,
  Plus,
  Dash,
  QuestionMark,
  EOF
}

export interface Token {
  type: TokenType
  pos: number
  len: number
}

export class Scanner {

  private static _table: { [ch: number]: TokenType } = {
    [CharCode.DollarSign]: TokenType.Dollar,
    [CharCode.Colon]: TokenType.Colon,
    [CharCode.Comma]: TokenType.Comma,
    [CharCode.OpenCurlyBrace]: TokenType.CurlyOpen,
    [CharCode.CloseCurlyBrace]: TokenType.CurlyClose,
    [CharCode.Backslash]: TokenType.Backslash,
    [CharCode.Slash]: TokenType.Forwardslash,
    [CharCode.Pipe]: TokenType.Pipe,
    [CharCode.Plus]: TokenType.Plus,
    [CharCode.Dash]: TokenType.Dash,
    [CharCode.QuestionMark]: TokenType.QuestionMark,
  }

  public static isDigitCharacter(ch: number): boolean {
    return ch >= CharCode.Digit0 && ch <= CharCode.Digit9
  }

  public static isVariableCharacter(ch: number): boolean {
    return ch === CharCode.Underline
      || (ch >= CharCode.a && ch <= CharCode.z)
      || (ch >= CharCode.A && ch <= CharCode.Z)
  }

  public value: string
  public pos: number

  constructor() {
    this.text('')
  }

  public text(value: string): void {
    this.value = value
    this.pos = 0
  }

  public tokenText(token: Token): string {
    return this.value.substr(token.pos, token.len)
  }

  public next(): Token {

    if (this.pos >= this.value.length) {
      return { type: TokenType.EOF, pos: this.pos, len: 0 }
    }

    let pos = this.pos
    let len = 0
    let ch = this.value.charCodeAt(pos)
    let type: TokenType

    // static types
    type = Scanner._table[ch]
    if (typeof type === 'number') {
      this.pos += 1
      return { type, pos, len: 1 }
    }

    // number
    if (Scanner.isDigitCharacter(ch)) {
      type = TokenType.Int
      do {
        len += 1
        ch = this.value.charCodeAt(pos + len)
      } while (Scanner.isDigitCharacter(ch))

      this.pos += len
      return { type, pos, len }
    }

    // variable name
    if (Scanner.isVariableCharacter(ch)) {
      type = TokenType.VariableName
      do {
        ch = this.value.charCodeAt(pos + (++len))
      } while (Scanner.isVariableCharacter(ch) || Scanner.isDigitCharacter(ch))

      this.pos += len
      return { type, pos, len }
    }

    // format
    type = TokenType.Format
    do {
      len += 1
      ch = this.value.charCodeAt(pos + len)
    } while (
      !isNaN(ch)
      && typeof Scanner._table[ch] === 'undefined' // not static token
      && !Scanner.isDigitCharacter(ch) // not number
      && !Scanner.isVariableCharacter(ch) // not variable
    )

    this.pos += len
    return { type, pos, len }
  }
}

export abstract class Marker {

  public readonly _markerBrand: any

  public parent: Marker
  protected _children: Marker[] = []

  public appendChild(child: Marker): this {
    if (child instanceof Text && this._children[this._children.length - 1] instanceof Text) {
      // this and previous child are text -> merge them
      (this._children[this._children.length - 1] as Text).value += child.value
    } else {
      // normal adoption of child
      child.parent = this
      this._children.push(child)
    }
    return this
  }

  public setOnlyChild(child: Marker): void {
    child.parent = this
    this._children = [child]
  }

  public replace(child: Marker, others: Marker[]): void {
    const { parent } = child
    const idx = parent.children.indexOf(child)
    const newChildren = parent.children.slice(0)
    newChildren.splice(idx, 1, ...others)
    parent._children = newChildren
      ; (function _fixParent(children: Marker[], parent: Marker): void {
        for (const child of children) {
          child.parent = parent
          _fixParent(child.children, child)
        }
      })(others, parent)
  }

  public get children(): Marker[] {
    return this._children
  }

  public get snippet(): TextmateSnippet | undefined {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let candidate: Marker = this
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (!candidate) {
        return undefined
      }
      if (candidate instanceof TextmateSnippet) {
        return candidate
      }
      candidate = candidate.parent
    }
  }

  public toString(): string {
    return this.children.reduce((prev, cur) => prev + cur.toString(), '')
  }

  public abstract toTextmateString(): string

  public len(): number {
    return 0
  }

  public get next(): Marker | null {
    let { parent } = this
    let { children } = parent
    let idx = children.indexOf(this)
    return children[idx + 1]
  }

  public abstract clone(): Marker
}

export class Text extends Marker {

  public static escape(value: string): string {
    return value.replace(/\$|}|\\/g, '\\$&')
  }

  constructor(public value: string) {
    super()
  }
  public toString(): string {
    return this.value
  }

  public toTextmateString(): string {
    return Text.escape(this.value)
  }
  public len(): number {
    return this.value.length
  }
  public clone(): Text {
    return new Text(this.value)
  }
}

export abstract class TransformableMarker extends Marker {
  public transform: Transform
}

export class Placeholder extends TransformableMarker {
  public static compareByIndex(a: Placeholder, b: Placeholder): number {
    if (a.index === b.index) {
      return 0
    } else if (a.isFinalTabstop) {
      return 1
    } else if (b.isFinalTabstop) {
      return -1
    } else if (a.index < b.index) {
      return -1
    } else if (a.index > b.index) {
      return 1
    } else {
      return 0
    }
  }

  constructor(public index: number) {
    super()
  }

  public get isFinalTabstop(): boolean {
    return this.index === 0
  }

  public get choice(): Choice | undefined {
    return this._children.length === 1 && this._children[0] instanceof Choice
      ? this._children[0] as Choice
      : undefined
  }

  public toTextmateString(): string {
    let transformString = ''
    if (this.transform) {
      transformString = this.transform.toTextmateString()
    }
    if (this.children.length === 0 && !this.transform) {
      return `$${this.index}`
    } else if (this.children.length === 0) {
      return `\${${this.index}${transformString}}`
    } else if (this.choice) {
      return `\${${this.index}|${this.choice.toTextmateString()}|${transformString}}`
    } else {
      return `\${${this.index}:${this.children.map(child => child.toTextmateString()).join('')}${transformString}}`
    }
  }

  public clone(): Placeholder {
    let ret = new Placeholder(this.index)
    if (this.transform) {
      ret.transform = this.transform.clone()
    }
    ret._children = this.children.map(child => child.clone())
    return ret
  }
}

export class Choice extends Marker {

  public readonly options: Text[] = []

  public appendChild(marker: Marker): this {
    if (marker instanceof Text) {
      marker.parent = this
      this.options.push(marker)
    }
    return this
  }

  public toString(): string {
    return this.options[0].value
  }

  public toTextmateString(): string {
    return this.options
      .map(option => option.value.replace(/\||,/g, '\\$&'))
      .join(',')
  }

  public len(): number {
    return this.options[0].len()
  }

  public clone(): Choice {
    let ret = new Choice()
    for (let opt of this.options) {
      ret.appendChild(opt as any)
    }
    return ret
  }
}

export class Transform extends Marker {

  public regexp: RegExp

  public resolve(value: string): string {
    let didMatch = false
    let ret = value.replace(this.regexp, (...args) => {
      didMatch = true
      return this._replace(args.slice(0, -2))
    })
    // when the regex didn't match and when the transform has
    // else branches, then run those
    if (!didMatch && this._children.some(child => child instanceof FormatString && Boolean(child.elseValue))) {
      ret = this._replace([])
    }
    return ret
  }

  private _replace(groups: string[]): string {
    let ret = ''
    for (const marker of this._children) {
      if (marker instanceof FormatString) {
        let value = groups[marker.index] || ''
        value = marker.resolve(value)
        ret += value
      } else {
        ret += marker.toString()
      }
    }
    return ret
  }

  public toString(): string {
    return ''
  }

  public toTextmateString(): string {
    return `/${this.regexp.source}/${this.children.map(c => c.toTextmateString())}/${(this.regexp.ignoreCase ? 'i' : '') + (this.regexp.global ? 'g' : '')}`
  }

  public clone(): Transform {
    let ret = new Transform()
    ret.regexp = new RegExp(this.regexp.source, '' + (this.regexp.ignoreCase ? 'i' : '') + (this.regexp.global ? 'g' : ''))
    ret._children = this.children.map(child => child.clone())
    return ret
  }

}

export class FormatString extends Marker {

  constructor(
    public readonly index: number,
    public readonly shorthandName?: string,
    public readonly ifValue?: string,
    public readonly elseValue?: string,
  ) {
    super()
  }

  public resolve(value: string): string {
    if (this.shorthandName === 'upcase') {
      return !value ? '' : value.toLocaleUpperCase()
    } else if (this.shorthandName === 'downcase') {
      return !value ? '' : value.toLocaleLowerCase()
    } else if (this.shorthandName === 'capitalize') {
      return !value ? '' : (value[0].toLocaleUpperCase() + value.substr(1))
    } else if (this.shorthandName === 'pascalcase') {
      return !value ? '' : this._toPascalCase(value)
    } else if (Boolean(value) && typeof this.ifValue === 'string') {
      return this.ifValue
    } else if (!value && typeof this.elseValue === 'string') {
      return this.elseValue
    } else {
      return value || ''
    }
  }

  private _toPascalCase(value: string): string {
    const match = value.match(/[a-z]+/gi)
    if (!match) {
      return value
    }
    return match.map(word => word.charAt(0).toUpperCase()
      + word.substr(1).toLowerCase())
      .join('')
  }

  public toTextmateString(): string {
    let value = '${'
    value += this.index
    if (this.shorthandName) {
      value += `:/${this.shorthandName}`

    } else if (this.ifValue && this.elseValue) {
      value += `:?${this.ifValue}:${this.elseValue}`
    } else if (this.ifValue) {
      value += `:+${this.ifValue}`
    } else if (this.elseValue) {
      value += `:-${this.elseValue}`
    }
    value += '}'
    return value
  }

  public clone(): FormatString {
    let ret = new FormatString(this.index, this.shorthandName, this.ifValue, this.elseValue)
    return ret
  }
}

export class Variable extends TransformableMarker {

  constructor(public name: string) {
    super()
  }

  public async resolve(resolver: VariableResolver): Promise<boolean> {
    let value = await resolver.resolve(this)
    if (value && value.includes('\n')) {
      // get indent from previous texts
      let indent = ''
      this.snippet.walk(m => {
        if (m == this) {
          return false
        }
        if (m instanceof Text) {
          let lines = m.toString().split(/\r?\n/)
          indent = lines[lines.length - 1].match(/^\s*/)[0]
        }
        return true
      })
      let lines = value.split('\n')
      let indents = lines.filter(s => s.length > 0).map(s => s.match(/^\s*/)[0])
      let minIndent = indents.length == 0 ? '' :
        indents.reduce((p, c) => p.length < c.length ? p : c)
      let newLines = lines.map((s, i) => i == 0 || s.length == 0 || !s.startsWith(minIndent) ? s :
        indent + s.slice(minIndent.length))
      value = newLines.join('\n')
    }
    if (this.transform) {
      value = this.transform.resolve(value || '')
    }
    if (value !== undefined) {
      this._children = [new Text(value) as any]
      return true
    }
    return false
  }

  public toTextmateString(): string {
    let transformString = ''
    if (this.transform) {
      transformString = this.transform.toTextmateString()
    }
    if (this.children.length === 0) {
      return `\${${this.name}${transformString}}`
    } else {
      return `\${${this.name}:${this.children.map(child => child.toTextmateString()).join('')}${transformString}}`
    }
  }

  public clone(): Variable {
    const ret = new Variable(this.name)
    if (this.transform) {
      ret.transform = this.transform.clone()
    }
    ret._children = this.children.map(child => child.clone())
    return ret
  }
}

export interface VariableResolver {
  resolve(variable: Variable): Promise<string | undefined>
}

function walk(marker: Marker[], visitor: (marker: Marker) => boolean): void {
  const stack = [...marker]
  while (stack.length > 0) {
    const marker = stack.shift()
    const recurse = visitor(marker)
    if (!recurse) {
      break
    }
    stack.unshift(...marker.children)
  }
}

export class TextmateSnippet extends Marker {

  private _placeholders?: { all: Placeholder[]; last?: Placeholder }
  private _variables?: Variable[]

  public get placeholderInfo(): { all: Placeholder[]; last?: Placeholder } {
    if (!this._placeholders) {
      this._variables = []
      // fill in placeholders
      let all: Placeholder[] = []
      let last: Placeholder | undefined
      this.walk(candidate => {
        if (candidate instanceof Placeholder) {
          all.push(candidate)
          last = !last || last.index < candidate.index ? candidate : last
        } else if (candidate instanceof Variable) {
          let first = candidate.name.charCodeAt(0)
          // not jumpover for uppercase variable.
          if (first < 65 || first > 90) {
            this._variables.push(candidate)
          }
        }
        return true
      })
      this._placeholders = { all, last }
    }
    return this._placeholders
  }

  public get variables(): Variable[] {
    return this._variables
  }

  public get placeholders(): Placeholder[] {
    const { all } = this.placeholderInfo
    return all
  }

  public get maxIndexNumber(): number {
    let { placeholders } = this
    return placeholders.reduce((curr, p) => Math.max(curr, p.index), 0)
  }

  public get minIndexNumber(): number {
    let { placeholders } = this
    let nums = placeholders.map(p => p.index)
    nums.sort((a, b) => a - b)
    if (nums.length > 1 && nums[0] == 0) return nums[1]
    return nums[0] || 0
  }

  public insertSnippet(snippet: string, id: number, range: Range): number {
    let placeholder = this.placeholders[id]
    if (!placeholder) return
    let { index } = placeholder
    const document = TextDocument.create('untitled:/1', 'snippet', 0, placeholder.toString())
    snippet = TextDocument.applyEdits(document, [{ range, newText: snippet }])
    let nested = new SnippetParser().parse(snippet, true)
    let maxIndexAdded = nested.maxIndexNumber + 1
    let indexes: number[] = []
    for (let p of nested.placeholders) {
      if (p.isFinalTabstop) {
        p.index = maxIndexAdded + index
      } else {
        p.index = p.index + index
      }
      indexes.push(p.index)
    }
    this.walk(m => {
      if (m instanceof Placeholder && m.index > index) {
        m.index = m.index + maxIndexAdded
      }
      return true
    })
    this.replace(placeholder, nested.children)
    return Math.min.apply(null, indexes)
  }

  public updatePlaceholder(id: number, val: string): void {
    const placeholder = this.placeholders[id]
    for (let p of this.placeholders) {
      if (p.index == placeholder.index) {
        let child = p.children[0]
        let newText = p.transform ? p.transform.resolve(val) : val
        if (child) {
          p.setOnlyChild(new Text(newText))
        } else {
          p.appendChild(new Text(newText))
        }
      }
    }
    this._placeholders = undefined
  }

  public updateVariable(id: number, val: string): void {
    const find = this.variables[id - this.maxIndexNumber - 1]
    if (find) {
      let variables = this.variables.filter(o => o.name == find.name)
      for (let variable of variables) {
        let newText = variable.transform ? variable.transform.resolve(val) : val
        variable.setOnlyChild(new Text(newText))
      }
    }
  }

  /**
   * newText after update with value
   */
  public getPlaceholderText(id: number, value: string): string {
    const placeholder = this.placeholders[id]
    if (!placeholder) return value
    return placeholder.transform ? placeholder.transform.resolve(value) : value
  }

  public offset(marker: Marker): number {
    let pos = 0
    let found = false
    this.walk(candidate => {
      if (candidate === marker) {
        found = true
        return false
      }
      pos += candidate.len()
      return true
    })

    if (!found) {
      return -1
    }
    return pos
  }

  public fullLen(marker: Marker): number {
    let ret = 0
    walk([marker], marker => {
      ret += marker.len()
      return true
    })
    return ret
  }

  public enclosingPlaceholders(placeholder: Placeholder): Placeholder[] {
    let ret: Placeholder[] = []
    let { parent } = placeholder
    while (parent) {
      if (parent instanceof Placeholder) {
        ret.push(parent)
      }
      parent = parent.parent
    }
    return ret
  }

  public async resolveVariables(resolver: VariableResolver): Promise<void> {
    let items: Variable[] = []
    this.walk(candidate => {
      if (candidate instanceof Variable) {
        items.push(candidate)
      }
      return true
    })
    await Promise.all(items.map(o => o.resolve(resolver)))
  }

  public appendChild(child: Marker): this {
    this._placeholders = undefined
    return super.appendChild(child)
  }

  public replace(child: Marker, others: Marker[]): void {
    this._placeholders = undefined
    return super.replace(child, others)
  }

  public toTextmateString(): string {
    return this.children.reduce((prev, cur) => prev + cur.toTextmateString(), '')
  }

  public clone(): TextmateSnippet {
    let ret = new TextmateSnippet()
    this._children = this.children.map(child => child.clone())
    return ret
  }

  public walk(visitor: (marker: Marker) => boolean): void {
    walk(this.children, visitor)
  }
}

export class SnippetParser {

  public static escape(value: string): string {
    return value.replace(/\$|}|\\/g, '\\$&')
  }

  private _scanner = new Scanner()
  private _token: Token

  public text(value: string): string {
    return this.parse(value).toString()
  }

  public parse(value: string, insertFinalTabstop?: boolean): TextmateSnippet {

    this._scanner.text(value)
    this._token = this._scanner.next()

    const snippet = new TextmateSnippet()
    while (this._parse(snippet)) {
      // nothing
    }

    // fill in values for placeholders. the first placeholder of an index
    // that has a value defines the value for all placeholders with that index
    const placeholderDefaultValues = new Map<number, Marker[]>()
    const incompletePlaceholders: Placeholder[] = []
    snippet.walk(marker => {
      if (marker instanceof Placeholder) {
        if (marker.isFinalTabstop) {
          placeholderDefaultValues.set(0, undefined)
        } else if (!placeholderDefaultValues.has(marker.index) && marker.children.length > 0) {
          placeholderDefaultValues.set(marker.index, marker.children)
        } else {
          incompletePlaceholders.push(marker)
        }
      }
      return true
    })
    for (const placeholder of incompletePlaceholders) {
      if (placeholderDefaultValues.has(placeholder.index)) {
        const clone = new Placeholder(placeholder.index)
        clone.transform = placeholder.transform
        for (const child of placeholderDefaultValues.get(placeholder.index)) {
          let marker = child.clone()
          if (clone.transform) {
            if (marker instanceof Text) {
              marker = new Text(clone.transform.resolve(marker.value))
            } else {
              for (let child of marker.children) {
                if (child instanceof Text) {
                  marker.replace(child, [new Text(clone.transform.resolve(child.value))])
                  break
                }
              }
            }
          }
          clone.appendChild(marker)
        }
        snippet.replace(placeholder, [clone])
      }
    }

    if (!placeholderDefaultValues.has(0) && insertFinalTabstop) {
      // the snippet uses placeholders but has no
      // final tabstop defined -> insert at the end
      snippet.appendChild(new Placeholder(0))
    }

    return snippet
  }

  private _accept(type?: TokenType): boolean
  private _accept(type: TokenType | undefined, value: true): string
  private _accept(type: TokenType, value?: boolean): boolean | string {
    if (type === undefined || this._token.type === type) {
      let ret = !value ? true : this._scanner.tokenText(this._token)
      this._token = this._scanner.next()
      return ret
    }
    return false
  }

  private _backTo(token: Token): false {
    this._scanner.pos = token.pos + token.len
    this._token = token
    return false
  }

  private _until(type: TokenType): false | string {
    if (this._token.type === TokenType.EOF) {
      return false
    }
    let start = this._token
    while (this._token.type !== type) {
      this._token = this._scanner.next()
      if (this._token.type === TokenType.EOF) {
        return false
      }
    }
    let value = this._scanner.value.substring(start.pos, this._token.pos)
    this._token = this._scanner.next()
    return value
  }

  private _parse(marker: Marker): boolean {
    return this._parseEscaped(marker)
      || this._parseTabstopOrVariableName(marker)
      || this._parseComplexPlaceholder(marker)
      || this._parseComplexVariable(marker)
      || this._parseAnything(marker)
  }

  // \$, \\, \} -> just text
  private _parseEscaped(marker: Marker): boolean {
    let value: string
    // eslint-disable-next-line no-cond-assign
    if (value = this._accept(TokenType.Backslash, true)) {
      // saw a backslash, append escaped token or that backslash
      value = this._accept(TokenType.Dollar, true)
        || this._accept(TokenType.CurlyClose, true)
        || this._accept(TokenType.Backslash, true)
        || value

      marker.appendChild(new Text(value))
      return true
    }
    return false
  }

  // $foo -> variable, $1 -> tabstop
  private _parseTabstopOrVariableName(parent: Marker): boolean {
    let value: string
    const token = this._token
    const match = this._accept(TokenType.Dollar)
      && (value = this._accept(TokenType.VariableName, true) || this._accept(TokenType.Int, true))

    if (!match) {
      return this._backTo(token)
    }

    parent.appendChild(/^\d+$/.test(value)
      ? new Placeholder(Number(value))
      : new Variable(value)
    )
    return true
  }

  // ${1:<children>}, ${1} -> placeholder
  private _parseComplexPlaceholder(parent: Marker): boolean {
    let index: string
    const token = this._token
    const match = this._accept(TokenType.Dollar)
      && this._accept(TokenType.CurlyOpen)
      && (index = this._accept(TokenType.Int, true))

    if (!match) {
      return this._backTo(token)
    }

    const placeholder = new Placeholder(Number(index))

    if (this._accept(TokenType.Colon)) {
      // ${1:<children>}
      // eslint-disable-next-line no-constant-condition
      while (true) {

        // ...} -> done
        if (this._accept(TokenType.CurlyClose)) {
          parent.appendChild(placeholder)
          return true
        }

        if (this._parse(placeholder)) {
          continue
        }

        // fallback
        parent.appendChild(new Text('${' + index + ':'))
        placeholder.children.forEach(parent.appendChild, parent)
        return true
      }
    } else if (placeholder.index > 0 && this._accept(TokenType.Pipe)) {
      // ${1|one,two,three|}
      const choice = new Choice()

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (this._parseChoiceElement(choice)) {

          if (this._accept(TokenType.Comma)) {
            // opt, -> more
            continue
          }

          if (this._accept(TokenType.Pipe)) {
            placeholder.appendChild(choice)
            if (this._accept(TokenType.CurlyClose)) {
              // ..|} -> done
              parent.appendChild(placeholder)
              return true
            }
          }
        }

        this._backTo(token)
        return false
      }

    } else if (this._accept(TokenType.Forwardslash)) {
      // ${1/<regex>/<format>/<options>}
      if (this._parseTransform(placeholder)) {
        parent.appendChild(placeholder)
        return true
      }

      this._backTo(token)
      return false

    } else if (this._accept(TokenType.CurlyClose)) {
      // ${1}
      parent.appendChild(placeholder)
      return true

    } else {
      // ${1 <- missing curly or colon
      return this._backTo(token)
    }
  }

  private _parseChoiceElement(parent: Choice): boolean {
    const token = this._token
    const values: string[] = []

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this._token.type === TokenType.Comma || this._token.type === TokenType.Pipe) {
        break
      }
      let value: string
      // eslint-disable-next-line no-cond-assign
      if (value = this._accept(TokenType.Backslash, true)) {
        // \, \|, or \\
        value = this._accept(TokenType.Comma, true)
          || this._accept(TokenType.Pipe, true)
          || this._accept(TokenType.Backslash, true)
          || value
      } else {
        value = this._accept(undefined, true)
      }
      if (!value) {
        // EOF
        this._backTo(token)
        return false
      }
      values.push(value)
    }

    if (values.length === 0) {
      this._backTo(token)
      return false
    }

    parent.appendChild(new Text(values.join('')))
    return true
  }

  // ${foo:<children>}, ${foo} -> variable
  private _parseComplexVariable(parent: Marker): boolean {
    let name: string
    const token = this._token
    const match = this._accept(TokenType.Dollar)
      && this._accept(TokenType.CurlyOpen)
      && (name = this._accept(TokenType.VariableName, true))

    if (!match) {
      return this._backTo(token)
    }

    const variable = new Variable(name)
    if (this._accept(TokenType.Colon)) {
      // ${foo:<children>}
      // eslint-disable-next-line no-constant-condition
      while (true) {

        // ...} -> done
        if (this._accept(TokenType.CurlyClose)) {
          parent.appendChild(variable)
          return true
        }

        if (this._parse(variable)) {
          continue
        }

        // fallback
        parent.appendChild(new Text('${' + name + ':'))
        variable.children.forEach(parent.appendChild, parent)
        return true
      }

    } else if (this._accept(TokenType.Forwardslash)) {
      // ${foo/<regex>/<format>/<options>}
      if (this._parseTransform(variable)) {
        parent.appendChild(variable)
        return true
      }

      this._backTo(token)
      return false

    } else if (this._accept(TokenType.CurlyClose)) {
      // ${foo}
      parent.appendChild(variable)
      return true

    } else {
      // ${foo <- missing curly or colon
      return this._backTo(token)
    }
  }

  private _parseTransform(parent: TransformableMarker): boolean {
    // ...<regex>/<format>/<options>}

    let transform = new Transform()
    let regexValue = ''
    let regexOptions = ''

    // (1) /regex
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this._accept(TokenType.Forwardslash)) {
        break
      }

      let escaped: string
      // eslint-disable-next-line no-cond-assign
      if (escaped = this._accept(TokenType.Backslash, true)) {
        escaped = this._accept(TokenType.Forwardslash, true) || escaped
        regexValue += escaped
        continue
      }

      if (this._token.type !== TokenType.EOF) {
        regexValue += this._accept(undefined, true)
        continue
      }
      return false
    }

    // (2) /format
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this._accept(TokenType.Forwardslash)) {
        break
      }

      let escaped: string
      // eslint-disable-next-line no-cond-assign
      if (escaped = this._accept(TokenType.Backslash, true)) {
        escaped = this._accept(TokenType.Forwardslash, true) || escaped
        transform.appendChild(new Text(escaped))
        continue
      }
      if (this._parseFormatString(transform) || this._parseAnything(transform)) {
        let text = transform.children[0] as Text
        if (text && text.value && text.value.includes('\\n')) {
          text.value = text.value.replace(/\\n/g, '\n')
        }
        continue
      }
      return false
    }

    // (3) /option
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this._accept(TokenType.CurlyClose)) {
        break
      }
      if (this._token.type !== TokenType.EOF) {
        regexOptions += this._accept(undefined, true)
        continue
      }
      return false
    }

    try {
      transform.regexp = new RegExp(regexValue, regexOptions)
    } catch (e) {
      // invalid regexp
      return false
    }

    parent.transform = transform
    return true
  }

  private _parseFormatString(parent: Transform): boolean {

    const token = this._token
    if (!this._accept(TokenType.Dollar)) {
      return false
    }

    let complex = false
    if (this._accept(TokenType.CurlyOpen)) {
      complex = true
    }

    let index = this._accept(TokenType.Int, true)

    if (!index) {
      this._backTo(token)
      return false

    } else if (!complex) {
      // $1
      parent.appendChild(new FormatString(Number(index)))
      return true

    } else if (this._accept(TokenType.CurlyClose)) {
      // ${1}
      parent.appendChild(new FormatString(Number(index)))
      return true

    } else if (!this._accept(TokenType.Colon)) {
      this._backTo(token)
      return false
    }

    if (this._accept(TokenType.Forwardslash)) {
      // ${1:/upcase}
      let shorthand = this._accept(TokenType.VariableName, true)
      if (!shorthand || !this._accept(TokenType.CurlyClose)) {
        this._backTo(token)
        return false
      } else {
        parent.appendChild(new FormatString(Number(index), shorthand))
        return true
      }

    } else if (this._accept(TokenType.Plus)) {
      // ${1:+<if>}
      let ifValue = this._until(TokenType.CurlyClose)
      if (ifValue) {
        parent.appendChild(new FormatString(Number(index), undefined, ifValue, undefined))
        return true
      }

    } else if (this._accept(TokenType.Dash)) {
      // ${2:-<else>}
      let elseValue = this._until(TokenType.CurlyClose)
      if (elseValue) {
        parent.appendChild(new FormatString(Number(index), undefined, undefined, elseValue))
        return true
      }

    } else if (this._accept(TokenType.QuestionMark)) {
      // ${2:?<if>:<else>}
      let ifValue = this._until(TokenType.Colon)
      if (ifValue) {
        let elseValue = this._until(TokenType.CurlyClose)
        if (elseValue) {
          parent.appendChild(new FormatString(Number(index), undefined, ifValue, elseValue))
          return true
        }
      }

    } else {
      // ${1:<else>}
      let elseValue = this._until(TokenType.CurlyClose)
      if (elseValue) {
        parent.appendChild(new FormatString(Number(index), undefined, undefined, elseValue))
        return true
      }
    }

    this._backTo(token)
    return false
  }

  private _parseAnything(marker: Marker): boolean {
    if (this._token.type !== TokenType.EOF) {
      let text = this._scanner.tokenText(this._token)
      marker.appendChild(new Text(text))
      this._accept(undefined)
      return true
    }
    return false
  }
}
