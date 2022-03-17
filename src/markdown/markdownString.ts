/* ---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { URI } from "vscode-uri"
import { BaseMarkdownString } from "./baseMarkdownString"

export class MarkdownString  {
  readonly #delegate: BaseMarkdownString

  public static isMarkdownString(thing: any): thing is MarkdownString {
    if (thing instanceof MarkdownString) {
      return true
    }
    return thing && thing.appendCodeblock && thing.appendMarkdown && thing.appendText && (thing.value !== undefined)
  }

  constructor(value?: string) {
    this.#delegate = new BaseMarkdownString(value)
  }

  public get value(): string {
    return this.#delegate.value
  }
  public set value(value: string) {
    this.#delegate.value = value
  }

  public get isTrusted(): boolean | undefined {
    return this.#delegate.isTrusted
  }

  public set isTrusted(value: boolean | undefined) {
    this.#delegate.isTrusted = value
  }

  public get supportThemeIcons(): boolean | undefined {
    return this.#delegate.supportThemeIcons
  }

  public set supportThemeIcons(value: boolean | undefined) {
    this.#delegate.supportThemeIcons = value
  }

  public get supportHtml(): boolean | undefined {
    return this.#delegate.supportHtml
  }

  public set supportHtml(value: boolean | undefined) {
    this.#delegate.supportHtml = value
  }

  public get baseUri(): URI | undefined {
    return this.#delegate.baseUri
  }

  public set baseUri(value: URI | undefined) {
    this.#delegate.baseUri = value
  }

  public appendText(value: string): MarkdownString {
    this.#delegate.appendText(value)
    return this
  }

  public appendMarkdown(value: string): MarkdownString {
    this.#delegate.appendMarkdown(value)
    return this
  }

  public appendCodeblock(value: string, language?: string): MarkdownString {
    this.#delegate.appendCodeblock(language ?? '', value)
    return this
  }
}
