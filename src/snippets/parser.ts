'use strict'
import { Neovim } from '@chemzqm/neovim'
import { exec, ExecOptions } from 'child_process'
import { CancellationToken } from 'vscode-languageserver-protocol'
import { createLogger } from '../logger'
import { groupBy } from '../util/array'
import { runSequence } from '../util/async'
import { CharCode } from '../util/charCode'
import { onUnexpectedError } from '../util/errors'
import { promisify, unidecode } from '../util/node'
import { iterateCharacter, toText } from '../util/string'
import { escapeString, EvalKind, executePythonCode, getVariablesCode } from './eval'
import { convertRegex, UltiSnippetContext } from './util'
const logger = createLogger('snippets-parser')
const ULTISNIP_VARIABLES = ['VISUAL', 'YANK', 'UUID']
let id = 0
let snippet_id = 0

const knownRegexOptions = ['d', 'g', 'i', 'm', 's', 'u', 'y']
const ultisnipSpecialEscape = ['u', 'l', 'U', 'L', 'E', 'n', 't']
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
  EOF,
  OpenParen,
  CloseParen,
  BackTick,
  ExclamationMark,
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
    [CharCode.OpenParen]: TokenType.OpenParen,
    [CharCode.CloseParen]: TokenType.CloseParen,
    [CharCode.BackTick]: TokenType.BackTick,
    [CharCode.ExclamationMark]: TokenType.ExclamationMark,
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

  public isEnd(): boolean {
    return this.pos >= this.value.length
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

  public replaceChildren(children: Marker[]): void {
    for (const child of children) {
      child.parent = this
    }
    this._children = children
  }

  public replaceWith(newMarker: Marker): boolean {
    if (!this.parent) return false
    let p = this.parent
    let idx = p.children.indexOf(this)
    if (idx == -1) return false
    newMarker.parent = p
    p.children.splice(idx, 1, newMarker)
    return true
  }

  public insertBefore(text: string): void {
    if (!this.parent) return
    let p = this.parent
    let idx = p.children.indexOf(this)
    if (idx == -1) return
    let prev = p.children[idx - 1]
    if (prev instanceof Text) {
      let v = prev.value
      prev.replaceWith(new Text(v + text))
    } else {
      let marker = new Text(text)
      marker.parent = p
      p.children.splice(idx, 0, marker)
    }
  }

  public get children(): Marker[] {
    return this._children
  }

  public get snippet(): TextmateSnippet | undefined {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let candidate: Marker = this
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

export class CodeBlock extends Marker {

  private _value = ''
  private _related: number[] = []

  constructor(public code: string, public readonly kind: EvalKind, value?: string, related?: number[]) {
    super()
    if (Array.isArray(related)) {
      this._related = related
    } else if (kind === 'python') {
      this._related = CodeBlock.parseRelated(code)
    }
    if (typeof value === 'string') this._value = value
  }

  public static parseRelated(code: string): number[] {
    let list: number[] = []
    let arr
    let re = /\bt\[(\d+)\]/g
    while (true) {
      arr = re.exec(code)
      if (arr == null) break
      let n = parseInt(arr[1], 10)
      if (!list.includes(n)) list.push(n)
    }
    return list
  }

  public get related(): number[] {
    return this._related
  }

  public get index(): number | undefined {
    if (this.parent instanceof Placeholder) {
      return this.parent.index
    }
    return undefined
  }

  public async resolve(nvim: Neovim, token?: CancellationToken): Promise<void> {
    if (!this.code.length) return
    if (token?.isCancellationRequested) return
    let res: string
    if (this.kind == 'python') {
      res = await this.evalPython(nvim, token)
    } else if (this.kind == 'vim') {
      res = await this.evalVim(nvim)
    } else if (this.kind == 'shell') {
      res = await this.evalShell()
    }
    if (token?.isCancellationRequested) return
    if (res != null) this._value = res
  }

  public async evalShell(): Promise<string> {
    let opts: ExecOptions = { windowsHide: true }
    Object.assign(opts, { shell: process.env.SHELL })
    let res = await promisify(exec)(this.code, opts)
    return res.stdout.replace(/\s*$/, '')
  }

  public async evalVim(nvim: Neovim): Promise<string> {
    let res = await nvim.eval(this.code)
    return res == null ? '' : res.toString()
  }

  public async evalPython(nvim: Neovim, token?: CancellationToken): Promise<string> {
    let curr = toText(this._value)
    let lines = [`snip._reset("${escapeString(curr)}")`]
    lines.push(...this.code.split(/\r?\n/).map(line => line.replace(/\t/g, '    ')))
    await executePythonCode(nvim, lines)
    if (token?.isCancellationRequested) return
    return await nvim.call(`pyxeval`, 'str(snip.rv)') as string
  }

  public len(): number {
    return this._value.length
  }

  public toString(): string {
    return this._value
  }

  public get value(): string {
    return this._value
  }

  public toTextmateString(): string {
    let t = ''
    if (this.kind == 'python') {
      t = '!p '
    } else if (this.kind == 'shell') {
      t = ''
    } else if (this.kind == 'vim') {
      t = '!v '
    }
    return '`' + t + (this.code) + '`'
  }

  public clone(): CodeBlock {
    return new CodeBlock(this.code, this.kind, this.value, this._related.slice())
  }
}

abstract class TransformableMarker extends Marker {
  public transform: Transform
}

export class Placeholder extends TransformableMarker {
  public primary = false
  public id: number

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
    } else if (this.children.length === 0 || (this.children.length == 1 && this.children[0].toTextmateString() == '')) {
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
    ret.id = this.id
    ret.primary = this.primary
    ret._children = this.children.map(child => {
      let m = child.clone()
      m.parent = ret
      return m
    })
    return ret
  }

  public checkParentPlaceHolders(): void {
    let idx = this.index
    let p = this.parent
    while (p != null && !(p instanceof TextmateSnippet)) {
      if (p instanceof Placeholder && p.index == idx) {
        throw new Error(`Parent placeholder has same index: ${idx}`)
      }
      p = p.parent
    }
  }
}

export class Choice extends Marker {
  private _index
  constructor(index = 0) {
    super()
    this._index = index
  }
  public readonly options: Text[] = []

  public appendChild(marker: Marker): this {
    if (marker instanceof Text) {
      marker.parent = this
      this.options.push(marker)
    }
    return this
  }

  public toString(): string {
    return this.options[this._index].value
  }

  public toTextmateString(): string {
    return this.options
      .map(option => option.value.replace(/\||,/g, '\\$&'))
      .join(',')
  }

  public len(): number {
    return this.options[this._index].len()
  }

  public clone(): Choice {
    let ret = new Choice(this._index)
    for (let opt of this.options) {
      ret.appendChild(opt)
    }
    return ret
  }
}

export class Transform extends Marker {

  public regexp: RegExp
  public ascii = false
  public ultisnip = false

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
    let backslashIndexes: number[] = []
    for (const marker of this._children) {
      let val = ''
      let len = ret.length
      if (marker instanceof FormatString) {
        val = marker.resolve(groups[marker.index] ?? '')
        if (this.ultisnip && val.indexOf('\\') !== -1) {
          for (let idx of iterateCharacter(val, '\\')) {
            backslashIndexes.push(len + idx)
          }
        }
      } else if (marker instanceof ConditionString) {
        val = marker.resolve(groups[marker.index])
        if (this.ultisnip) {
          val = val.replace(/(?<!\\)\$(\d+)/g, (...args) => {
            return toText(groups[Number(args[1])])
          })
        }
      } else {
        val = marker.toString()
      }

      ret += val
    }
    if (this.ascii) ret = unidecode(ret)
    return this.ultisnip ? transformEscapes(ret, backslashIndexes) : ret
  }

  public toString(): string {
    return ''
  }

  public toTextmateString(): string {
    let format = this.children.map(c => c.toTextmateString()).join('')
    if (this.ultisnip) {
      // avoid bad escape of Text for ultisnip format
      format = format.replace(/\\\\(\w)/g, (match, ch) => {
        if (ultisnipSpecialEscape.includes(ch)) {
          return '\\' + ch
        }
        return match
      })
    }
    return `/${this.regexp.source}/${format}/${(this.regexp.ignoreCase ? 'i' : '') + (this.regexp.global ? 'g' : '')}`
  }

  public clone(): Transform {
    let ret = new Transform()
    ret.regexp = new RegExp(this.regexp.source, '' + (this.regexp.ignoreCase ? 'i' : '') + (this.regexp.global ? 'g' : ''))
    ret._children = this.children.map(child => {
      let m = child.clone()
      m.parent = ret
      return m
    })
    return ret
  }

}

export class ConditionString extends Marker {
  constructor(
    public readonly index: number,
    public readonly ifValue: string,
    public readonly elseValue: string,
  ) {
    super()
  }

  public resolve(value: string): string {
    if (value) return this.ifValue
    return this.elseValue
  }

  public toTextmateString(): string {
    return '(?' + this.index + ':' + this.ifValue + (this.elseValue ? ':' + this.elseValue : '') + ')'
  }

  public clone(): ConditionString {
    return new ConditionString(this.index, this.ifValue, this.elseValue)
  }
}

// TODO ultisnip only, not used yet
export class ConditionMarker extends Marker {
  constructor(
    public readonly index: number,
    protected ifMarkers: Marker[],
    protected elseMarkers: Marker[],
  ) {
    super()
  }

  public resolve(value: string, groups: string[]): string {
    let fn = (p: string, c: Marker): string => {
      return p + (c instanceof FormatString ? c.resolve(groups[c.index]) : c.toString())
    }
    if (value) return this.ifMarkers.reduce(fn, '')
    return this.elseMarkers.reduce(fn, '')
  }

  public addIfMarker(marker: Marker) {
    this.ifMarkers.push(marker)
  }

  public addElseMarker(marker: Marker) {
    this.elseMarkers.push(marker)
  }

  public toTextmateString(): string {
    let ifValue = this.ifMarkers.reduce((p, c) => p + c.toTextmateString(), '')
    let elseValue = this.elseMarkers.reduce((p, c) => p + c.toTextmateString(), '')
    return '(?' + this.index + ':' + ifValue + (elseValue.length > 0 ? ':' + elseValue : '') + ')'
  }

  public clone(): ConditionMarker {
    return new ConditionMarker(this.index, this.ifMarkers.map(m => m.clone()), this.elseMarkers.map(m => m.clone()))
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
  private _resolved: boolean

  constructor(public name: string, resolved = false) {
    super()
    this._resolved = resolved
  }

  public get resolved(): boolean {
    return this._resolved
  }

  public async resolve(resolver: VariableResolver): Promise<boolean> {
    let value = await resolver.resolve(this)
    this._resolved = true
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
      }, true)
      let lines = value.split('\n')
      let indents = lines.filter(s => s.length > 0).map(s => s.match(/^\s*/)[0])
      let minIndent = indents.reduce((p, c) => p < c.length ? p : c.length, 0)
      let newLines = lines.map((s, i) => i == 0 || s.length == 0 || !s.startsWith(' '.repeat(minIndent)) ? s :
        indent + s.slice(minIndent))
      value = newLines.join('\n')
    }
    if (typeof value !== 'string') return false
    if (this.transform) {
      value = this.transform.resolve(toText(value))
    }
    this._children = [new Text(value.toString())]
    return true
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
    const ret = new Variable(this.name, this.resolved)
    if (this.transform) {
      ret.transform = this.transform.clone()
    }
    ret._children = this.children.map(child => {
      let m = child.clone()
      m.parent = ret
      return m
    })
    return ret
  }
}

export interface VariableResolver {
  resolve(variable: Variable): Promise<string | undefined>
}

export interface PlaceholderInfo {
  placeholders: Placeholder[]
  pyBlocks: CodeBlock[]
  otherBlocks: CodeBlock[]
}

function walk(marker: Marker[], visitor: (marker: Marker) => boolean, ignoreChild = false): void {
  const stack = [...marker]
  while (stack.length > 0) {
    const marker = stack.shift()
    if (ignoreChild && marker instanceof TextmateSnippet) continue
    const recurse = visitor(marker)
    if (!recurse) {
      break
    }
    stack.unshift(...marker.children)
  }
}

export class TextmateSnippet extends Marker {

  public readonly ultisnip: boolean
  public readonly id: number
  public readonly related: { codes?: string[], context?: UltiSnippetContext } = {}
  constructor(ultisnip?: boolean, id?: number) {
    super()
    this.ultisnip = ultisnip === true
    this.id = id ?? snippet_id++
  }

  public get hasPythonBlock(): boolean {
    if (!this.ultisnip) return false
    return this.pyBlocks.length > 0
  }

  public get hasCodeBlock(): boolean {
    if (!this.ultisnip) return false
    let { pyBlocks, otherBlocks } = this
    return pyBlocks.length > 0 || otherBlocks.length > 0
  }

  /**
   * Values for each placeholder index
   */
  public get values(): { [index: number]: string } {
    let values: { [index: number]: string } = {}
    let maxIndexNumber = 0
    this.placeholders.forEach(c => {
      if (!Number.isInteger(c.index)) return
      maxIndexNumber = Math.max(c.index, maxIndexNumber)
      if (c.transform != null) return
      if (c.primary || values[c.index] === undefined) values[c.index] = c.toString()
    })
    for (let i = 0; i <= maxIndexNumber; i++) {
      if (values[i] === undefined) values[i] = ''
    }
    return values
  }

  public get orderedPyIndexBlocks(): CodeBlock[] {
    let res: CodeBlock[] = []
    let filtered = this.pyBlocks.filter(o => typeof o.index === 'number')
    if (filtered.length === 0) return res
    let allIndexes = filtered.map(o => o.index)
    let usedIndexes: number[] = []
    const checkBlock = (b: CodeBlock): boolean => {
      let { related } = b
      if (related.length == 0
        || related.every(idx => !allIndexes.includes(idx) || usedIndexes.includes(idx))) {
        usedIndexes.push(b.index)
        res.push(b)
        return true
      }
      return false
    }
    while (filtered.length > 0) {
      let c = false
      for (let b of filtered) {
        if (checkBlock(b)) {
          c = true
        }
      }
      if (!c) {
        // recursive dependencies detected
        break
      }
      filtered = filtered.filter(o => !usedIndexes.includes(o.index))
    }
    return res
  }

  public async evalCodeBlocks(nvim: Neovim, pyCodes: string[]): Promise<void> {
    const { pyBlocks, otherBlocks } = this.placeholderInfo
    // update none python blocks
    await Promise.all(otherBlocks.map(block => {
      let pre = block.value
      return block.resolve(nvim).then(() => {
        if (block.parent instanceof Placeholder && pre !== block.value) {
          // update placeholder with same index
          this.onPlaceholderUpdate(block.parent)
        }
      })
    }))
    if (pyCodes.length === 0) return
    // update normal python block with related.
    let relatedBlocks = pyBlocks.filter(o => o.index === undefined && o.related.length > 0)
    // run all python code by sequence
    const variableCode = getVariablesCode(this.values)
    await executePythonCode(nvim, [...pyCodes, variableCode])
    for (let block of pyBlocks) {
      let pre = block.value
      if (relatedBlocks.includes(block)) continue
      await block.resolve(nvim)
      if (pre === block.value) continue
      if (block.parent instanceof Placeholder) {
        // update placeholder with same index
        this.onPlaceholderUpdate(block.parent)
        await executePythonCode(nvim, [getVariablesCode(this.values)])
      }
    }
    for (let block of this.orderedPyIndexBlocks) {
      await this.updatePyIndexBlock(nvim, block)
    }
    for (let block of relatedBlocks) {
      await block.resolve(nvim)
    }
  }

  /**
   * Update python blocks after user change Placeholder with index
   */
  public async updatePythonCodes(nvim: Neovim, marker: Placeholder, codes: string[], token: CancellationToken): Promise<void> {
    let index = marker.index
    // update related placeholders
    let blocks = this.getDependentPyIndexBlocks(index)
    await runSequence([async () => {
      await executePythonCode(nvim, [...codes, getVariablesCode(this.values)])
    }, async () => {
      for (let block of blocks) {
        await this.updatePyIndexBlock(nvim, block, token)
      }
    }, async () => {
      // update normal pyBlocks.
      let filtered = this.pyBlocks.filter(o => o.index === undefined && o.related.length > 0)
      for (let block of filtered) {
        await block.resolve(nvim, token)
      }
    }], token)
  }

  private getDependentPyIndexBlocks(index: number): CodeBlock[] {
    const res: CodeBlock[] = []
    const taken: number[] = []
    let filtered = this.pyBlocks.filter(o => typeof o.index === 'number')
    const search = (idx: number) => {
      let blocks = filtered.filter(o => !taken.includes(o.index) && o.related.includes(idx))
      if (blocks.length > 0) {
        res.push(...blocks)
        blocks.forEach(b => {
          search(b.index)
        })
      }
    }
    search(index)
    return res
  }

  /**
   * Update single index block
   */
  private async updatePyIndexBlock(nvim: Neovim, block: CodeBlock, token?: CancellationToken): Promise<void> {
    let pre = block.value
    await block.resolve(nvim, token)
    if (pre === block.value || token?.isCancellationRequested) return
    if (block.parent instanceof Placeholder) {
      this.onPlaceholderUpdate(block.parent)
    }
    await executePythonCode(nvim, [getVariablesCode(this.values)])
  }

  public get placeholderInfo(): PlaceholderInfo {
    const pyBlocks: CodeBlock[] = []
    const otherBlocks: CodeBlock[] = []
    // fill in placeholders
    let placeholders: Placeholder[] = []
    this.walk(candidate => {
      if (candidate instanceof Placeholder) {
        placeholders.push(candidate)
      } else if (candidate instanceof CodeBlock) {
        if (candidate.kind === 'python') {
          pyBlocks.push(candidate)
        } else {
          otherBlocks.push(candidate)
        }
      }
      return true
    }, true)
    return { placeholders, pyBlocks, otherBlocks }
  }

  public get variables(): Variable[] {
    const variables = []
    this.walk(candidate => {
      if (candidate instanceof Variable) {
        variables.push(candidate)
      }
      return true
    }, true)
    return variables
  }

  public get placeholders(): Placeholder[] {
    let placeholders: Placeholder[] = []
    this.walk(candidate => {
      if (candidate instanceof Placeholder) {
        placeholders.push(candidate)
      }
      return true
    }, true)
    return placeholders
  }

  public get pyBlocks(): CodeBlock[] {
    return this.placeholderInfo.pyBlocks
  }

  public get otherBlocks(): CodeBlock[] {
    return this.placeholderInfo.otherBlocks
  }

  public get first(): Placeholder {
    let { placeholders } = this
    let [normals, finals] = groupBy(placeholders.filter(p => !p.transform), v => v.index !== 0)
    if (normals.length) {
      let minIndex = Math.min.apply(null, normals.map(o => o.index))
      let arr = normals.filter(v => v.index == minIndex)
      return arr.find(p => p.primary) ?? arr[0]
    }
    return finals.find(o => o.primary) ?? finals[0]
  }

  public async update(nvim: Neovim, marker: Placeholder, token: CancellationToken): Promise<void> {
    this.onPlaceholderUpdate(marker)
    let codes = this.related.codes ?? []
    if (codes.length === 0 || !this.hasPythonBlock) return
    await this.updatePythonCodes(nvim, marker, codes, token)
  }

  /**
   * Reflact changes for related markers.
   */
  public onPlaceholderUpdate(marker: Placeholder): void {
    let val = marker.toString()
    let markers = this.placeholders.filter(o => o.index == marker.index)
    for (let p of markers) {
      p.checkParentPlaceHolders()
      if (p === marker) continue
      let newText = p.transform ? p.transform.resolve(val) : val
      p.setOnlyChild(new Text(toText(newText)))
    }
    this.synchronizeParents(markers)
  }

  public synchronizeParents(markers: Marker[]): void {
    let parents: Set<Placeholder> = new Set()
    markers.forEach(m => {
      let p = m.parent
      if (p instanceof Placeholder) parents.add(p)
    })
    for (let p of parents) {
      this.onPlaceholderUpdate(p)
    }
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
    }, true)

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

  public getTextBefore(marker: Marker, parent: Placeholder): string {
    let res = ''
    const calc = (m: Marker): void => {
      let p = m.parent
      if (!p) return
      let s = ''
      for (let b of p.children) {
        if (b === m) break
        s = s + b.toString()
      }
      res = s + res
      if (p == parent) return
      calc(p)
    }
    calc(marker)
    return res
  }

  public enclosingPlaceholders(placeholder: Placeholder | Variable): Placeholder[] {
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
    let variables = this.variables
    if (variables.length === 0) return
    let failed: Variable[] = []
    let succeed: Variable[] = []
    let promises: Promise<void>[] = []
    const changedParents: Set<Marker> = new Set()
    for (let item of variables) {
      promises.push(item.resolve(resolver).then(res => {
        changedParents.add(item.parent)
        let arr = res ? succeed : failed
        arr.push(item)
      }, onUnexpectedError))
    }
    await Promise.allSettled(promises)
    // convert resolved variables to text
    for (const variable of succeed) {
      let text = new Text(variable.toString())
      variable.replaceWith(text)
    }
    if (failed.length > 0) {
      // convert to placeholders
      let indexMap: Map<string, number> = new Map()
      const primarySet: Set<number> = new Set()
      // create index for variables
      let max = this.getMaxPlaceholderIndex()
      for (let i = 0; i < failed.length; i++) {
        const v = failed[i]
        let idx = indexMap.get(v.name)
        if (idx == null) {
          idx = ++max
          indexMap.set(v.name, idx)
        }
        let p = new Placeholder(idx)
        p.transform = v.transform
        if (!p.transform && !primarySet.has(idx)) {
          primarySet.add(idx)
          p.primary = true
        }
        let newText = p.transform ? p.transform.resolve(v.name) : v.name
        p.setOnlyChild(new Text(toText(newText)))
        v.replaceWith(p)
      }
    }
    changedParents.forEach(marker => {
      mergeTexts(marker)
      if (marker instanceof Placeholder) this.onPlaceholderUpdate(marker)
    })
  }

  public getMaxPlaceholderIndex(): number {
    let res = 0
    this.walk(candidate => {
      if (candidate instanceof Placeholder) {
        res = Math.max(res, candidate.index)
      }
      return true
    }, true)
    return res
  }

  public replace(marker: Marker, children: Marker[]): void {
    marker.replaceChildren(children)
    if (marker instanceof Placeholder) {
      this.onPlaceholderUpdate(marker)
    }
  }

  public toTextmateString(): string {
    return this.children.reduce((prev, cur) => prev + cur.toTextmateString(), '')
  }

  public clone(): TextmateSnippet {
    let ret = new TextmateSnippet(this.ultisnip, this.id)
    ret.related.codes = this.related.codes
    ret.related.context = this.related.context
    ret._children = this.children.map(child => {
      let m = child.clone()
      m.parent = ret
      return m
    })
    return ret
  }

  public walk(visitor: (marker: Marker) => boolean, ignoreChild = false): void {
    walk(this.children, visitor, ignoreChild)
  }
}

export class SnippetParser {
  constructor(private ultisnip?: boolean) {
  }

  public static escape(value: string): string {
    return value.replace(/\$|}|\\/g, '\\$&')
  }

  public static isPlainText(value: string): boolean {
    let s = new SnippetParser().parse(value.replace(/\$0$/, ''), false)
    return s.children.length == 1 && s.children[0] instanceof Text
  }

  private _scanner = new Scanner()
  private _token: Token

  public text(value: string): string {
    return this.parse(value, false).toString()
  }

  public parse(value: string, insertFinalTabstop?: boolean): TextmateSnippet {

    this._scanner.text(value)
    this._token = this._scanner.next()

    const snippet = new TextmateSnippet(this.ultisnip)
    while (this._parse(snippet)) {
      // nothing
    }

    // fill in values for placeholders. the first placeholder of an index
    // that has a value defines the value for all placeholders with that index
    const defaultValues = new Map<number, string>()
    const incompletePlaceholders: Placeholder[] = []
    let complexPlaceholders: Placeholder[] = []
    let hasFinal = false
    snippet.walk(marker => {
      if (marker instanceof Placeholder) {
        if (marker.index == 0) hasFinal = true
        if (marker.children.some(o => o instanceof Placeholder)) {
          marker.primary = true
          complexPlaceholders.push(marker)
        } else if (!defaultValues.has(marker.index) && marker.children.length > 0) {
          marker.primary = true
          defaultValues.set(marker.index, marker.toString())
        } else {
          incompletePlaceholders.push(marker)
        }
      }
      return true
    })

    const complexIndexes = complexPlaceholders.map(p => p.index)
    for (const placeholder of incompletePlaceholders) {
      // avoid transform and replace since no value exists.
      if (defaultValues.has(placeholder.index)) {
        let val = defaultValues.get(placeholder.index)
        let text = new Text(placeholder.transform ? placeholder.transform.resolve(val) : val)
        placeholder.setOnlyChild(text)
      } else if (!complexIndexes.includes(placeholder.index)) {
        if (placeholder.transform) {
          let text = new Text(placeholder.transform.resolve(''))
          placeholder.setOnlyChild(text)
        } else {
          placeholder.primary = true
          defaultValues.set(placeholder.index, '')
        }
      }
    }
    const resolveComplex = () => {
      let resolved: Set<number> = new Set()
      for (let p of complexPlaceholders) {
        if (p.children.every(o => !(o instanceof Placeholder) || defaultValues.has(o.index))) {
          let val = p.toString()
          defaultValues.set(p.index, val)
          for (let placeholder of incompletePlaceholders.filter(o => o.index == p.index)) {
            let text = new Text(placeholder.transform ? placeholder.transform.resolve(val) : val)
            placeholder.setOnlyChild(text)
          }
          resolved.add(p.index)
        }
      }
      complexPlaceholders = complexPlaceholders.filter(p => !resolved.has(p.index))
      if (complexPlaceholders.length == 0 || !resolved.size) return
      resolveComplex()
    }
    resolveComplex()

    if (!hasFinal && insertFinalTabstop) {
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

  private _until(type: TokenType, checkBackSlash = false): false | string {
    if (this._token.type === TokenType.EOF) {
      return false
    }
    let start = this._token
    let pre: Token
    while (this._token.type !== type || (checkBackSlash && pre && pre.type === TokenType.Backslash)) {
      if (checkBackSlash) pre = this._token
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
      || this._parseCodeBlock(marker)
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
        || (this.ultisnip && this._accept(TokenType.CurlyOpen, true))
        || (this.ultisnip && this._accept(TokenType.BackTick, true))
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
    if (/^\d+$/.test(value)) {
      parent.appendChild(new Placeholder(Number(value)))
    } else {
      if (this.ultisnip && !ULTISNIP_VARIABLES.includes(value)) {
        parent.appendChild(new Text('$' + value))
      } else {
        parent.appendChild(new Variable(value))
      }
    }

    return true
  }

  private _checkCulybrace(marker: Marker): boolean {
    let count = 0
    for (marker of marker.children) {
      if (marker instanceof Text) {
        let text = marker.value
        for (let index = 0; index < text.length; index++) {
          const ch = text[index]
          if (ch === '{') {
            count++
          } else if (ch === '}') {
            count--
          }
        }
      }
    }
    return count <= 0
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
      while (true) {
        const lastChar = this._scanner.isEnd()
        // ...} -> done
        if (this._accept(TokenType.CurlyClose)) {
          // we should consider ${1:{}} with text as {}, like ultisnip.
          // check if missed paried }
          if (!this._checkCulybrace(placeholder) && !lastChar) {
            placeholder.appendChild(new Text('}'))
            continue
          }
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
    if (this.ultisnip && !ULTISNIP_VARIABLES.includes(name)) {
      return this._backTo(token)
    }

    const variable = new Variable(name)
    if (this._accept(TokenType.Colon)) {
      // ${foo:<children>}
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
    transform.ultisnip = this.ultisnip === true
    let regexValue = ''
    let regexOptions = ''

    // (1) /regex
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
    while (true) {
      if (this._accept(TokenType.Forwardslash)) {
        break
      }

      let escaped: string
      // eslint-disable-next-line no-cond-assign
      if (escaped = this._accept(TokenType.Backslash, true)) {
        escaped = this._accept(TokenType.Backslash, true) || this._accept(TokenType.Forwardslash, true) || escaped
        transform.appendChild(new Text(escaped))
        continue
      }
      if (this._parseFormatString(transform) || this._parseConditionString(transform) || this._parseAnything(transform)) {
        continue
      }
      return false
    }

    let ascii = false
    // (3) /option
    while (true) {
      if (this._accept(TokenType.CurlyClose)) {
        break
      }
      if (this._token.type !== TokenType.EOF) {
        let c = this._accept(undefined, true)
        if (c == 'a') {
          ascii = true
        } else {
          if (!knownRegexOptions.includes(c)) {
            logger.error(`Unknown regex option: ${c}`)
          }
          regexOptions += c
        }
        continue
      }
      return false
    }

    try {
      if (ascii) transform.ascii = true
      if (this.ultisnip) regexValue = convertRegex(regexValue)
      transform.regexp = new RegExp(regexValue, regexOptions)
    } catch (e) {
      return false
    }

    parent.transform = transform
    return true
  }

  private _parseConditionString(parent: Transform): boolean {
    if (!this.ultisnip) return false
    const token = this._token
    // (?1:foo:bar)
    if (!this._accept(TokenType.OpenParen)) {
      return false
    }
    if (!this._accept(TokenType.QuestionMark)) {
      this._backTo(token)
      return false
    }
    let index = this._accept(TokenType.Int, true)
    if (!index) {
      this._backTo(token)
      return false
    }
    if (!this._accept(TokenType.Colon)) {
      this._backTo(token)
      return false
    }
    let text = this._until(TokenType.CloseParen, true)
    // TODO parse ConditionMarker for ultisnip
    if (text) {
      let i = 0
      while (i < text.length) {
        let t = text[i]
        if (t == ':' && text[i - 1] != '\\') {
          break
        }
        i++
      }
      let ifValue = text.slice(0, i)
      let elseValue = text.slice(i + 1)
      parent.appendChild(new ConditionString(Number(index), ifValue, elseValue))
      return true
    }
    this._backTo(token)
    return false
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
    if (this.ultisnip) {
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
      let elseValue = this._until(TokenType.CurlyClose)
      if (elseValue) {
        parent.appendChild(new FormatString(Number(index), undefined, undefined, elseValue))
        return true
      }
    }

    this._backTo(token)
    return false
  }

  private _parseCodeBlock(parent: Marker): boolean {
    if (!this.ultisnip) return false
    const token = this._token
    if (!this._accept(TokenType.BackTick)) {
      return false
    }
    let text = this._until(TokenType.BackTick, true)
    // `shell code` `!v` `!p`
    if (text) {
      if (!text.startsWith('!')) {
        let marker = new CodeBlock(text.trim(), 'shell')
        parent.appendChild(marker)
        return true
      }
      if (text.startsWith('!v')) {
        let marker = new CodeBlock(text.slice(2).trim(), 'vim')
        parent.appendChild(marker)
        return true
      }
      if (text.startsWith('!p')) {
        let code = text.slice(2)
        if (code.indexOf('\n') == -1) {
          let marker = new CodeBlock(code.trim(), 'python')
          parent.appendChild(marker)
        } else {
          let codes = code.split(/\r?\n/)
          codes = codes.filter(s => !/^\s*$/.test(s))
          if (!codes.length) return true
          // format multi line code
          let ind = codes[0].match(/^\s*/)[0]
          if (ind.length && codes.every(s => s.startsWith(ind))) {
            codes = codes.map(s => s.slice(ind.length))
          }
          if (ind == ' ' && codes[0].startsWith(ind)) codes[0] = codes[0].slice(1)
          let marker = new CodeBlock(codes.join('\n'), 'python')
          parent.appendChild(marker)
        }
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

const escapedCharacters = [':', '(', ')', '{', '}']
// \u \l \U \L \E \n \t
export function transformEscapes(input: string, backslashIndexes = []): string {
  let res = ''
  let len = input.length
  let i = 0
  let toUpper = false
  let toLower = false
  while (i < len) {
    let ch = input[i]
    if (ch.charCodeAt(0) === CharCode.Backslash && !backslashIndexes.includes(i)) {
      let next = input[i + 1]
      if (escapedCharacters.includes(next)) {
        i++
        continue
      }
      if (next == 'u' || next == 'l') {
        // Uppercase/Lowercase next letter
        let follow = input[i + 2]
        if (follow) res = res + (next == 'u' ? follow.toUpperCase() : follow.toLowerCase())
        i = i + 3
        continue
      }
      if (next == 'U' || next == 'L') {
        // Uppercase/Lowercase to \E
        if (next == 'U') {
          toUpper = true
        } else {
          toLower = true
        }
        i = i + 2
        continue
      }
      if (next == 'E') {
        toUpper = false
        toLower = false
        i = i + 2
        continue
      }
      if (next == 'n') {
        res += '\n'
        i = i + 2
        continue
      }
      if (next == 't') {
        res += '\t'
        i = i + 2
        continue
      }
    }
    if (toUpper) {
      ch = ch.toUpperCase()
    } else if (toLower) {
      ch = ch.toLowerCase()
    }
    res += ch
    i++
  }
  return res
}

// merge adjacent Texts of marker's children
export function mergeTexts(marker: Marker, begin = 0): void {
  let { children } = marker
  let end: number | undefined
  let start: number
  for (let i = begin; i < children.length; i++) {
    let m = children[i]
    if (m instanceof Text) {
      if (start !== undefined) {
        end = i
      } else {
        start = i
      }
    } else {
      if (end !== undefined) {
        break
      }
      start = undefined
    }
  }
  if (end === undefined) return
  let newText = ''
  for (let i = start; i <= end; i++) {
    newText += children[i].toString()
  }
  let m = new Text(newText)
  children.splice(start, end - start + 1, m)
  m.parent = marker
  return mergeTexts(marker, start + 1)
}

export function getPlaceholderId(p: Placeholder): number {
  if (typeof p.id === 'number') return p.id
  p.id = id++
  return p.id
}
