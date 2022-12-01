import { ParseError, ParseErrorCode, visit } from 'jsonc-parser'
import { Diagnostic, Range } from 'vscode-languageserver-types'
import { createLogger } from '../logger'
import { ConfigurationScope, IConfigurationModel, IOverrides } from './types'
import { ConfigurationModel } from './model'
import { convertErrors, overrideIdentifiersFromKey, OVERRIDE_PROPERTY_REGEX, toValuesTree } from './util'
const logger = createLogger('parser')

export interface ConfigurationParseOptions {
  scopes: ConfigurationScope[] | undefined
  skipRestricted?: boolean
}

export interface ConfigurationParseError {
  startLine?: number
  startCharacter?: number
  length?: number
  message: string
}

export class ConfigurationModelParser {
  private _raw: any = null
  private _configurationModel: ConfigurationModel | null = null
  private _parseErrors: Diagnostic[] = []

  constructor(protected readonly _name: string) {}

  public get configurationModel(): ConfigurationModel {
    return this._configurationModel || new ConfigurationModel()
  }

  public get errors(): Diagnostic[] {
    return this._parseErrors
  }

  public parse(content: string | null | undefined, options?: ConfigurationParseOptions): void {
    if (content != null) {
      const raw = this.doParseContent(content)
      this.parseRaw(raw, options)
    }
  }

  public parseRaw(raw: any, options?: ConfigurationParseOptions): void {
    this._raw = raw
    const { contents, keys, overrides } = this.doParseRaw(raw, options)
    this._configurationModel = new ConfigurationModel(contents, keys, overrides)
    // this._restrictedConfigurations = restricted || []
  }

  private doParseContent(content: string): any {
    let raw: any = {}
    let currentProperty: string | null = null
    let currentParent: any = []
    const previousParents: any[] = []
    const _errors: ParseError[] = []

    function onValue(value: any) {
      if (Array.isArray(currentParent)) {
        (currentParent).push(value)
      } else if (currentProperty !== null) {
        currentParent[currentProperty] = value
      }
    }

    const visitor = {
      onObjectBegin: () => {
        const object = {}
        onValue(object)
        previousParents.push(currentParent)
        currentParent = object
        currentProperty = null
      },
      onObjectProperty: (name: string) => {
        currentProperty = name
      },
      onObjectEnd: () => {
        currentParent = previousParents.pop()
      },
      onArrayBegin: () => {
        const array: any[] = []
        onValue(array)
        previousParents.push(currentParent)
        currentParent = array
        currentProperty = null
      },
      onArrayEnd: () => {
        currentParent = previousParents.pop()
      },
      onLiteralValue: onValue,
      onError: (error: ParseErrorCode, offset: number, length: number) => {
        _errors.push({ error, length, offset })
      }
    }
    if (content) {
      try {
        visit(content, visitor, { allowTrailingComma: true, allowEmptyContent: true })
        raw = currentParent[0] ?? {}
        if (_errors.length > 0) {
          this._parseErrors = convertErrors(content, _errors)
        }
      } catch (e) {
        this._parseErrors = [{
          range: Range.create(0, 0, 0, 0),
          message: `Error on parse configuration file ${this._name}: ${e}`
        }]
      }
    }
    return raw
  }

  protected doParseRaw(raw: any, _options?: ConfigurationParseOptions): IConfigurationModel & { restricted?: string[] } {
    const onError = (message: string) => {
      console.error(`Conflict in settings file ${this._name}: ${message}`)
    }
    const contents = toValuesTree(raw, onError, true)
    const keys = Object.keys(raw)
    const overrides = this.toOverrides(raw, onError)
    return { contents, keys, overrides, restricted: [] }
  }

  private toOverrides(raw: any, conflictReporter: (message: string) => void): IOverrides[] {
    const overrides: IOverrides[] = []
    for (const key of Object.keys(raw)) {
      if (OVERRIDE_PROPERTY_REGEX.test(key)) {
        const overrideRaw: any = {}
        for (const keyInOverrideRaw in raw[key]) {
          overrideRaw[keyInOverrideRaw] = raw[key][keyInOverrideRaw]
        }
        overrides.push({
          identifiers: overrideIdentifiersFromKey(key),
          keys: Object.keys(overrideRaw),
          contents: toValuesTree(overrideRaw, conflictReporter, true)
        })
      }
    }
    return overrides
  }
}
