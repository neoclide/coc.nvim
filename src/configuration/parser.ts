import { ParseError, ParseErrorCode, visit } from 'jsonc-parser'
import { Location, Range } from 'vscode-languageserver-protocol'
import { URI } from 'vscode-uri'
import { ErrorItem, IConfigurationModel, IOverrides } from '../types'
import { ConfigurationModel } from './model'
import { convertErrors, overrideIdentifiersFromKey, OVERRIDE_PROPERTY_REGEX, toValuesTree } from './util'

export const enum ConfigurationScope {
  /**
   * Application specific configuration, which can be configured only in local user settings.
   */
  WINDOW = 1,
  /**
   * Resource specific configuration, which can be configured in the user, workspace or folder settings.
   */
  RESOURCE,
  /**
   * Resource specific configuration that can be configured in language specific settings
   */
  LANGUAGE_OVERRIDABLE,
}

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
  private _parseErrors: ErrorItem[] = []

  constructor(protected readonly _name: string) {}

  public get configurationModel(): ConfigurationModel {
    return this._configurationModel || new ConfigurationModel()
  }

  public get errors(): ErrorItem[] {
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
    const { contents, keys, overrides, restricted } = this.doParseRaw(raw, options)
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
        visit(content, visitor)
        raw = currentParent[0] || {}
        const uri = URI.file(this._name).toString()
        if (_errors.length > 0) {
          this._parseErrors = convertErrors(uri, content, _errors)
        }
      } catch (e) {
        const uri = URI.file(this._name).toString()
        this._parseErrors = [{
          location: Location.create(uri, Range.create(0, 0, 0, 0)),
          message: `Error while parsing settings file ${this._name}: ${e}`
        }]
      }
    }

    return raw
  }

  protected doParseRaw(raw: any, options?: ConfigurationParseOptions): IConfigurationModel & { restricted?: string[] } {
    // TODO create global Registry
    // const configurationProperties = Registry.as<IConfigurationRegistry>(Extensions.Configuration).getConfigurationProperties()
    const configurationProperties = {}
    const filtered = this.filter(raw, configurationProperties, true, options)
    raw = filtered.raw
    const onError = (message: string) => {
      console.error(`Conflict in settings file ${this._name}: ${message}`)
    }
    const contents = toValuesTree(raw, onError)
    const keys = Object.keys(raw)
    const overrides = this.toOverrides(raw, onError)
    return { contents, keys, overrides, restricted: filtered.restricted }
  }

  private filter(properties: any, configurationProperties: { [qualifiedKey: string]: any }, filterOverriddenProperties: boolean, options?: ConfigurationParseOptions): { raw: {}; restricted: string[] } {
    if (!options?.scopes && !options?.skipRestricted) {
      return { raw: properties, restricted: [] }
    }
    const raw: any = {}
    const restricted: string[] = []
    for (const key in properties) {
      if (OVERRIDE_PROPERTY_REGEX.test(key) && filterOverriddenProperties) {
        const result = this.filter(properties[key], configurationProperties, false, options)
        raw[key] = result.raw
        restricted.push(...result.restricted)
      } else {
        const propertySchema = configurationProperties[key]
        const scope = propertySchema ? typeof propertySchema.scope !== 'undefined' ? propertySchema.scope : ConfigurationScope.WINDOW : undefined
        if (propertySchema?.restricted) {
          restricted.push(key)
        }
        // Load unregistered configurations always.
        if (scope === undefined || options.scopes === undefined || options.scopes.includes(scope)) {
          if (!(options.skipRestricted && propertySchema?.restricted)) {
            raw[key] = properties[key]
          }
        }
      }
    }
    return { raw, restricted }
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
          contents: toValuesTree(overrideRaw, conflictReporter)
        })
      }
    }
    return overrides
  }
}
