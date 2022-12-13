import { distinct } from '../util/array'
import { Extensions as JSONExtensions, IJSONContributionRegistry } from '../util/jsonRegistry'
import { IJSONSchema } from '../util/jsonSchema'
import { toObject } from '../util/object'
import { Emitter, Event } from '../util/protocol'
import { Registry } from '../util/registry'
import { ConfigurationScope, IStringDictionary } from './types'
import { getDefaultValue, OVERRIDE_PROPERTY_PATTERN, OVERRIDE_PROPERTY_REGEX } from './util'

const EXCLUDE_KEYS = ['log-path', 'logPath']

export const Extensions = {
  Configuration: 'base.contributions.configuration'
}

export interface IConfigurationPropertySchema extends IJSONSchema {

  scope?: ConfigurationScope

  /**
   * When restricted, value of this configuration will be read only from trusted sources.
   * For eg., If the workspace is not trusted, then the value of this configuration is not read from workspace settings file.
   */
  restricted?: boolean

  /**
   * When `false` this property is excluded from the registry. Default is to include.
   */
  included?: boolean

  /**
   * Labels for enumeration items
   */
  enumItemLabels?: string[]
}

export interface IExtensionInfo {
  id: string
  displayName?: string
}

export interface IConfigurationNode {
  id?: string
  properties?: IStringDictionary<IConfigurationPropertySchema>
  scope?: ConfigurationScope
  extensionInfo?: IExtensionInfo
}

export type IRegisteredConfigurationPropertySchema = IConfigurationPropertySchema & {
  defaultDefaultValue?: any
  source?: IExtensionInfo // Source of the Property
  defaultValueSource?: IExtensionInfo | string // Source of the Default Value
}

export interface IConfigurationRegistry {

  /**
   * Register a configuration to the registry.
   */
  registerConfiguration(configuration: IConfigurationNode): void

  /**
   * Register multiple configurations to the registry.
   */
  registerConfigurations(configurations: IConfigurationNode[], validate?: boolean): void

  /**
   * Deregister multiple configurations from the registry.
   */
  deregisterConfigurations(configurations: IConfigurationNode[]): void

  /**
   * update the configuration registry by
   * - registering the configurations to add
   * - dereigstering the configurations to remove
   */
  updateConfigurations(configurations: { add: IConfigurationNode[]; remove: IConfigurationNode[] }): void

  /**
   * Event that fires whenever a configuration has been
   * registered.
   */
  readonly onDidSchemaChange: Event<void>

  /**
   * Event that fires whenever a configuration has been
   * registered.
   */
  readonly onDidUpdateConfiguration: Event<{ properties: string[]; defaultsOverrides?: boolean }>

  /**
   * Returns all configurations settings of all configuration nodes contributed to this registry.
   */
  getConfigurationProperties(): IStringDictionary<IRegisteredConfigurationPropertySchema>

  /**
   * Returns all excluded configurations settings of all configuration nodes contributed to this registry.
   */
  getExcludedConfigurationProperties(): IStringDictionary<IRegisteredConfigurationPropertySchema>
}

export interface IConfigurationDefaultOverride {
  readonly value: any
  readonly source?: IExtensionInfo | string  // Source of the default override
  readonly valuesSources?: Map<string, IExtensionInfo | string> // Source of each value in default language overrides
}

export const allSettings: { properties: IStringDictionary<IConfigurationPropertySchema>; patternProperties: IStringDictionary<IConfigurationPropertySchema> } = { properties: {}, patternProperties: {} }
export const resourceSettings: { properties: IStringDictionary<IConfigurationPropertySchema>; patternProperties: IStringDictionary<IConfigurationPropertySchema> } = { properties: {}, patternProperties: {} }

export const resourceLanguageSettingsSchemaId = 'vscode://schemas/settings/resourceLanguage'
export const configurationDefaultsSchemaId = 'vscode://schemas/settings/configurationDefaults'

const contributionRegistry = Registry.as<IJSONContributionRegistry>(JSONExtensions.JSONContribution)

class ConfigurationRegistry implements IConfigurationRegistry {
  private readonly configurationProperties: IStringDictionary<IRegisteredConfigurationPropertySchema>
  private readonly excludedConfigurationProperties: IStringDictionary<IRegisteredConfigurationPropertySchema>
  private readonly resourceLanguageSettingsSchema: IJSONSchema
  private readonly _onDidSchemaChange = new Emitter<void>()
  public readonly onDidSchemaChange: Event<void> = this._onDidSchemaChange.event
  private readonly _onDidUpdateConfiguration = new Emitter<{ properties: string[]; defaultsOverrides?: boolean }>()
  public readonly onDidUpdateConfiguration = this._onDidUpdateConfiguration.event

  constructor() {
    this.resourceLanguageSettingsSchema = { properties: {}, patternProperties: {}, additionalProperties: false, errorMessage: 'Unknown coc.nvim configuration property', allowTrailingCommas: true, allowComments: true }
    this.configurationProperties = {}
    this.excludedConfigurationProperties = {}
    contributionRegistry.registerSchema(resourceLanguageSettingsSchemaId, this.resourceLanguageSettingsSchema)
    this.registerOverridePropertyPatternKey()
  }

  public registerConfiguration(configuration: IConfigurationNode, validate = true): void {
    this.registerConfigurations([configuration], validate)
  }

  public registerConfigurations(configurations: IConfigurationNode[], validate = true): void {
    const properties = this.doRegisterConfigurations(configurations, validate)

    contributionRegistry.notifySchemaChanged(resourceLanguageSettingsSchemaId)
    this._onDidSchemaChange.fire()
    this._onDidUpdateConfiguration.fire({ properties })
  }

  public deregisterConfigurations(configurations: IConfigurationNode[]): void {
    const properties = this.doDeregisterConfigurations(configurations)

    contributionRegistry.notifySchemaChanged(resourceLanguageSettingsSchemaId)
    this._onDidSchemaChange.fire()
    this._onDidUpdateConfiguration.fire({ properties })
  }

  public updateConfigurations({ add, remove }: { add: IConfigurationNode[]; remove: IConfigurationNode[] }): void {
    const properties = []
    properties.push(...this.doDeregisterConfigurations(remove))
    properties.push(...this.doRegisterConfigurations(add, false))

    contributionRegistry.notifySchemaChanged(resourceLanguageSettingsSchemaId)
    this._onDidSchemaChange.fire()
    this._onDidUpdateConfiguration.fire({ properties: distinct(properties) })
  }

  private doRegisterConfigurations(configurations: IConfigurationNode[], validate: boolean): string[] {
    const properties: string[] = []
    configurations.forEach(configuration => {
      properties.push(...this.validateAndRegisterProperties(configuration, validate, configuration.extensionInfo)) // fills in defaults
      this.registerJSONConfiguration(configuration)
    })
    return properties
  }

  private doDeregisterConfigurations(configurations: IConfigurationNode[]): string[] {
    const properties: string[] = []
    const deregisterConfiguration = (configuration: IConfigurationNode) => {
      for (const key in toObject(configuration.properties)) {
        properties.push(key)
        delete this.configurationProperties[key]
        this.removeFromSchema(key, configuration.properties[key])
      }
    }
    for (const configuration of configurations) {
      deregisterConfiguration(configuration)
    }
    return properties
  }

  private validateAndRegisterProperties(configuration: IConfigurationNode, validate: boolean, extensionInfo: IExtensionInfo | undefined, scope: ConfigurationScope = ConfigurationScope.APPLICATION): string[] {
    scope = configuration.scope == null ? scope : configuration.scope
    const propertyKeys: string[] = []
    const properties = configuration.properties
    for (const key in toObject(properties)) {
      const property: IRegisteredConfigurationPropertySchema = properties[key]
      if (validate && validateProperty(key, property)) {
        delete properties[key]
        continue
      }
      property.source = extensionInfo
      // update default value
      property.defaultDefaultValue = properties[key].default
      this.updatePropertyDefaultValue(key, property)
      // update scope
      property.scope = property.scope == null ? scope : property.scope
      if (extensionInfo) property.description = (property.description ? `${property.description}\n` : '') + `From ${extensionInfo.id}`

      // Add to properties maps
      // Property is included by default if 'included' is unspecified
      if (property.hasOwnProperty('included') && !property.included) {
        this.excludedConfigurationProperties[key] = properties[key]
        delete properties[key]
        continue
      } else {
        this.configurationProperties[key] = properties[key]
      }
      if (!properties[key].deprecationMessage && properties[key].markdownDeprecationMessage) {
        // If not set, default deprecationMessage to the markdown source
        properties[key].deprecationMessage = properties[key].markdownDeprecationMessage
      }

      propertyKeys.push(key)
    }
    return propertyKeys
  }

  public getConfigurationProperties(): IStringDictionary<IRegisteredConfigurationPropertySchema> {
    return this.configurationProperties
  }

  public getExcludedConfigurationProperties(): IStringDictionary<IRegisteredConfigurationPropertySchema> {
    return this.excludedConfigurationProperties
  }

  private registerJSONConfiguration(configuration: IConfigurationNode) {
    const register = (configuration: IConfigurationNode) => {
      const properties = configuration.properties
      for (const key in toObject(properties)) {
        this.updateSchema(key, properties[key])
      }
    }
    register(configuration)
  }

  private updateSchema(key: string, property: IConfigurationPropertySchema): void {
    allSettings.properties[key] = property
    switch (property.scope) {
      case ConfigurationScope.WINDOW:
      case ConfigurationScope.RESOURCE:
        resourceSettings.properties[key] = property
        break
      case ConfigurationScope.LANGUAGE_OVERRIDABLE:
        resourceSettings.properties[key] = property
        this.resourceLanguageSettingsSchema.properties![key] = property
        break
    }
  }

  private removeFromSchema(key: string, property: IConfigurationPropertySchema): void {
    delete allSettings.properties[key]
    switch (property.scope) {
      case ConfigurationScope.WINDOW:
      case ConfigurationScope.RESOURCE:
      case ConfigurationScope.LANGUAGE_OVERRIDABLE:
        delete resourceSettings.properties[key]
        delete this.resourceLanguageSettingsSchema.properties![key]
        break
    }
  }

  private registerOverridePropertyPatternKey(): void {
    const resourceLanguagePropertiesSchema: IJSONSchema = {
      type: 'object',
      description: 'Configure editor settings to be overridden for a language.',
      errorMessage: 'This setting does not support per-language configuration.',
      $ref: resourceLanguageSettingsSchemaId,
    }
    allSettings.patternProperties[OVERRIDE_PROPERTY_PATTERN] = resourceLanguagePropertiesSchema
    resourceSettings.patternProperties[OVERRIDE_PROPERTY_PATTERN] = resourceLanguagePropertiesSchema
  }

  private updatePropertyDefaultValue(key: string, property: IRegisteredConfigurationPropertySchema): void {
    let defaultValue = property.defaultDefaultValue
    if (typeof defaultValue === 'undefined' && !EXCLUDE_KEYS.some(k => key.includes(k))) {
      defaultValue = getDefaultValue(property.type)
    }
    property.default = defaultValue
    property.defaultValueSource = undefined
  }
}

const configurationRegistry = new ConfigurationRegistry()
Registry.add(Extensions.Configuration, configurationRegistry)

export function validateProperty(property: string, _schema: IRegisteredConfigurationPropertySchema = undefined): string | null {
  if (!property.trim()) {
    return 'Cannot register an empty property'
  }
  if (OVERRIDE_PROPERTY_REGEX.test(property)) {
    return `Cannot register ${property}. This matches property pattern '\\\\[.*\\\\]$' for describing language specific editor settings`
  }
  if (configurationRegistry.getConfigurationProperties()[property] !== undefined) {
    return `Cannot register '${property}'. This property is already registered.`
  }
  return null
}
