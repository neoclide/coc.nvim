/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { URI, UriComponents } from "vscode-uri"
import { illegalArgument } from '../util/errors'
import { escapeRegExpCharacters } from '../util/string'

export interface IMarkdownString {
  readonly value: string;
  readonly isTrusted?: boolean;
  readonly supportThemeIcons?: boolean;
  readonly supportHtml?: boolean;
  readonly baseUri?: UriComponents;
  uris?: { [href: string]: UriComponents };
}

export const enum MarkdownStringTextNewlineStyle {
  Paragraph = 0,
    Break = 1,
}

export class BaseMarkdownString implements IMarkdownString {

  public value: string
  public isTrusted?: boolean
  public supportThemeIcons?: boolean
  public supportHtml?: boolean
  public baseUri?: URI

  constructor(
    value = '',
      isTrustedOrOptions: boolean | { isTrusted?: boolean; supportThemeIcons?: boolean; supportHtml?: boolean } = false,
  ) {
      this.value = value
      if (typeof this.value !== 'string') {
        throw illegalArgument('value')
      }

      if (typeof isTrustedOrOptions === 'boolean') {
        this.isTrusted = isTrustedOrOptions
        this.supportThemeIcons = false
        this.supportHtml = false
      }
      else {
        this.isTrusted = isTrustedOrOptions.isTrusted ?? undefined
        this.supportThemeIcons = isTrustedOrOptions.supportThemeIcons ?? false
        this.supportHtml = isTrustedOrOptions.supportHtml ?? false
      }
    }

    public appendText(value: string, newlineStyle: MarkdownStringTextNewlineStyle = MarkdownStringTextNewlineStyle.Paragraph): BaseMarkdownString {
      this.value += escapeMarkdownSyntaxTokens(value)
      .replace(/([ \t]+)/g, (_match, g1) => '&nbsp;'.repeat(g1.length))
      .replace(/>/gm, '\\>')
      .replace(/\n/g, newlineStyle === MarkdownStringTextNewlineStyle.Break ? '\\\n' : '\n\n')

      return this
    }

    public appendMarkdown(value: string): BaseMarkdownString {
      this.value += value
      return this
    }

    public appendCodeblock(langId: string, code: string): BaseMarkdownString {
      this.value += '\n```'
      this.value += langId
      this.value += '\n'
      this.value += code
      this.value += '\n```\n'
      return this
    }

    public appendLink(target: URI | string, label: string, title?: string): BaseMarkdownString {
      this.value += '['
      this.value += this._escape(label, ']')
      this.value += ']('
      this.value += this._escape(String(target), ')')
      if (title) {
        this.value += ` "${this._escape(this._escape(title, '"'), ')')}"`
      }
      this.value += ')'
      return this
    }

    private _escape(value: string, ch: string): string {
      const r = new RegExp(escapeRegExpCharacters(ch), 'g')
      return value.replace(r, (match, offset) => {
        if (value.charAt(offset - 1) !== '\\') {
          return `\\${match}`
        } else {
          return match
        }
      })
    }
}

export function isEmptyMarkdownString(oneOrMany: IMarkdownString | IMarkdownString[] | null | undefined): boolean {
  if (isMarkdownString(oneOrMany)) {
    return !oneOrMany.value
  } else if (Array.isArray(oneOrMany)) {
    return oneOrMany.every(isEmptyMarkdownString)
  } else {
    return true
  }
}

export function isMarkdownString(thing: any): thing is IMarkdownString {
  if (thing instanceof BaseMarkdownString) {
    return true
  } else if (thing && typeof thing === 'object') {
    return typeof (thing as IMarkdownString).value === 'string'
    && (typeof (thing as IMarkdownString).isTrusted === 'boolean' || (thing as IMarkdownString).isTrusted === undefined)
    && (typeof (thing as IMarkdownString).supportThemeIcons === 'boolean' || (thing as IMarkdownString).supportThemeIcons === undefined)
  }
  return false
}

export function markdownStringEqual(a: IMarkdownString, b: IMarkdownString): boolean {
  if (a === b) {
    return true
  } else if (!a || !b) {
    return false
  } else {
    return a.value === b.value
    && a.isTrusted === b.isTrusted
    && a.supportThemeIcons === b.supportThemeIcons
    && a.supportHtml === b.supportHtml
    && (a.baseUri === b.baseUri || !!a.baseUri && !!b.baseUri && URI.from(a.baseUri).fsPath === URI.from(b.baseUri).fsPath)
  }
}

export function escapeMarkdownSyntaxTokens(text: string): string {
  // escape markdown syntax tokens: http://daringfireball.net/projects/markdown/syntax#backslash
  return text.replace(/[\\`*_{}[\]()#+\-!]/g, '\\$&')
}

export function removeMarkdownEscapes(text: string): string {
  if (!text) {
    return text
  }
  return text.replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
}

export function parseHrefAndDimensions(href: string): { href: string; dimensions: string[] } {
  const dimensions: string[] = []
  const splitted = href.split('|').map(s => s.trim())
  href = splitted[0]
  const parameters = splitted[1]
  if (parameters) {
    const heightFromParams = /height=(\d+)/.exec(parameters)
    const widthFromParams = /width=(\d+)/.exec(parameters)
    const height = heightFromParams ? heightFromParams[1] : ''
    const width = widthFromParams ? widthFromParams[1] : ''
    const widthIsFinite = isFinite(parseInt(width, 10))
    const heightIsFinite = isFinite(parseInt(height, 10))
    if (widthIsFinite) {
      dimensions.push(`width="${width}"`)
    }
    if (heightIsFinite) {
      dimensions.push(`height="${height}"`)
    }
  }
  return { href, dimensions }
}
