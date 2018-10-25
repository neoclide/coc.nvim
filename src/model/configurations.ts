import fs from 'fs'
import Uri from 'vscode-uri'
import { emptyObject, objectLiteral } from '../util/is'
import { Configuration, ConfigurationModel } from './configuration'
import { ConfigurationInspect, ConfigurationShape, ConfigurationTarget, IConfigurationData, IConfigurationModel, WorkspaceConfiguration } from '../types'
import { mixin } from '../util/object'
import { Location, TextDocument, Range } from 'vscode-languageserver-protocol'
import { parse, ParseError } from 'jsonc-parser'
const logger = require('../util/logger')('configurations')

function lookUp(tree: any, key: string): any {
  if (key) {
    const parts = key.split('.')
    let node = tree
    for (let i = 0; node && i < parts.length; i++) {
      node = node[parts[i]]
    }
    return node
  }
  return tree
}

export interface ErrorItem {
  location: Location
  message: string
}

export type ShowError = (errors: ErrorItem[]) => void

function convertErrors(uri: string, content: string, errors: ParseError[]): ErrorItem[] {
  let items: ErrorItem[] = []
  let document = TextDocument.create(uri, 'json', 0, content)
  for (let err of errors) {
    let msg = 'parse error'
    switch (err.error) {
      case 2:
        msg = 'invalid number'
        break
      case 8:
        msg = 'close brace expected'
        break
      case 5:
        msg = 'colon expeted'
        break
      case 6:
        msg = 'comma expected'
        break
      case 9:
        msg = 'end of file expected'
        break
      case 16:
        msg = 'invaliad character'
        break
      case 10:
        msg = 'invalid commment token'
        break
      case 15:
        msg = 'invalid escape character'
        break
      case 1:
        msg = 'invalid symbol'
        break
      case 14:
        msg = 'invalid unicode'
        break
      case 3:
        msg = 'property name expected'
        break
      case 13:
        msg = 'unexpected end of number'
        break
      case 12:
        msg = 'unexpected end of string'
        break
      case 11:
        msg = 'unexpected end of comment'
        break
      case 4:
        msg = 'value expected'
        break
    }
    let range: Range = {
      start: document.positionAt(err.offset),
      end: document.positionAt(err.offset + err.length),
    }
    let loc = Location.create(uri, range)
    items.push({ location: loc, message: msg })
  }
  return items
}

export default class Configurations {
  private _configuration: Configuration

  constructor(
    data: IConfigurationData,
    private readonly _proxy: ConfigurationShape,
    private readonly _folderConfigurations: Map<string, ConfigurationModel> = new Map()
  ) {
    this._configuration = Configurations.parse(data)
  }

  public get foldConfigurations(): Map<string, ConfigurationModel> {
    return this._folderConfigurations
  }

  public updateDefaults(key: string, value: any): void {
    this._configuration.updateValue(key, value, true)
  }

  public get defaults(): IConfigurationModel {
    return { contents: this._configuration.defaults.contents }
  }

  public addFolderFile(filepath: string): void {
    let { _folderConfigurations } = this
    if (_folderConfigurations.has(filepath)) return
    let contents = Configurations.parseContentFromFile(filepath)
    _folderConfigurations.set(filepath, Configurations.parseConfigurationModel(contents))
  }

  /**
   * getConfiguration
   *
   * @public
   * @param {string} section
   * @returns {WorkspaceConfiguration}
   */
  public getConfiguration(section?: string, resource?: string): WorkspaceConfiguration {
    let configuration: Configuration
    if (resource) {
      let { defaults, user } = this._configuration
      configuration = new Configuration(defaults, user, this.getFolderConfiguration(resource))
    } else {
      configuration = this._configuration
    }
    const config = Object.freeze(lookUp(configuration.getValue(null), section))

    const result: WorkspaceConfiguration = {
      has(key: string): boolean {
        return typeof lookUp(config, key) !== 'undefined'
      },
      get: <T>(key: string, defaultValue?: T) => {
        let result = lookUp(config, key)
        if (typeof result === 'undefined') {
          result = defaultValue
        }
        if (result == null || (typeof result == 'string' && result.length == 0)) return undefined
        return result
      },
      update: (key: string, value: any, isUser = true) => {
        let s = section ? `${section}.${key}` : key
        let target = isUser ? ConfigurationTarget.User : ConfigurationTarget.Workspace
        if (value === undefined) {
          this._proxy.$removeConfigurationOption(target, s)
        } else {
          this._proxy.$updateConfigurationOption(target, s, value)
        }
      },
      inspect: <T>(key: string): ConfigurationInspect<T> => {
        key = section ? `${section}.${key}` : key
        const config = this._configuration.inspect<T>(key)
        if (config) {
          return {
            key,
            defaultValue: config.default,
            globalValue: config.user,
            workspaceValue: config.workspace,
          }
        }
        return undefined
      }
    }
    Object.defineProperty(result, 'has', {
      enumerable: false
    })
    Object.defineProperty(result, 'get', {
      enumerable: false
    })
    Object.defineProperty(result, 'update', {
      enumerable: false
    })
    Object.defineProperty(result, 'inspect', {
      enumerable: false
    })

    if (typeof config === 'object') {
      mixin(result, config, false)
    }
    return Object.freeze(result) as WorkspaceConfiguration
  }

  private getFolderConfiguration(uri: string): ConfigurationModel {
    let u = Uri.parse(uri)
    if (u.scheme != 'file') return new ConfigurationModel()
    let filepath = u.fsPath
    for (let [root, model] of this.foldConfigurations) {
      if (filepath.startsWith(root)) {
        return model
      }
    }
    return new ConfigurationModel()
  }

  private static parseConfigurationModel(model: IConfigurationModel): ConfigurationModel {
    return new ConfigurationModel(model.contents).freeze()
  }

  private static parse(data: IConfigurationData): Configuration {
    const defaultConfiguration = Configurations.parseConfigurationModel(data.defaults)
    const userConfiguration = Configurations.parseConfigurationModel(data.user)
    const workspaceConfiguration = Configurations.parseConfigurationModel(data.workspace)
    return new Configuration(defaultConfiguration, userConfiguration, workspaceConfiguration, new ConfigurationModel())
  }

  private static parseConfig(uri: string, content: string, onError?: ShowError): any {
    if (content.length == 0) return {}
    let errors: ParseError[] = []
    let data = parse(content, errors, { allowTrailingComma: true })
    if (errors.length && onError) {
      onError(convertErrors(uri, content, errors))
    }
    function addProperty(current: object, key: string, remains: string[], value: any): void {
      if (remains.length == 0) {
        current[key] = convert(value)
      } else {
        if (!current[key]) current[key] = {}
        let o = current[key]
        let first = remains.shift()
        addProperty(o, first, remains, value)
      }
    }

    function convert(obj: any): any {
      if (!objectLiteral(obj)) return obj
      if (emptyObject(obj)) return {}
      let dest = {}
      for (let key of Object.keys(obj)) {
        if (key.indexOf('.') !== -1) {
          let parts = key.split('.')
          let first = parts.shift()
          addProperty(dest, first, parts, obj[key])
        } else {
          dest[key] = convert(obj[key])
        }
      }
      return dest
    }
    return convert(data)
  }

  public static parseContentFromFile(filepath: string, onError?: ShowError): IConfigurationModel {
    if (!fs.existsSync(filepath)) return { contents: {} }
    let content: string
    let uri = Uri.file(filepath).toString()
    try {
      content = fs.readFileSync(filepath, 'utf8')
    } catch (_e) {
      content = ''
    }
    let res: any
    try {
      res = { contents: Configurations.parseConfig(uri, content, onError) }
    } catch (e) {
      res = { contents: {} }
    }
    return res
  }
}
